# GEOS / Wheels disk images (not in git)

Place **your own** GEOS 2.0 or **Wheels 64** boot `.d64` here for local play and QA. Grok64 does not ship commercial GEOS/Wheels binaries.

## Wheels 64 (Maurice Randall / Click Here Software)

Wheels is the GEOS 2.0 successor. Grok64 enables **1351 mouse**, **1541-II on unit 8**, and bumps **REU to at least 512K** (defaults to **2 MB** when REU was off) when the filename contains `wheels`.

### Where to obtain a disk image

1. **Click Here / cbmfiles.com** — GEOS and Wheels were announced for free download once copy protection was removed; check [cbmfiles.com](https://cbmfiles.com/) GEOS section for `Wheels 64` when listed.
2. **Commodore.software** — [Wheels 64 v4.4 (Dmackey fix)](https://commodore.software/downloads/download/436-geos-upgrades/11894-wheels-64-v4-4-fixed-dmackey) (registration may be required).
3. **CSDb / Arnold / pokefinder** — search `Wheels 64` or `Wheels64.d64` on [CSDb](https://csdb.dk/), `ftp://arnold.c64.org/`, or [pokefinder.org](https://ftp.pokefinder.org/) (availability varies).
4. **Your original media** — transfer with a KryoFlux/OpenCBM setup; name the file with `wheels` in the name (e.g. `Wheels64_v4.4.d64`).

### Suggested filename

```
private-c64/geos/Wheels64_v4.4.d64
```

Standard **GEOS 2.0** for regression:

```
fixtures/geos/GEOS64_2.0.d64   # via npm run fetch-fixtures
```

### QA

```bash
# optional: point at this folder
export GROK64_GEOS_DIR=/workspace/private-c64/geos
export GROK64_WHEELS_DIR=/workspace/private-c64/geos

npm run test:desktop-xdotool-wheels
npm run test:desktop-geos
```

Or drop a one-off download:

```bash
GROK64_WHEELS_URL='https://…/Wheels64.d64' node scripts/fetch-fixtures.mjs
```

(`fetch-fixtures` only fetches Wheels when `GROK64_WHEELS_URL` is set.)
