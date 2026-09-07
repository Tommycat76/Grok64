# Grok64 project instructions

## iOS CRT (P0)

**Read `docs/IOS_CRT_KNOWN_FAILURES.md` first** before any iPhone CRT,
CriOS paint, bezel-fill, or “READY is black” work.

Do not retry the failed approaches listed there (1–10) without new evidence
from Tom’s real iPhone. Plex / Playwright / iPhone-UA Chromium green is
**not** a PASS. Tom’s phone is the only CRT PASS.

`#47` was a **false green**. `#48` CSS 100% + **lie** `clientWidth` painted
empty black (`#7`). `#49` CSS 100% + **unlock** `clientWidth` painted the
**same empty black** (`#8`). `#50` native 384×272 + flex letterbox painted
on Plex (`~853k`) but Tom’s CriOS was a **postage stamp** (border only L+B)
— **Plex paint-count ≠ Tom geometry** (`#9`). `#51` CSS `zoom` on
`.g64-ios-zoom` enlarged the stamp (`7d09f7a` / `2Aufi9H1`) but left it
**top-right flush / purple L left+bottom** — **Plex `zoom:3` ≠ Tom
geometry** (`#10`). The CSS-100% + clientWidth family is **dead**. Do not
retry an unzoomed intrinsic-384 letterbox. Do not ship another un-centered
zoom-from-default-origin variant.

Current ship: live 384×272 WebGL + CSS `zoom` on the non-GL `.g64-ios-zoom`
host, centered by a non-zoomed `.g64-ios-slot` at the post-zoom used-size
offset. Do not retry PNG poll, wrapper CSS transform on GL, `drawImage`
tall present, `readPixels` present, CSS 100% + lie/unlock, or bare zoom
without a recenter. Do not print `PASS` from the Plex gate.

Keep: PETSCII #32, unit-8 Play recycle, #41 no mid-play yank, build-id
chip, debug log off by default.
