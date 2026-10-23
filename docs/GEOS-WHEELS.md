# GEOS 2.0 and Wheels 64 in Grok64

## Wheels (GEOS successor)

**Wheels 64** (Maurice Randall / Click Here Software) is treated like GEOS for boot: unit **8** as **1541-II**, **1351 mouse** on, `LOAD"*",8,1` then `RUN`. Wheels additionally requires **REU ≥ 512K**; if REU is off or 256K, Grok64 turns on **2 MB REU** automatically when the disk filename contains `wheels`.

Drive types in the UI (1541, 1571, 1581, CMD HD, SD2IEC on other units) are unchanged; Wheels’ extra drivers are inside the Wheels kernel once booted.

### Get a disk image

See [`private-c64/geos/README.md`](../private-c64/geos/README.md). Grok64 does **not** commit Wheels binaries. Suggested layout on your Commodore box / dev VM:

```text
/workspace/private-c64/geos/Wheels64_v4.4.d64
```

Optional download when you have a direct URL:

```bash
GROK64_WHEELS_URL='https://example/Wheels64.d64' node scripts/fetch-fixtures.mjs
```

### Hands-on verification (desktop 1280×800)

1. Power on Grok64 (desktop layout).
2. Open **Software** → **Library** (or drag the `.d64` onto the app).
3. Add `Wheels64_….d64` if needed; tap **Play** on that entry (or use **Run saved** — Wheels is preferred over GEOS when both are saved).
4. Confirm toast **“REU on for Wheels (512K+)”** if REU was off.
5. Confirm **MOUSE** chip is active; wait for **Loading Wheels…** (about one minute).
6. You should reach the **Wheels dashboard** (graphical). Move the pointer over the CRT — menus and icons should respond like GEOS.

Settings check: **Machine → REU** should show **2 MB** (or your higher setting if already enabled).

### Automated QA (xdotool gate)

With a valid Wheels `.d64` in `private-c64/geos` or `fixtures/geos`:

```bash
npm run test:desktop-xdotool-wheels
```

Without a disk, the script **skips** (exit 0) and writes `artifacts/desktop-xdotool-wheels-qa/results.json`.

Standard GEOS 2.0 smoke (Archive.org fixture):

```bash
GROK64_GEOS_DIR=fixtures/geos npm run test:desktop-geos
```
