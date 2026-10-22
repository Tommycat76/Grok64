# Grok64 testing

## Unit tests

```bash
npm test
```

Includes `scripts/sd2iec-cmd.test.mjs` (SD2IEC DOS commands, uses `fake-indexeddb` in Node).

## CMD / SD2IEC browser smoke

Start the dev server (`sh startup.sh`), then:

```bash
npm run test:cmd-sd2iec
```

Uses headless Chromium. WebKit runs when host libraries are installed (`npx playwright install-deps`).

Optional C64 OS boot check: place Tom’s private v1.04 tree at `fixtures/c64os/part1-C64OS/` (gitignored) or set `GROK64_C64OS_FIXTURE`. Boot is reported as `optional` in `artifacts/cmd-sd2iec-e2e/results.json` (requires SD2IEC core recycle).

## UI layout screenshots

```bash
npm run test:ui-layout
# or
node scripts/ui-layout-qa.mjs http://127.0.0.1:8080/ --phase=after
```

Outputs under `docs/screenshots/{before,after}/` (no C64 OS screen content).
