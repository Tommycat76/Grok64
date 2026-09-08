# iOS CRT — locked GOOD (read this first)

**Mandatory first step for every CRT / CriOS / iPhone-bezel experiment:**
read this file, then `docs/IOS_CRT_KNOWN_FAILURES.md`.

Tom confirmed **SUCCESS** on real iPhone Chrome (CriOS). That wiring is
sacred. Do not thrash it.

---

## KNOWN GOOD

| Field | Value |
| --- | --- |
| Locked SHA | **`3f80fc8`** |
| PR | **#54** |
| Live routes hash at confirm | **`routes-DlWAL8fJ.js`** |
| Tom | **SUCCESS** — READY paints on CriOS, Jiffy good, Boulder Dash briefly played |

Cold boot on that SHA is **slow** but **eventually paints**: JiffyDOS V6.01
+ C-64 BASIC + READY, full-ish purple/blue CRT. Play-path issues after that
picture (phantom Space, splash remount, mute, wait copy) are **not** a
reason to retouch CRT paint.

Plex / Playwright / iPhone-UA Chromium green is **not** a PASS. Tom’s phone
is the only CRT PASS. Do **not** print `PASS` from a gate.

---

## Sacred wiring (do not change)

Treat CRT host files at `3f80fc8` as frozen. A follow-up PR may add a
**docs lock comment** only. If paint/host files change beyond that, **stop
and revert those hunks**.

Do **not** change anything that can regress CRT paint:

1. **`preserveDrawingBuffer` on iOS WebGL** (`preserveWebglBuffer` in
   `src/lib/emu/host.ts`).
2. **VICE owns backing size** — no `lockIosBacking`, no pre-size
   `this.width = 384` before `getContext`, no `remapViceViewport` revive.
3. **#14 / #18 / #39 host path** in `src/lib/emu/host.ts`:
   `preserveWebglBuffer`, `applyIosCrtStyle` glass fill.
4. **`ios-paint.ts` / `ios-present.ts` live-WebGL presentation** — no PNG
   mirror, no `drawImage` of GL, no `readPixels` present loop.
5. **`.g64-screen` 384:272 glass CSS** for iPhone CRT.

`AGENTS.project.md` points here. Any future CRT experiment must read this
first and **must not touch those paths without Tom**.

---

## What is allowed without Tom

Host/play/audio/UI work that **cannot** touch the list above:

- Autostart disarm / Space-as-C64-only / Reset ignore Space (#41 / #32).
- In-place unit-8 Play recycle (never WASM `destroyEmu` after READY) (#13).
- Splash remount guards (`powered` must not drop mid-play).
- CriOS `AudioContext` unlock / unmute (no paint-path change).
- A please-hold **DOM overlay** outside the canvas / WebGL host path
  (existing `.g64-boot` chip is the model — `pointer-events: none`, does
  not steal context or remount).

Keep locked elsewhere: PETSCII **#32**, unit-8 Play recycle, **#41** no
mid-play yank, tablet **#40** Android-only, build-id chip, debug log **off**.
