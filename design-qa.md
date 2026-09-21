# Home redesign design QA

Reference: the approved black and rose macOS mockup, with typography and backdrop cues from the Obsel localhost dashboard.

## Checked states

- Real Electron Home at the saved 1172 by 768 window size.
- Isolated Home fixture at 1172 by 768 and the ordinary wide fixture size.
- First return foreground, transition into Home, goal conversation entry, manual goal form, goal review, 1D and 7D activity views, 31D unavailable state, recording control, explanation disclosure, open and collapsed conversation, and reduced motion CSS.
- Keyboard focus, semantic headings, control names, focus rings, modal focus, and focus restoration.

## Resolved findings

- Removed pointer tilt from Home and detail panels.
- Reflowed the open conversation layout so activity sources and dock controls do not clip at the native window size.
- Replaced the old rounded gray goal dialog and form with the Home typography, square controls, rose rules, and matching button hierarchy.
- Removed repeated helper text and moved the check-in summary into the conversation dock when the conversation is open.
- Kept analytics truthful: desktop or browser aggregates are labeled by source, 1D omits an unsupported ranking, and 31D stays disabled while only seven days are retained.
- Made goal creation conversation first while retaining a clearly labeled manual form.
- Added a full foreground return moment using only saved goal, explicit return point, and fresh Calendar data, then a reduced-motion-aware transition into Home.

Final result: passed.
