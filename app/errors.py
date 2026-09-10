"""User-safe application errors."""


class ChatError(Exception):
    """A deliberately user-safe error; never forward runtime diagnostics."""
