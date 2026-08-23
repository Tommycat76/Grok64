# Grok64 Architecture Notes

Reconstructed from the build conversation (2026).

## Boot flow

1. Splash → user taps power (`pointerdown` + `touchstart` + `click` for Android WebView).
2. `powerOn()` → `startWithUrl(blank.d64)` → EmulatorJS `startOnLoad`.
3. `bootKickRef.current = true` while cold start is in flight.
4. `recoverBoot` **must skip** if `bootKickRef.current` (prevents double-boot race that left powered=true / dead core).
5. After ~2s, blue READY. BASIC screen; TouchControls shown only when not `booting`.

## Input model

- Single player 0 only.
- `vice_joyport` / `plugJoysticks` / `viceJoyOptions` set from store `joyPort` (1 or 2).
- FIRE maps only to assigned port button bit.
- Future: tap-to-direction on stick base (8-way digital pulse) + existing drag analog; higher-contrast stick graphics.

## Disk / catalog

- `searchClassics` (count ~16) + IA identifiers.
- `pinPlayable` puts Boulder Dash First Star first.
- `isJunkRelease` / SKIP regex: construction, kit, trainer, awally, etc.
- `playBuffer` → `detectJoyPort(title)` → `setJoyPort` → hot-swap or full boot.

## Layout

```css
.g64-app[data-device="tablet"] .g64-controls { /* relative flow under CRT */ }
.g64-app[data-kb="true"] /* keyboard dock under stick */
.g64-stage { min-height: 200px; }
.g64-screen { min-height: 160px; }
```

Phone: absolute overlay style when kb closed. Tablet: use extra vertical space, no stick under kb overlap.

## Debug API

`window.__g64` exposes roughly: `joyPort`, `fire`, `title`, `shot()` for canvas/VICE framebuffer checks.
