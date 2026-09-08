# iOS CRT — known failures (read this first)

## KNOWN GOOD (locked — do not thrash)

**Read `docs/IOS_CRT_LOCKED_GOOD.md` first** before any CRT experiment.

Tom **SUCCESS** on CriOS at **`3f80fc8`** (PR **#54**, live
`routes-DlWAL8fJ.js`): READY paints, Jiffy good, Boulder Dash briefly
played.

Sacred (must not change without Tom): `preserveDrawingBuffer` on iOS
WebGL; VICE owns backing size (no `lockIosBacking` / pre-size
`this.width = 384` before `getContext` / `remapViceViewport`); #14/#18/#39
host path in `src/lib/emu/host.ts` (`preserveWebglBuffer`,
`applyIosCrtStyle`); `ios-paint.ts` / `ios-present.ts` live-WebGL
presentation (no PNG mirror, no `drawImage`-GL, no `readPixels` present);
`.g64-screen` 384:272 glass CSS.

A follow-up may add a docs lock comment only. If those paint/host files
change beyond that, stop and revert.

---

**Mandatory first step for every CRT / CriOS / iPhone-bezel agent and every
follow-up prompt:** read `docs/IOS_CRT_LOCKED_GOOD.md`, then this file,
before proposing or shipping a paint path.

PR bodies and CRT prompts must say: **Read `docs/IOS_CRT_KNOWN_FAILURES.md` first.**

Ground truth is **Tom’s real iPhone Chrome (CriOS)**. Desktop Chromium, Plex
Playwright, Cursor-sandbox WebKit, and iPhone-UA spoofing are **not** PASS.
A green painted gate on Plex is a layout/hold check only. It has already gone
green while Tom’s phone went solid black (`main@8876d8a`, #47).

**Zero PASS without Tom.** Keep the always-visible build-id chip.

---

## Approaches that FAILED on Tom’s real iPhone

Do **not** re-try these without new evidence from the same phone (photo +
build id). “It is green on Plex” is not new evidence. Plex paint-count
is not Tom geometry (#50 / #9).

### 1. Continuous `toDataURL` / PNG poll / mirror overlay

Dead after play-recycle on real CriOS. Black CRT, memory leaks, watchdog
timeouts. Used to deadlock the old paint poll. Never stack
`screenshot.png`, paint-poll, or an empty 2D mirror on top of the live
VICE canvas.

### 2. CSS wrapper `scale()` / DPR canvas resize

`#43`: `scale(dpr)` on the WebGL canvas — CriOS **ignores transform** on
the GL layer (postage stamp).

`#44`: `384×272` CSS + `scale()` on `#grok64-player` — DOM
`getBoundingClientRect` fill **1.0**, painted picture still a stamp.
Tom’s photo: dark CRT flush **top-right** of the light-purple bezel
(L-shaped purple left+bottom). A GL-origin stamp in a tall buffer is
**bottom-left**. Both fail.

Growing the WebGL backing store / drawing buffer past native **384×272**
(CSS×DPR resize) is solid black. Reassigning `canvas.width` after VICE
has a context wipes CriOS.

### 3. `drawImage` of live WebGL every rAF into a **tall** 2D present (#46)

60fps copy of the GL canvas into a **bezel-sized** 2D bitmap. On CriOS:
OOM, solid black (~5s), then splash remount (~15s) because `powered` is
not persisted. `drawImage(webglCanvas)` is the resolve that kills the tab.

### 4. Desktop Chromium + iPhone UA DOM/wrapper fill ratios → **false green**

Wrapper rects and computed fill `1.00` passed while Tom saw a stamp.
Only **painted bbox + coverage** (and Tom’s phone) count. Do not claim
PASS from Plex Chromium, Playwright + CriOS UA, or sandbox WebKit.

### 5. Claiming PASS / shipping without Tom CriOS confirm

Not a paint approach — a process failure. If the phone is black, the
change is not a pass, even when CI/Plex/gate are green.

### 6. #47 — `readPixels` → 384×272 2D present + CSS `object-fit: fill` ~14fps

`main@8876d8a` / `routes-BggHfyUX.js`:

- Keep the GL canvas at native 384×272 CSS (VICE blit).
- `readPixels` the live 384×272 buffer at ~14fps into a **2D**
  `.g64-ios-present` canvas (not `drawImage`, not a tall bitmap).
- CSS `object-fit: fill` stretches that 2D layer over `.g64-screen`.
- Hidden until a “lit” copy so an empty 2D layer would not cover READY.

**Tom FAIL (live):** power → cold-start message → **solid black again**.
NOT a pass. The Plex painted gate stayed **false-green** vs real CriOS.

Do not revive a continuous (or “throttled”) GPU readback compositor.
Do not cover the live WebGL canvas with a 2D present layer.

### 7. #48 — live WebGL CSS 100% fill while lying `clientWidth`/`clientHeight` to 384×272

`main@6c10228` / `routes-Ds38oOKG.js` (Plex deploy of PR #48):

- Live VICE WebGL canvas only (no 2D present, no wrapper `scale()`).
- CSS `inset:0; width/height:100%` on `#grok64-player` and the GL canvas.
- `lockIosClientBox` kept `clientWidth`/`clientHeight`/`offsetWidth`/
  `offsetHeight` at **384×272** after GL existed, so RetroArch would
  still blit native while CSS stretched.

**Plex painted gate FAIL (exit 2)** vs `https://grok64.tomsprojects.cc/`:

- Layout OK (GL CSS fills bezel, no present canvas, compact boot chip).
- Session stayed powered.
- **Paint empty black** (`count:0`): READY no painted CRT; hold no
  painted CRT; “solid black after first paint”; boot→first CRT 20249ms
  (limit 18000) because chroma never appeared.

Do not ship CSS 100% + a 384×272 client-box lie as a CriOS fix.
The mismatch leaves a black or empty blit that neither Plex nor Tom
can see as painted phosphor. Do not re-lock those JS box getters to
384×272 after `getContext`.

### 8. #49 — unlock client box after GL + CSS 100% fill

`main@9c35eb7` / `routes-DwWw0zTW.js` (Plex deploy of PR #49):

- Same CSS 100% live-GL fill as #48.
- `clientWidth` unlocked after `getContext` so the JS box matched CSS
  (Plex measured **354×652**). Backing stayed 384×272.

**Plex painted gate FAIL (exit 2)** — **same empty black as #7**:

- Layout OK (unlocked clientWidth, CSS fills bezel, no present, session holds).
- **Paint `count:0`**: READY no painted CRT; hold no painted CRT;
  “solid black after first paint”; boot→first CRT ~20212ms.

Unlock did **not** restore paint. The **CSS 100% + clientWidth lie/unlock
family is dead** until Tom’s phone produces new evidence. Do not iterate
another variant of stretching the live GL canvas to the bezel via CSS
100% and client-box tricks.

### 9. #50 — letterbox claim failed on CriOS (postage stamp)

`main@5a43c67` / `routes-BPUU8W3r.js` (Plex deploy of the paint-first
native 384×272 + flex letterbox):

- Live VICE WebGL at **intrinsic 384×272 CSS** (the #39 paint path).
- Flex-center in `.g64-screen`. No `zoom`, no CSS 100% on GL, no
  clientWidth lie, no 2D present.
- Code review: canvas / `#grok64-player` stayed native CSS size only.

**Tom FAIL (CriOS photo):** paint EXISTS (purple VIC outer + dark indigo
inner) but the picture is a **tiny unreadable postage stamp** in the
large black bezel. VIC border only **left + bottom** (not a centered
letterbox that fills the bezel). Header showed `5a43c67` + PAL + MOUSE.

**Plex painted gate stayed false-green** (`0 failures` / paint count
`~853k`) vs Tom. **Plex paint-count ≠ Tom geometry.** A green chroma
count does not mean the framebuffer fills or centers the bezel on
real CriOS.

Do not ship another unzoomed 384×272 flex letterbox and call it a
fill. Do not treat Plex `count > 0` as geometry.

### 10. #51 — CSS `zoom` on non-GL `.g64-ios-zoom` enlarged stamp but did not fix offset/crop

`main@7d09f7a` / `routes-2Aufi9H1.js` (Plex deploy of PR #51; evolution
of #9 / #50):

- Keep live VICE WebGL at native 384×272 CSS + backing (#39/#50 blit).
- CSS `zoom` on `.g64-ios-zoom` only (contain-fit × device pixel
  ratio). No `transform:scale` on the GL canvas or `#grok64-player`.
- Flex-center the 384×272 host in `.g64-screen` and hope `zoom` updates
  used size so the expanded box recenters.

**Tom FAIL (CriOS photo after #51):** picture is **bigger than the #50
postage stamp** but geometry is still wrong. Dark navy content flush
**top-right** of the bezel; thick light-purple VIC border forming an
**L on left + bottom** only. Not centered. Not a full bezel fill.
Header: Grok64 + `7d09f7a` + NTSC + MOUSE. Also: CRT **black on boot
initially**, then this L-border after a Play attempt.

**Plex painted gate stayed false-green** with `zoom:3` (dpr=3 ×
contain-fit). **Plex `zoom:3` still ≠ Tom geometry.** A green chroma
count does not mean the zoomed box is centered on real CriOS.

Likely root: CSS `zoom` scales from the **default top-left origin**.
On CriOS the expanded used box is not re-centered in the tall bezel
(overflow-flex pins a corner → crop top+right → L-border). Do **not**
ship another un-centered zoom-from-default-origin variant without
fixing alignment.

### 11. #52 — centered zoom slot failed (CRT too small, stuck along the BOTTOM)

`main@156a07f` / `routes-D2Yf0JqE.js` (Plex deploy of PR #52; evolution
of the zoom/slot path #10 / #51):

- Keep live VICE WebGL at native 384×272 CSS + backing.
- CSS `zoom` on `.g64-ios-zoom` (contain-fit × dpr).
- A non-zoomed `.g64-ios-slot` sized to the post-zoom used box and
  absolutely placed at `(bezel − used) / 2` so overflow would be a
  symmetric center-fill crop (or a centered letterbox).

**Tom FAIL (CriOS photo after #52):** long black boot, then the CRT is
a **thin purple strip stuck along the BOTTOM** of the tall black bezel.
Too small. Not a centered letterbox. Not a bezel fill. Header:
Grok64 + green `156a07f` + PAL + MOUSE.

This is the same zoom/slot family as #10 / #51, not a new paint bug.
Plex geometry still ≠ Tom. **Strategy change:** stop inventing
zoom-v3 / slot-v2 / contain-fit / CSS-100% theories. **Restore the
last-good CRT layout** from before the #42 rewrite thrash (presentation
CSS + host present path at `ee0b445` / pre-`30d158a`), then re-apply
only non-layout locks.

### 12. #53 — restore pre-#42 **layout** (ee0b445 glass + CSS 100% of that glass) while keeping post-#42 paint stack → **solid black on CriOS**

`main@3dc22be` / `routes-BD6gfM9s.js` (Plex deploy of PR #53).
This is **not** `156a07f` (#52 bottom strip). Different build.

- Restored `ee0b445` presentation CSS: `.g64-screen` is
  `aspect-ratio: 384 / 272` glass; canvas / `#grok64-player` CSS
  `inset:0; width/height:100%` of **that** glass.
- Kept the post-#42 paint stack: pre-size canvas to 384×272 **before**
  `getContext`, `lockIosBacking` (frozen width/height getters),
  `remapViceViewport`. Live-webgl ios-paint (no PNG, no 2D present).
- **Tom FAIL (CriOS photo):** power-on → **solid black CRT**. Header
  chip `3dc22be` + PAL + MOUSE. Stick / FIRE / JUMP chrome rendered.
  No READY, no stamp, no L-border, no bottom strip — unpainted glass.

**Layout restore alone is insufficient.** CSS 100% of the glass plus
the #42 384-lock family is the same empty-black class as #7 / #8
(stretch a locked native FB). `#50`–`#52` still painted (wrong
geometry) because CSS stayed 1:1 with the locked 384×272 box.

**Strategy:** prefer **restore of the original simple CRT wiring** from
the pre-tablet / PR **#14–#18** era over inventing another path.
Forward thrash #42–#53 failed.

- `#14` `f948687`: `preserveDrawingBuffer` on iOS `getContext`. Root
  cause of the first blank CRT was #12 skipping that flag for VRAM.
- `#16`–`#18` `800b6e6`: auto READY (kick / watchdog; Tom: CRT good
  enough, BD ran). `#18` used a 2D VICE mirror — **do not restore
  that mirror** (known failure #1 after play-recycle / OOM).
- `#39` `79cb60b` fallback: live WebGL, never `getContext` from
  ios-paint, VICE owns backing size. Tom: Jiffy + screen works.
- Do **not** iterate #50–#53 zoom / slot / letterbox / CSS-100%-of-lock.

### 13. #54 Play path — Paradroid / Boulder Dash → Loading → black CRT → remount splash

`main@3f80fc8` / `routes-DlWAL8fJ.js` (live HEAD Tom photographed).

Cold boot on CriOS is **slow** but **eventually paints**: JiffyDOS V6.01
+ C-64 BASIC + READY, full-ish purple/blue CRT (Tom shot 2). **Do not
thrash that #54 host wiring** (`preserveDrawingBuffer`, VICE owns
backing, no `lockIosBacking`).

**Tom FAIL (Play, same build):** after READY, Play Paradroid (and
Boulder Dash) shows `Loading paradroidalldrives.d64…` → **black
stamp/CRT** (shot 3) → **whole app remounts to the power splash**.
No game. Unit-8 recycle / play-session is the killer. Cold-boot paint
speed is a separate secondary.

Archaeology (commits consulted):

- `#18` `800b6e6`: Tom said CRT good enough; Boulder Dash **loaded and
  ran**. Play after READY was **in-place** (`writeBootFile` /
  `swapBootDisk` + `resetEmu`) on the **same** WebGL canvas. Then
  crash/audio (#19), not a Play CRT death.
- `#19` `d5a20e7`: OOM after the #18 mirror — do **not** restore that
  2D mirror (known-failure #1).
- `#30` `ebd6332` / `c96aaa7`: Paradroid Play still used that in-place
  attach. Games ran.
- `#34` `b6f10e5` / `3eb5ea8`: WASM `recycleCore` only when SD2IEC
  owned unit 8 (DNP). After BASIC READY on a real 1541, Play still
  kept the canvas.
- `#37` `9038a00` / `f223f04`: **never hot-swap on CriOS** — every
  floppy Play calls `recycleCore` → `destroyEmu` → `el.innerHTML = ""`
  → **second VICE WASM**. That is the black CRT + splash remount
  (second core OOMs / React loses `powered`, which is not persisted).
- `#39` `79cb60b`: live-WebGL READY paint. Keep it.
- `#41` `ee0b445`: no mid-play yank back to BASIC READY. Keep it.

**Do not** “fix” Play by inventing another CRT compositor. Restore the
**#18 / #30 Play survival path**: after a live READY core exists,
recycle **unit 8 in-place** (real 1541 + disk + Autostart) on the
existing GL canvas. `plan.recycle` stays true on iPhone (never the
stale-session `hot-swap` log → DNP). WASM `destroyEmu` is only for a
cold core with no FS.

---

## Briefly WORKED (do not regress these unrelated wins)

These are not CRT-fill proofs. Do not break them while chasing the bezel.

- **JiffyDOS on tablet** — keep the apply path; do not hot-swap
  `vice_jiffydos` on CriOS (that reset drops unit 8).
- **#39 WebGL-visible path briefly painted READY** — later regressions
  (overlays, presents, scale) hid or killed it. Prefer showing the **live
  WebGL canvas itself**.
- **Always-visible build-id chip** — useful for cache checks. Keep it.

Locked, unrelated:

- PETSCII **#32** (Space) stays a C64 key — never host Reset / Start.
- Unit-8 floppy **Play recycles** on iPhone (never the `hot-swap` log →
  DNP). Recycle is **in-place** on a live READY core — must not destroy
  GL or remount the splash (#13).
- **#41** no mid-play yank back to BASIC READY.
- Debug log **off** by default (opt-in / `?debug=`).

---

## What a NEW approach must not be

Not 1, not 2, not 3, not 6, not 7, not 8, not 9, not 10, not 11, not 12,
not 13.

In particular:

- No PNG / `toDataURL` poll / `.g64-ios-mirror`.
- No `transform: scale(...)` on the GL canvas or `#grok64-player`.
- No DPR / bezel-sized WebGL backing resize (`canvas.width` assignment).
- No `drawImage` of the live WebGL canvas.
- No `readPixels` present loop (any fps) into a 2D overlay.
- No CSS 100% fill of a **tall full-bezel** `.g64-screen` + `clientWidth`
  **lie** (#7 / #48).
- No CSS 100% fill of a **tall full-bezel** `.g64-screen` + `clientWidth`
  **unlock** (#8 / #49).
- No further CSS-100% + client-box games that stretch live GL to the
  tall bezel.
- No unzoomed intrinsic-384×272 flex letterbox inside a tall
  absolute-inset `.g64-screen` (#9 / #50).
- No bare CSS `zoom` on `.g64-ios-zoom` from default origin without
  recentering the post-zoom used box (#10 / #51).
- No centered zoom slot / post-zoom used-size offset (#11 / #52).
- No zoom-v3 / slot-v2 / another contain-fit theory.
- No layout-only restore of `ee0b445` glass **on top of** the #42
  384-lock / `lockIosBacking` / `remapViceViewport` stack (#12 / #53).
- No Play-path **WASM recycle** after READY (`recycleCore` /
  `destroyEmu` / wipe `#grok64-player` / second VICE) — that is #13.
  Unit-8 1541 attach stays required; the **canvas/GL context** stays.

Current attempt after #54/#13 (this tree): keep the restored **#14/#18/#39
host wiring** that finally painted READY on `3f80fc8`. Play after READY
restores the **#18/#30 in-place floppy path** (same live WebGL canvas,
`attachAutostartDisk` + `prepareCore` + `autostartAfterReady`) so unit 8
is a real 1541 without destroying GL or remounting the splash. iPhone
`plan.recycle` stays true (never the `#37` `hot-swap` log → DNP). WASM
`recycleCore` only when there is no live VICE FS.

Why this and not 1–12:

- **Not 1.** Live WebGL only. No PNG / `toDataURL` / `#18` mirror poll.
- **Not 2 / #43 / #44.** No CSS `transform:scale` on the GL canvas or
  `#grok64-player`. Tablet-only transform is unchanged (Android).
- **Not 3 / #46.** No `drawImage` of live WebGL, no tall 2D present.
- **Not 6 / #47.** No `readPixels` present loop.
- **Not 7 / #48.** Not CSS 100% of a **tall bezel-sized** screen plus a
  384 clientWidth lie. `.g64-screen` is `aspect-ratio: 384 / 272`
  (the glass). Canvas CSS 100% fills **that** glass, not the tall bezel.
- **Not 8 / #49.** No clientWidth unlock-to-bezel. No tall CSS 100%.
- **Not 9 / #50.** Not a 384×272 canvas sitting in a tall absolute-inset
  `.g64-screen`. The screen itself is the 384:272 frame.
- **Not 10 / #51.** No CSS `zoom` on `.g64-ios-zoom`.
- **Not 11 / #52.** No centering slot, no post-zoom used-size offset.
- **Not 12 / #53.** Not a layout-only restore. The #42 pre-size /
  `lockIosBacking` / viewport-remap family is **removed**. VICE owns
  the backing store again (`#14`/`#18`/`#39` `preserveWebglBuffer`).
- **Not 13 / #54 Play.** Not another destroy-and-reboot after READY.
  Archaeology: `#18`/`#30` kept the canvas and games ran; `#37`
  WASM-recycle is the black CRT + splash remount. In-place unit-8
  attach is the restore, not a new paint theory.

No 2D present. Compact cold-start chip. Build-id chip stays visible.
Debug log off by default.

**Not a PASS** until Tom’s CriOS photo shows a readable, filled CRT.
Plex paint-count ≠ Tom geometry.

---

## Gate honesty

`scripts/crt-fill-gate.mjs` is a **painted-layout + session-hold** check
on Chromium-on-Plex (iPhone viewport + CriOS UA). It must stay honest:

- **First:** non-empty painted READY (`count > 0`). Solid black fails.
- **Plex paint-count ≠ Tom geometry.** #50 was `0 failures` / `~853k`
  chroma while Tom’s phone showed a postage stamp. A green count does
  not prove bezel fill or centering on CriOS.
- Fail Tom #44 top-right and GL-origin bottom-left stamps.
- Fail leftover 2D present/mirror covers and CSS 100% + client-box games.
- No `.g64-ios-zoom` CSS `zoom` and no `.g64-ios-slot` centering offset
  (#10 / #11).
- `.g64-screen` is `aspect-ratio: 384 / 272` (pre-#42 glass), not a
  tall absolute-inset bezel fill. Live GL CSS fills **that** glass.
- Host must not pre-size / freeze canvas width×height at 384×272
  before `getContext` (#12 / #53).
- Hold after first READY (no splash remount, no tab death).

A green gate is **not** a CriOS PASS. **Tom’s phone is the only PASS.**
