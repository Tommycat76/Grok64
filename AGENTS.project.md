# Grok64 project instructions

## iOS CRT (P0)

**Read `docs/IOS_CRT_KNOWN_FAILURES.md` first** before any iPhone CRT,
CriOS paint, bezel-fill, or “READY is black” work.

Do not retry the failed approaches listed there (1–11) without new evidence
from Tom’s real iPhone. Plex / Playwright / iPhone-UA Chromium green is
**not** a PASS. Tom’s phone is the only CRT PASS.

`#47` was a **false green**. `#48` CSS 100% + **lie** `clientWidth` painted
empty black (`#7`). `#49` CSS 100% + **unlock** `clientWidth` painted the
**same empty black** (`#8`). `#50` native 384×272 + flex letterbox painted
on Plex (`~853k`) but Tom’s CriOS was a **postage stamp** (border only L+B)
— **Plex paint-count ≠ Tom geometry** (`#9`). `#51` CSS `zoom` on
`.g64-ios-zoom` enlarged the stamp (`7d09f7a` / `2Aufi9H1`) but left it
**top-right flush / purple L left+bottom** — **Plex `zoom:3` ≠ Tom
geometry** (`#10`). `#52` centered zoom slot (`156a07f` / `D2Yf0JqE`) was a
**thin purple strip along the BOTTOM** of the tall bezel (`#11`).

**Prefer restore of the last-good CRT layout over inventing a new
scale / zoom / CSS-100% / slot theory.** The last known-good presentation
is `ee0b445` (PR #41; immediately before the #42 rewrite at `30d158a`):
`.g64-screen` is `aspect-ratio: 384 / 272` and fills as the CRT glass;
canvas / `#grok64-player` are `inset: 0; width/height: 100%` of **that**
glass — not a 384×272 stamp inside a tall absolute-inset bezel, not a
zoom host, not a centering slot.

Current ship: that restored presentation + live 384×272 WebGL backing
(#39 paint). Do not retry PNG poll, wrapper CSS transform on GL,
`drawImage` tall present, `readPixels` present, CSS 100% of a **tall
bezel** + clientWidth lie/unlock, unzoomed 384 letterbox in a tall
screen, bare zoom, or centered zoom slot. Do not print `PASS` from the
Plex gate.

Keep: PETSCII #32, unit-8 Play recycle, #41 no mid-play yank, build-id
chip, debug log off by default, Jiffy apply honesty.
