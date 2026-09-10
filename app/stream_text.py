"""Provisional, bounded preview decoding for a single JSON-envelope text field.

JsonTextPreview.feed(delta) returns a cumulative decoded string only when it
extends the previous preview. It never validates or commits a final response.
"""
from __future__ import annotations

import json


class JsonTextPreview:
    """Incrementally reveal one direct top-level JSON string after strict gates."""

    def __init__(self, field, *, required=None, allowed=None, max_chars=400, max_input=65_536):
        if not isinstance(field, str) or not field or not isinstance(max_chars, int) or max_chars < 0 or not isinstance(max_input, int) or max_input < 1:
            raise ValueError("invalid preview configuration")
        if required is None:
            required = {}
        if allowed is None:
            allowed = {}
        if (not isinstance(required, dict) or not isinstance(allowed, dict)
                or any(not isinstance(key, str) for key in required)
                or any(not isinstance(key, str) or not isinstance(values, set) for key, values in allowed.items())):
            raise ValueError("invalid preview gates")
        self.field, self.required, self.allowed = field, dict(required), {key: set(values) for key, values in allowed.items()}
        self.max_chars, self.max_input = max_chars, max_input
        self.buffer, self.emitted, self.failed = "", "", False

    @staticmethod
    def _space(text, index):
        while index < len(text) and text[index] in " \t\r\n":
            index += 1
        return index

    def _string(self, index):
        """Return (value, end, complete), or raise ValueError for bad JSON."""
        text = self.buffer
        if index >= len(text) or text[index] != '"':
            raise ValueError("expected string")
        index += 1
        value = []
        while index < len(text):
            char = text[index]
            if char == '"':
                return "".join(value), index + 1, True
            if ord(char) < 0x20:
                raise ValueError("control character")
            if char != "\\":
                if 0xD800 <= ord(char) <= 0xDFFF:
                    raise ValueError("lone surrogate")
                value.append(char); index += 1; continue
            if index + 1 >= len(text):
                return "".join(value), index, False
            escape = text[index + 1]
            simple = {'"': '"', "\\": "\\", "/": "/", "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t"}
            if escape in simple:
                value.append(simple[escape]); index += 2; continue
            if escape != "u":
                raise ValueError("bad escape")
            if index + 6 > len(text):
                return "".join(value), index, False
            digits = text[index + 2:index + 6]
            if any(digit not in "0123456789abcdefABCDEF" for digit in digits):
                raise ValueError("bad unicode escape")
            codepoint = int(digits, 16)
            index += 6
            if 0xD800 <= codepoint <= 0xDBFF:
                if index + 6 > len(text):
                    return "".join(value), index - 6, False
                if text[index:index + 2] != "\\u":
                    raise ValueError("unpaired high surrogate")
                low_digits = text[index + 2:index + 6]
                if any(digit not in "0123456789abcdefABCDEF" for digit in low_digits):
                    raise ValueError("bad unicode escape")
                low = int(low_digits, 16)
                if not 0xDC00 <= low <= 0xDFFF:
                    raise ValueError("unpaired high surrogate")
                value.append(chr(0x10000 + (codepoint - 0xD800) * 0x400 + low - 0xDC00)); index += 6; continue
            if 0xDC00 <= codepoint <= 0xDFFF:
                raise ValueError("unpaired low surrogate")
            value.append(chr(codepoint))
        return "".join(value), index, False

    def _emit(self, value):
        value = value[:self.max_chars]
        if len(value) > len(self.emitted) and value.startswith(self.emitted):
            self.emitted = value
            return value
        return None

    def _scan(self):
        text, index = self.buffer, self._space(self.buffer, 0)
        if index == len(text):
            return None
        if text[index] != "{":
            raise ValueError("prefix")
        index += 1
        seen = set()
        while True:
            index = self._space(text, index)
            if index == len(text):
                return None
            if text[index] == "}":
                if self._space(text, index + 1) != len(text):
                    raise ValueError("trailing data")
                return None
            key, index, complete = self._string(index)
            if not complete:
                return None
            if key in seen:
                raise ValueError("duplicate key")
            seen.add(key)
            index = self._space(text, index)
            if index == len(text):
                return None
            if text[index] != ":":
                raise ValueError("missing colon")
            index = self._space(text, index + 1)
            if index == len(text):
                return None
            gated = set(self.required).issubset(seen - {key}) and set(self.allowed).issubset(seen - {key})
            if key == self.field:
                if not gated or text[index] != '"':
                    raise ValueError("field before gate")
                value, index, complete = self._string(index)
                preview = self._emit(value)
                if not complete:
                    return preview
            else:
                try:
                    value, index = json.JSONDecoder().raw_decode(text, index)
                except json.JSONDecodeError:
                    return None
                if key in self.required and value != self.required[key]:
                    raise ValueError("required gate")
                if key in self.allowed and value not in self.allowed[key]:
                    raise ValueError("allowed gate")
            index = self._space(text, index)
            if index == len(text):
                return preview if key == self.field else None
            if text[index] == "}":
                if self._space(text, index + 1) != len(text):
                    raise ValueError("trailing data")
                return preview if key == self.field else None
            if text[index] != ",":
                raise ValueError("missing comma")
            index += 1

    def feed(self, delta):
        """Accept one transport chunk and return a longer provisional preview, if any."""
        if self.failed or not isinstance(delta, str):
            self.failed = True
            return None
        self.buffer += delta
        if len(self.buffer) > self.max_input:
            self.failed = True
            return None
        try:
            return self._scan()
        except ValueError:
            self.failed = True
            return None
