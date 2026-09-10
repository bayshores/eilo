"""Bounded, local-only speech-to-text for eilo's browser-recorded WAV input."""

from __future__ import annotations

import asyncio
import contextlib
import os
import re
import signal
import struct
import tempfile
from pathlib import Path

MAX_WAV_BYTES = 4 * 1024 * 1024
MAX_SECONDS = 120
SAMPLE_RATE = 16_000
MAX_FRAMES = SAMPLE_RATE * MAX_SECONDS
MODEL_NAME = "ggml-small.en.bin"
MODEL_SHA1 = "db8a495a91d927739e50b3fc1cc4c6b8f6c2d022"
WHISPER_CPP_VERSION = "v1.9.3"
REQUEST_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}")


class TranscriptionError(Exception):
    """A user-safe local transcription error."""

    status = 503


class InvalidAudioError(TranscriptionError):
    status = 400


class TranscriberBusyError(TranscriptionError):
    status = 409


def _wav_frames(audio: bytes) -> int:
    """Accept only a complete 16 kHz mono PCM16 RIFF/WAVE payload."""
    if not isinstance(audio, bytes) or not audio:
        raise InvalidAudioError("Audio is empty.")
    if len(audio) > MAX_WAV_BYTES:
        raise InvalidAudioError("Audio is too large; record up to two minutes.")
    if len(audio) < 12 or audio[:4] != b"RIFF" or audio[8:12] != b"WAVE":
        raise InvalidAudioError("Audio must be a WAV recording.")
    if struct.unpack_from("<I", audio, 4)[0] != len(audio) - 8:
        raise InvalidAudioError("Audio WAV length is invalid.")
    offset, fmt, data = 12, None, None
    while offset < len(audio):
        if offset + 8 > len(audio):
            raise InvalidAudioError("Audio WAV chunk is incomplete.")
        kind = audio[offset : offset + 4]
        size = struct.unpack_from("<I", audio, offset + 4)[0]
        start, end = offset + 8, offset + 8 + size
        if end > len(audio):
            raise InvalidAudioError("Audio WAV chunk length is invalid.")
        if kind == b"fmt " and fmt is None:
            fmt = audio[start:end]
        elif kind == b"data" and data is None:
            data = audio[start:end]
        offset = end + (size & 1)
        if offset > len(audio):
            raise InvalidAudioError("Audio WAV padding is invalid.")
    if offset != len(audio) or fmt is None or data is None or len(fmt) < 16:
        raise InvalidAudioError("Audio WAV format is invalid.")
    encoding, channels, rate, byte_rate, block_align, bits = struct.unpack_from("<HHIIHH", fmt)
    if (encoding, channels, rate, byte_rate, block_align, bits) != (
        1,
        1,
        SAMPLE_RATE,
        32_000,
        2,
        16,
    ):
        raise InvalidAudioError("Audio must be 16 kHz mono PCM WAV.")
    if not data or len(data) % block_align:
        raise InvalidAudioError("Audio frame data is invalid.")
    frames = len(data) // block_align
    if frames > MAX_FRAMES:
        raise InvalidAudioError("Audio is longer than two minutes.")
    return frames


class Transcriber:
    """Serial local whisper.cpp runner. It never contacts a recognition service."""

    def __init__(
        self,
        root: Path | str,
        *,
        timeout_seconds: int = 150,
        executable: Path | str | None = None,
        model: Path | str | None = None,
    ) -> None:
        self.root = Path(root).resolve()
        self.runtime = self.root / ".runtime" / "stt"
        self.executable = (
            Path(executable)
            if executable
            else self.runtime / "whisper.cpp" / "build" / "bin" / "whisper-cli"
        )
        self.model = Path(model) if model else self.runtime / "models" / MODEL_NAME
        self.recordings = self.root / ".tmp" / "transcription"
        self.timeout_seconds = timeout_seconds
        self._lock = asyncio.Lock()
        self._process: asyncio.subprocess.Process | None = None
        self._request_id: str | None = None
        self._active_task: asyncio.Task | None = None
        self._spawn_task: asyncio.Task | None = None

    def status(self) -> dict:
        return {
            "ready": self.executable.is_file()
            and os.access(self.executable, os.X_OK)
            and self.model.is_file(),
            "runtime": "local_whisper_cpp",
            "version": WHISPER_CPP_VERSION,
            "model": MODEL_NAME,
            "model_sha1": MODEL_SHA1,
        }

    async def cancel(self, request_id: str) -> bool:
        if request_id != self._request_id:
            return False
        if self._process is not None:
            await self._stop_process(self._process)
        elif self._active_task is not None:
            self._active_task.cancel()
        return True

    async def close(self) -> None:
        """Stop only this transcriber's active local request during app shutdown."""
        task = self._active_task
        if task is None or task.done():
            return
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    async def transcribe(self, wav_bytes: bytes, request_id: str) -> str:
        if not isinstance(request_id, str) or not REQUEST_ID.fullmatch(request_id):
            raise TranscriptionError("The recording request is invalid.")
        _wav_frames(wav_bytes)
        if self._lock.locked():
            raise TranscriberBusyError("A recording is already being transcribed.")
        async with self._lock:
            if not self.status()["ready"]:
                raise TranscriptionError("Local transcription is not installed yet.")
            self.recordings.mkdir(mode=0o700, parents=True, exist_ok=True)
            os.chmod(self.recordings, 0o700)
            path = self._write_recording(wav_bytes)
            self._request_id = request_id
            self._active_task = asyncio.current_task()
            try:
                return await self._run(path)
            finally:
                self._request_id = None
                self._process = None
                self._active_task = None
                with contextlib.suppress(FileNotFoundError):
                    path.unlink()

    def _write_recording(self, audio: bytes) -> Path:
        with tempfile.NamedTemporaryFile(
            mode="wb", dir=self.recordings, prefix="recording-", suffix=".wav", delete=False
        ) as stream:
            os.chmod(stream.name, 0o600)
            stream.write(audio)
            stream.flush()
            os.fsync(stream.fileno())
            return Path(stream.name)

    async def _run(self, path: Path) -> str:
        self._spawn_task = asyncio.create_task(
            asyncio.create_subprocess_exec(
                str(self.executable),
                "--model",
                str(self.model),
                "--file",
                str(path),
                "--language",
                "en",
                "--threads",
                "4",
                "--no-timestamps",
                "--no-prints",
                cwd=self.root,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                start_new_session=True,
            )
        )
        try:
            try:
                self._process = await asyncio.shield(self._spawn_task)
            except asyncio.CancelledError:
                # A child can be created while cancellation is being delivered. Wait for
                # its handle, stop it, then preserve the original cancellation.
                self._process = await self._spawn_task
                await self._stop_process(self._process)
                raise
            out, _ = await asyncio.wait_for(self._process.communicate(), self.timeout_seconds)
        except (TimeoutError, asyncio.CancelledError):
            if self._process is not None:
                await self._stop_process(self._process)
            raise
        finally:
            self._spawn_task = None
        if self._process.returncode:
            raise TranscriptionError("Local transcription could not read that recording.")
        text = out.decode("utf-8", errors="replace").strip()
        if not text:
            raise TranscriptionError("No speech was recognized in that recording.")
        return text

    @staticmethod
    async def _stop_process(process: asyncio.subprocess.Process) -> None:
        if process.returncode is not None:
            return
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGTERM)
        try:
            await asyncio.wait_for(process.wait(), 5)
        except TimeoutError:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
            await process.wait()
