# Multi-SID on Grok64 (EmulatorJS / libretro VICE)

## What libretro documents

Per [Libretro VICE core options](https://docs.libretro.com/library/vice/):

| Option | Purpose |
|--------|---------|
| `vice_sid_model` | Primary chip (6581 / 8580 / default) |
| `vice_sid_extra` | **Second** SID base address (`disabled`, `0xd420`, `0xd500`, `0xde00`, `0xdf00`) |
| `vice_sid_model2` | Model for 2nd SID (when exposed by core) |

There is **no** documented `vice_sid_extra2` or third-SID address in libretro VICE. Grok64 therefore exposes **one** extra SID in Settings and gates off a third-SID UI (`src/lib/emu/vice-sid-cap.ts`).

## Runtime verification

```bash
npm run test:vice-sid-probe
```

Writes `artifacts/vice-sid-probe/report.json` with `runtimeViceOpts()` after applying stereo layout. Expect `vice_sid_extra` = `0xde00` when honored.

## Defaults

Stock behavior matches the published single-SID build: `sid2Address` and `sid3Address` default to `disabled` in persisted settings.
