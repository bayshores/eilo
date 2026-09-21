# noRot orb attribution

The renderer adapts the point-cloud geometry, dot texture, simplex noise and deformation shaders from [Team noRot's VoiceOrb](https://github.com/Safkatul-Islam/noRot/blob/3463a01185fd9c6d9dee19da3107893effd5e187/apps/desktop/src/components/VoiceOrb.tsx).

Source commit: `3463a01185fd9c6d9dee19da3107893effd5e187`.

Adaptations remove React, global voice/severity stores and diagnostics; connect felis's accent and real speech/conversation state; and add visibility, reduced-motion and cleanup handling. The original shader equations and particle texture are retained. Three.js is pinned and vendored separately under `web/vendor/three`.

MIT License

Copyright (c) 2026 Team noRot

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
