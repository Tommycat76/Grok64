# Grok64 project instructions

## iOS CRT (P0)

**Read `docs/IOS_CRT_KNOWN_FAILURES.md` first** before any iPhone CRT,
CriOS paint, bezel-fill, or “READY is black” work.

Do not retry the failed approaches listed there (1–9) without new evidence
from Tom’s real iPhone. Plex / Playwright / iPhone-UA Chromium green is
**not** a PASS. Tom’s phone is the only CRT PASS.

`#47` was a **false green**. `#48` CSS 100% + **lie** `clientWidth` painted
empty black (`#7`). `#49` CSS 100% + **unlock** `clientWidth` painted the
**same empty black** (`#8`). `#50` native 384×272 + flex letterbox painted
on Plex (`~853k`) but Tom’s CriOS was a **postage stamp** (border only L+B)
— **Plex paint-count ≠ Tom geometry** (`#9`). The CSS-100% + clientWidth
family is **dead**. Do not retry an unzoomed intrinsic-384 letterbox.

Current ship: live 384×272 WebGL + CSS `zoom` on the non-GL `.g64-ios-zoom`
host. Do not retry PNG poll, wrapper CSS transform on GL, `drawImage` tall
present, `readPixels` present, or CSS 100% + lie/unlock. Do not print
`PASS` from the Plex gate.

Keep: PETSCII #32, unit-8 Play recycle, #41 no mid-play yank, build-id
chip, debug log off by default.
