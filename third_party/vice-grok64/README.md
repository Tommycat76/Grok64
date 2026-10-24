# Grok64 custom vice-libretro (WASM)

Builds `vice_x64sc_grok64` with:

- `grok64_sd2iec_*` IEC device hooks (imports to JS host in `src/lib/emu/grok64-vice-bridge.ts`)
- `grok64_c64_read` / `grok64_c64_write` for test/screen helpers
- Stock VICE features unchanged (SID, REU, carts, drive CPUs)

## Build (Linux + Emscripten)

```bash
./third_party/vice-grok64/build.sh
```

Outputs copy to `public/system/vice/emulatorjs/data/cores/`:

- `vice_x64sc_grok64-wasm.js`
- `vice_x64sc_grok64-wasm.data`
- `vice_x64sc_grok64-wasm.wasm` (if split)

Enable in the app:

```bash
VITE_GROK64_VICE_DATAPATH=/system/vice/emulatorjs/data VITE_GROK64_VICE_CORE=grok64 npm run dev
```

Until the blob is built, Grok64 uses stock `vice_x64sc` from the CDN plus the JS IEC layer (`attachGrok64Sd2iec` / `tickGrok64Iec`).
