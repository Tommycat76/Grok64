# Grok64 project instructions

## iOS CRT (P0)

**Read `docs/IOS_CRT_KNOWN_FAILURES.md` first** before any iPhone CRT,
CriOS paint, bezel-fill, or “READY is black” work.

Do not retry the failed approaches listed there (1–8) without new evidence
from Tom’s real iPhone. Plex / Playwright / iPhone-UA Chromium green is
**not** a PASS. Tom’s phone is the only CRT PASS.

`#47` was a **false green**. `#48` CSS 100% + **lie** `clientWidth` painted
empty black (`#7`). `#49` CSS 100% + **unlock** `clientWidth` painted the
**same empty black** (`#8`). The CSS-100% + clientWidth family is **dead**.
Current ship is a **centered 384×272 letterbox** (paint over fill). Do not
retry PNG poll, wrapper `scale()` on GL, `drawImage` tall present,
`readPixels` present, or CSS 100% + lie/unlock. Do not print `PASS` from
the Plex gate.

Keep: PETSCII #32, unit-8 Play recycle, #41 no mid-play yank, build-id
chip, debug log off by default.
