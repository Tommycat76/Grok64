# iOS CRT — known failures (read this first)

**Mandatory first step for every CRT / CriOS / iPhone-bezel agent and every
follow-up prompt:** read this file before proposing or shipping a paint path.

PR bodies and CRT prompts must say: **Read `docs/IOS_CRT_KNOWN_FAILURES.md` first.**

Ground truth is **Tom’s real iPhone Chrome (CriOS)**. Desktop Chromium, Plex
Playwright, Cursor-sandbox WebKit, and iPhone-UA spoofing are **not** PASS.
A green painted gate on Plex is a layout/hold check only. It has already gone
green while Tom’s phone went solid black (`main@8876d8a`, #47).

**Zero PASS without Tom.** Keep the always-visible build-id chip.

---

## Approaches that FAILED on Tom’s real iPhone

Do **not** re-try these without new evidence from the same phone (photo +
build id). “It is green on Plex” is not new evidence.

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
- Unit-8 floppy **Play recycles** on iPhone (never hot-swap → DNP).
- **#41** no mid-play yank back to BASIC READY.
- Debug log **off** by default (opt-in / `?debug=`).

---

## What a NEW approach must not be

Not 1, not 2, not 3, not 6.

In particular:

- No PNG / `toDataURL` poll / `.g64-ios-mirror`.
- No `transform: scale(...)` on the GL canvas or `#grok64-player`.
- No DPR / bezel-sized WebGL backing resize.
- No `drawImage` of the live WebGL canvas.
- No `readPixels` present loop (any fps) into a 2D overlay.

VICE still only **blits** when the JS-visible box is native **384×272**
(RetroArch sizes video from `clientWidth`). That constraint is handled by
**lying about `clientWidth` / `clientHeight` / `offsetWidth` /
`offsetHeight`**, and by locking `canvas.width` / `canvas.height` at
384×272 **before** `getContext`. It is **not** a reason to lock the CSS
layout box at 384×272 and then copy pixels into another canvas.

Current attempt after #47 (this tree): **live WebGL CSS 100% fill** —
the VICE canvas is the only picture; `#grok64-player` and the GL canvas
use layout `inset:0; width/height:100%` (not scale); backing + client
box stay 384×272; leftover 2D present/mirror nodes are stripped; the
cold-start overlay is a compact chip, not a full-bezel black sheet.
This is not 1 / 2 / 3 / 6.

If this also fails on Tom’s phone, add a new numbered item here **before**
the next experiment. Do not silently retry 1–3 or 6.

---

## Gate honesty

`scripts/crt-fill-gate.mjs` is a **painted-layout + session-hold** check
on Chromium-on-Plex (iPhone viewport + CriOS UA). It must stay honest:

- Painted bbox + coverage of the **live GL** picture, not wrapper fill.
- Fail 384×272 stamps (top-right or bottom-left) and solid black.
- Fail leftover 2D present/mirror covers.
- Hold after first READY (no splash remount, no tab death).

A green gate is **not** a CriOS PASS. **Tom’s phone is the only PASS.**
