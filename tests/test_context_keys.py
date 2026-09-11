from __future__ import annotations

import unittest

from cryptography.fernet import Fernet

from app.context_keys import SERVICE, USERNAME, ContextKeyError, load_context_key


class FakeBackend:
    def __init__(self, value=None, error=None):
        self.value, self.error, self.calls = value, error, []

    def get_password(self, service, username):
        self.calls.append(("get", service, username))
        if self.error:
            raise self.error
        return self.value

    def set_password(self, service, username, value):
        self.calls.append(("set", service, username, value))
        if self.error:
            raise self.error
        self.value = value


class ContextKeysTest(unittest.TestCase):
    def test_missing_key_fails_without_create(self):
        backend = FakeBackend()
        with self.assertRaises(ContextKeyError):
            load_context_key(backend=backend)
        self.assertEqual(backend.calls, [("get", SERVICE, USERNAME)])

    def test_create_stores_new_fernet_key_once(self):
        backend = FakeBackend()
        key = load_context_key(create=True, backend=backend)
        Fernet(key)
        self.assertEqual(backend.calls[0], ("get", SERVICE, USERNAME))
        self.assertEqual(backend.calls[1][:3], ("set", SERVICE, USERNAME))
        self.assertEqual(load_context_key(create=True, backend=backend), key)
        self.assertEqual(len(backend.calls), 3)

    def test_invalid_stored_key_and_backend_failure_fail_closed(self):
        with self.assertRaises(ContextKeyError):
            load_context_key(create=True, backend=FakeBackend("not-a-key"))
        with self.assertRaises(ContextKeyError):
            load_context_key(backend=FakeBackend(error=RuntimeError("no access")))


if __name__ == "__main__":
    unittest.main()
