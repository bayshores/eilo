import asyncio
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

from app.transcription import InvalidAudioError, Transcriber, TranscriberBusyError, _wav_frames


def wav(frames=16_000):
    data = b"\0\0" * frames
    fmt = struct.pack("<HHIIHH", 1, 1, 16_000, 32_000, 2, 16)
    body = b"fmt " + struct.pack("<I", len(fmt)) + fmt + b"data" + struct.pack("<I", len(data)) + data
    return b"RIFF" + struct.pack("<I", len(body) + 4) + b"WAVE" + body


class FakeProcess:
    def __init__(self, output=b"hello from local speech\n", hold=False):
        self.returncode = None
        self.pid = 999999
        self.output = output
        self.hold = hold
        self.started = asyncio.Event()
        self.stopped = asyncio.Event()

    async def communicate(self):
        self.started.set()
        if self.hold:
            await self.stopped.wait()
        if self.returncode is None:
            self.returncode = 0
        return self.output, b""

    async def wait(self):
        self.returncode = -15
        self.stopped.set()
        return self.returncode


class TranscriptionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        executable = self.root / ".runtime/stt/whisper.cpp/build/bin/whisper-cli"
        executable.parent.mkdir(parents=True)
        executable.write_text("fixture")
        executable.chmod(0o700)
        model = self.root / ".runtime/stt/models/ggml-small.en.bin"
        model.parent.mkdir(parents=True)
        model.write_bytes(b"fixture")
        self.transcriber = Transcriber(self.root)

    async def asyncTearDown(self):
        self.temp.cleanup()

    def test_validates_complete_pcm_wav(self):
        self.assertEqual(_wav_frames(wav(3)), 3)
        for bad in (b"", b"RIFF\0\0\0\0WAVE", wav()[:-1]):
            with self.assertRaises(InvalidAudioError):
                _wav_frames(bad)
        stereo = bytearray(wav(3))
        stereo[22:24] = struct.pack("<H", 2)
        with self.assertRaises(InvalidAudioError):
            _wav_frames(bytes(stereo))
        with self.assertRaises(InvalidAudioError):
            _wav_frames(wav(16_000 * 121))

    async def test_transcribes_and_removes_private_recording(self):
        with patch("app.transcription.asyncio.create_subprocess_exec", return_value=FakeProcess()):
            self.assertEqual(await self.transcriber.transcribe(wav(), "voice_01"), "hello from local speech")
        self.assertEqual(list((self.root / ".tmp/transcription").iterdir()), [])

    async def test_rejects_second_request_while_first_is_running(self):
        process = FakeProcess(hold=True)
        with patch("app.transcription.asyncio.create_subprocess_exec", return_value=process):
            first = asyncio.create_task(self.transcriber.transcribe(wav(), "voice_01"))
            await process.started.wait()
            with self.assertRaises(TranscriberBusyError):
                await self.transcriber.transcribe(wav(), "voice_02")
            first.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await first

    async def test_cancel_stops_active_process_and_cleans_recording(self):
        process = FakeProcess(hold=True)
        with patch("app.transcription.asyncio.create_subprocess_exec", return_value=process):
            task = asyncio.create_task(self.transcriber.transcribe(wav(), "voice_01"))
            await process.started.wait()
            self.assertTrue(await self.transcriber.cancel("voice_01"))
            with self.assertRaisesRegex(Exception, "could not read"):
                await task
        self.assertEqual(list((self.root / ".tmp/transcription").iterdir()), [])

    async def test_cancel_during_process_creation_waits_for_and_stops_child(self):
        process = FakeProcess(hold=True)
        entered = asyncio.Event()
        release = asyncio.Event()

        async def spawn(*_args, **_kwargs):
            entered.set()
            await release.wait()
            return process

        with patch("app.transcription.asyncio.create_subprocess_exec", side_effect=spawn):
            task = asyncio.create_task(self.transcriber.transcribe(wav(), "voice_01"))
            await entered.wait()
            self.assertTrue(await self.transcriber.cancel("voice_01"))
            release.set()
            with self.assertRaises(asyncio.CancelledError):
                await task
        self.assertEqual(list((self.root / ".tmp/transcription").iterdir()), [])

    async def test_close_cancels_only_the_active_transcription(self):
        process = FakeProcess(hold=True)
        with patch("app.transcription.asyncio.create_subprocess_exec", return_value=process):
            task = asyncio.create_task(self.transcriber.transcribe(wav(), "voice_01"))
            await process.started.wait()
            await self.transcriber.close()
            with self.assertRaises(asyncio.CancelledError):
                await task
        self.assertEqual(list((self.root / ".tmp/transcription").iterdir()), [])


if __name__ == "__main__":
    unittest.main()
