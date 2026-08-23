# Grok64 architecture

Recovered from the production bundle (2026).

## Boot flow

1. Splash → user taps power (`pointerdown` + `touchstart` + `click` for Android WebView).
2. `powerOn()` → `bootUrl(blank.d64, WORK DISK.D64, { autostart: false, title: BASIC })`.
3. `playLock` / `ignoreStart` stay set while cold start is in flight.
4. Recover-boot **must skip** if a cold start is already in flight.
5. After ~2s, blue READY. Stick shown only when not `booting`.

## Input

- Single player 0 only (`Grok64 Touch` fake pad).
- `vice_joyport` from store `joyPort` (1 or 2).
- FIRE = PAD.B only.
- Keyboard: C64 layout dispatched as KeyboardEvents into the player.

## Disk / catalog

- `searchCatalog({ query, kind })` → `{ hits, a64 }`
- `listRelease(hit)` → files in a release
- `downloadCatalog({ name, url, a64 })` → `{ name, base64 }`
- `pinPlayable` puts Boulder Dash First Star first
- `playBuffer` → `detectJoyPort(title)` → `setJoyPort` → hot-swap or full boot

## Persistence

- IndexedDB `grok64` / `files` + `states`
- Settings: zustand persist `grok64-settings` v3
- Work disk written back from VICE FS on an interval and on pause
