# Grok64 project instructions

## iOS CRT (P0)

**Read `docs/IOS_CRT_KNOWN_FAILURES.md` first** before any iPhone CRT,
CriOS paint, bezel-fill, or “READY is black” work.

Do not retry the failed approaches listed there (1–13) without new evidence
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
**thin purple strip along the BOTTOM** of the tall bezel (`#11`). `#53`
(`3dc22be` / `BD6gfM9s`) restored `ee0b445` **layout** (glass + CSS 100%
of that glass) while keeping the post-#42 384-lock paint stack — Tom
CriOS **solid black** (`#12`). Layout restore alone is insufficient.

**Prefer restore of the original simple CRT wiring** from PR **#14–#18**
(`preserveDrawingBuffer`, VICE owns backing, CSS 100% of the 384:272
glass, auto READY kick) over inventing a new scale / zoom / CSS-100% /
slot theory. Fall back to `#39` ~`79cb60b` (Tom: screen works) if that
era is entangled. Do **not** iterate #50–#53.

Current ship: that restored **host** path + live WebGL presentation
(ios-paint never `getContext`; no `#18` mirror / PNG poll). Keep the
384:272 `.g64-screen` glass. After READY, Play recycles **unit 8
in-place** on the live canvas (`#18`/`#30`) — never WASM
`destroyEmu` / splash remount (`#13`). Do not retry PNG poll, wrapper
CSS transform on GL, `drawImage` tall present, `readPixels` present,
CSS 100% of a **tall bezel** + clientWidth lie/unlock, unzoomed 384
letterbox in a tall screen, bare zoom, centered zoom slot,
layout-only-on-#42-lock, or Play-path core destroy after READY. Do not
print `PASS` from the Plex gate.

Keep: PETSCII #32, unit-8 Play recycle (**in-place** on a live READY
core), #41 no mid-play yank, tablet #40 (Android only), build-id chip,
debug log off by default, Jiffy apply honesty — unless a lock fights
paint; then prefer paint.
