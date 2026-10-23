# Real-UI QA report (xdotool + desktop chrome)

Chromium under Xvfb; catalog typing via **xdotool** where noted; toolbar/hardware via real DOM clicks.

**Regenerate:** `npm run test:desktop-xdotool-extended`

_Last run: 2026-10-23T07:06:26.899Z_

## Summary

| ID | Result | Notes |
|----|--------|-------|
| catalog-search-fetch-autostart | **PASS** | {"beforeLib":1,"afterLib":2,"shot":11904,"head":"\n    ****  |
| cmd-hd-rom-unit9-layout | **PASS** | {"drive8":"1541","drive9":"CMD HD","traps":"disabled"} |
| cmd-hd-swap-button-ui | **PASS** | {"swapPass":true} |
| cmd-fd-ramlink-modes | SKIP (FD2000/4000 and RAMLink not modeled — see docs/CMD_SD2IEC_COMPATIBILITY.md) | FD2000/4000 and RAMLink not modeled — see docs/CMD_SD2IEC_COMPATIBILITY.md |
| cmd-plus-sd2iec-iec-map | **PASS** | {"8":"sd2iec","9":"cmdhd","10":"none","11":"none"} |
| demo-edge-of-disgrace-stock | **PASS** | {"frames":3,"glitch":false,"head":"J*)H\r ], ]P{JJJJ\r ]\nJP |
| demo-coma-light-13-stock | **PASS** | {"frames":2,"glitch":false,"head":"\n    **** COMMODORE 64 B |
| demo-uncensored-stock | SKIP (no catalog hit) | no catalog hit |
| demo-edge-of-disgrace-jiffy | **PASS** | {"frames":1,"glitch":false,"head":"              |
| demo-coma-light-13-jiffy | **PASS** | {"frames":1,"glitch":false,"head":"              |
| demo-uncensored-jiffy | SKIP (no catalog hit) | no catalog hit |
| autostart-floppy-past-ready | **PASS** |   LOADING
                        READY.
                    |
| freeze-ui-ar6 | **PASS** | {"head":" WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW\n    ACTION |
| freeze-ui-fc3 | **PASS** | {"head":"VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV\nVVVVVVVVV |
| freeze-ui-ss5 | **PASS** | {"head":"\nSUPER SNAPSHOT BY LMS TECH  (C)  1989,90\nSUPER S |

## Steps (per test)

### catalog-search-fetch-autostart — PASS

1. Power on desktop
2. Click Software toolbar (DOM)
3. xdotool: focus search, type query
4. Click Play on first hit
5. Wait autostart; verify library + CRT signal

```json
{
  "beforeLib": 1,
  "afterLib": 2,
  "shot": 11904,
  "head": "\n    **** COMMODORE 64 BASIC V2 ****\n\n 64K RAM SYSTEM  38911"
}
```

### cmd-hd-rom-unit9-layout — PASS

1. Settings: IEC #8 = 1541, #9 = CMD HD (C64 OS buyer guide layout)
2. Cold boot; verify vice_drive9_type = CMD HD (4844)
3. Tap CMD SWAP chip (short) — exchanges #8/#9

```json
{
  "drive8": "1541",
  "drive9": "CMD HD",
  "traps": "disabled"
}
```

### cmd-hd-swap-button-ui — PASS

1. Settings: IEC #8 = 1541, #9 = CMD HD (C64 OS buyer guide layout)
2. Cold boot; verify vice_drive9_type = CMD HD (4844)
3. Tap CMD SWAP chip (short) — exchanges #8/#9
4. Verify cmdSwapped flag

```json
{
  "swapPass": true
}
```

### cmd-fd-ramlink-modes — PASS

1. Documented MISSING in compatibility matrix; no VICE drive type wired

**Skip reason:** FD2000/4000 and RAMLink not modeled — see docs/CMD_SD2IEC_COMPATIBILITY.md

### cmd-plus-sd2iec-iec-map — PASS

1. Assign #8 SD2IEC, #9 CMD HD per C64 OS manual
2. Read persisted iecMap

```json
{
  "8": "sd2iec",
  "9": "cmdhd",
  "10": "none",
  "11": "none"
}
```

### demo-edge-of-disgrace-stock — PASS

1. Power on (stock KERNAL)
2. Open Software → search demo by name
3. Play first hit (online archive fetch + mount)
4. Sample CRT frames ~15s — expect motion, no KERNAL errors

```json
{
  "frames": 3,
  "glitch": false,
  "head": "J*)H\r ], ]P{JJJJ\r ]\nJPj x         \n            L3DLJDH\nH\u0018H%AH)5\n"
}
```

### demo-coma-light-13-stock — PASS

1. Power on (stock KERNAL)
2. Open Software → search demo by name
3. Play first hit (online archive fetch + mount)
4. Sample CRT frames ~15s — expect motion, no KERNAL errors

```json
{
  "frames": 2,
  "glitch": false,
  "head": "\n    **** COMMODORE 64 BASIC V2 ****\n\n 64K RAM SYSTEM  38911 BASIC BYTES FREE\n\nR"
}
```

### demo-uncensored-stock — SKIP

1. Power on (stock KERNAL)
2. Open Software → search demo by name
3. Play first hit (online archive fetch + mount)
4. Sample CRT frames ~15s — expect motion, no KERNAL errors

**Skip reason:** no catalog hit

### demo-edge-of-disgrace-jiffy — PASS

1. Power on (jiffy KERNAL)
2. Open Software → search demo by name
3. Play first hit (online archive fetch + mount)
4. Sample CRT frames ~15s — expect motion, no KERNAL errors

```json
{
  "frames": 1,
  "glitch": false,
  "head": "                  \n          o        \n  "
}
```

### demo-coma-light-13-jiffy — PASS

1. Power on (jiffy KERNAL)
2. Open Software → search demo by name
3. Play first hit (online archive fetch + mount)
4. Sample CRT frames ~15s — expect motion, no KERNAL errors

```json
{
  "frames": 1,
  "glitch": false,
  "head": "                  \n                  \n  "
}
```

### demo-uncensored-jiffy — SKIP

1. Power on (jiffy KERNAL)
2. Open Software → search demo by name
3. Play first hit (online archive fetch + mount)
4. Sample CRT frames ~15s — expect motion, no KERNAL errors

**Skip reason:** no catalog hit

### autostart-floppy-past-ready — PASS

1. Stock KERNAL, 1541 true emulation
2. playBytes boulder-dash.d64 autostart:true
3. Wait load window — screen must leave plain READY (game or LOAD path)

```json
"  LOADING\n                        READY.\n                        RUN\n\n\n\n\n\n\n\n\n\n\n\n\n\n                          \u0000   "
```

### freeze-ui-ar6 — PASS

1. Mount CRT via playBytes
2. Click hardware CART FZ (toolbar)
3. xdotool F1 in freezer

```json
{
  "head": " WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW\n    ACTION REPLAY PROFESSIONAL  "
}
```

### freeze-ui-fc3 — PASS

1. Mount CRT via playBytes
2. Click hardware CART FZ (toolbar)
3. Verify freezer/menu text on CRT

```json
{
  "head": "VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV\nVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV"
}
```

### freeze-ui-ss5 — PASS

1. Mount CRT via playBytes
2. Click hardware CART FZ (toolbar)
3. Verify freezer/menu text on CRT

```json
{
  "head": "\nSUPER SNAPSHOT BY LMS TECH  (C)  1989,90\nSUPER SNAPSHOT BY LMS TECH  (C"
}
```

