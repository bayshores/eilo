"""Keychain-only retrieval for the encrypted adaptive-context store."""

from __future__ import annotations

from cryptography.fernet import Fernet

SERVICE = "app.eilo.context"
USERNAME = "memory-key-v1"


class ContextKeyError(RuntimeError):
    """A context encryption key is unavailable or unsafe to use."""


def _macos_backend():
    try:
        from keyring.backends.macOS import Keyring

        return Keyring()
    except Exception as error:
        raise ContextKeyError("The macOS Keychain backend is unavailable.") from error


def _valid_key(value):
    if not isinstance(value, str):
        raise ContextKeyError("The stored context key is invalid.")
    encoded = value.encode("ascii")
    try:
        Fernet(encoded)
    except (TypeError, ValueError) as error:
        raise ContextKeyError("The stored context key is invalid.") from error
    return encoded


def load_context_key(*, create=False, backend=None):
    """Load a Fernet key from macOS Keychain, creating it only when requested.

    ``backend`` is intentionally an injection seam for isolated tests. Production
    calls always construct the macOS Keychain backend here, rather than accepting
    a process-wide keyring default or any file-backed fallback.
    """
    if not isinstance(create, bool):
        raise ContextKeyError("The create option must be true or false.")
    provider = _macos_backend() if backend is None else backend
    if not hasattr(provider, "get_password") or not hasattr(provider, "set_password"):
        raise ContextKeyError("The context key backend is unavailable.")
    try:
        stored = provider.get_password(SERVICE, USERNAME)
    except Exception as error:
        raise ContextKeyError("The context key is unavailable.") from error
    if stored is not None:
        return _valid_key(stored)
    if not create:
        raise ContextKeyError("No context key is available.")
    key = Fernet.generate_key()
    try:
        provider.set_password(SERVICE, USERNAME, key.decode("ascii"))
    except Exception as error:
        raise ContextKeyError("The context key could not be stored.") from error
    return key
