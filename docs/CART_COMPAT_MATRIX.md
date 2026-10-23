# Cartridge compatibility matrix (Grok64)

Automated **real-UI** runs: Chromium under Xvfb with **xdotool** host keys for freezer carts (Action Replay F1, hardware freeze button). Each CRT is exercised with **stock KERNAL** and **JiffyDOS** (synthetic 8K ROM pair in Settings).

**Fixtures:** Internet Archive [C64-CRT-Collection](https://archive.org/details/C64-CRT-Collection) via `node scripts/fetch-fixtures.mjs`.

**Regenerate:** `npm run test:desktop-xdotool-cart-matrix`

_Last run: 2026-10-23T07:19:27.996Z_

## Pass / fail (per cart × KERNAL)

| Cart | Stock KERNAL | JiffyDOS | Jiffy hardware note | Stock detail | Jiffy detail |
|------|--------------|----------|---------------------|--------------|--------------|
| Super Snapshot v5.00 NTSC | PASS | PASS | incompatible (Jiffy suppressed when cart loaded) | ok | ok |
| Super Snapshot v4.0 NTSC | PASS | PASS | incompatible (Jiffy suppressed when cart loaded) | ok | ok |
| Epyx FastLoad v1 | **FAIL** | PASS | redundant | game | ok |
| Action Replay v6.0 PAL | **FAIL** | **FAIL** | caution | detect | detect |
| Action Replay v5.0 PAL | **FAIL** | **FAIL** | caution | detect | detect, jiffy |
| Action Replay MK4 1988 PAL | **FAIL** | **FAIL** | caution | detect | detect |
| Final Cartridge III v1 | **FAIL** | **FAIL** | compatible | detect | detect |
| Final Cartridge II 1987 | **FAIL** | **FAIL** | caution | boot, detect, menu | boot, detect, menu |
| Final Cartridge I v1 1986 | **FAIL** | **FAIL** | caution | boot, detect, menu | boot, detect, menu |
| KCS Power Cartridge 1985 v1 | **FAIL** | **FAIL** | caution | detect, game | detect |
| Warp Speed v1 1987 | **FAIL** | PASS | caution | game | ok |
| EasyFlash (macks-easyflash) | PASS | PASS | caution | ok | ok |
| Retro Replay | SKIP (missing fixture) | SKIP (missing fixture) | caution |  |  |
| Expert Cartridge | SKIP (missing fixture) | SKIP (missing fixture) | caution |  |  |
| Simons' BASIC | SKIP (missing fixture) | SKIP (missing fixture) | compatible |  |  |
| Magic Desk | SKIP (missing fixture) | SKIP (missing fixture) | compatible |  |  |

## Checks (each row)

| Check | Meaning |
|-------|---------|
| boot | Cart mounts; screen leaves plain READY |
| detect | `fastLoadCart` kind matches catalog |
| menu | Title/menu regex or non-trivial boot text |
| freeze | Hardware freeze opens freezer UI (where applicable) |
| resume | `cartReset` returns to runnable state |
| jiffy | `jiffyLive` matches hardware suppress/warn rules |
| game | Boulder Dash load through cart fast-load path (stock rows) |

## Missing public fixtures

These catalog entries need a CRT added under `fixtures/carts/` (not in the IA zip used here):

- **Retro Replay** (`retro-replay.crt`) — CRT not in C64-CRT-Collection zip — add fixture manually
- **Expert Cartridge** (`expert.crt`) — Not in public IA zip
- **Simons' BASIC** (`simons-basic.crt`) — Not in public IA zip
- **Magic Desk** (`magic-desk.crt`) — Not in public IA zip

## Source images

| Fixture | Archive path (from `.source.txt`) |
|---------|-------------------------------------|
| `ss5.crt` | IA zip match: `/Super_Snapshot_v5\.00_1990_NTSC/i` |
| `ss4.crt` | IA zip match: `/Super_Snapshot_v4\.0_1989_NTSC/i` |
| `epyx-fastload.crt` | IA zip match: `/Epyx_FastLoad_1984_v1/i` |
| `ar6.crt` | IA zip match: `/Action_Replay_V6\.0_6\.0_1989_PAL/i` |
| `ar5.crt` | IA zip match: `/Action_Replay_V5\.0_5\.0_1988_PAL\.crt$/i` |
| `ar4.crt` | IA zip match: `/Action_Replay_MK4_1988_PAL/i` |
| `fc3.crt` | IA zip match: `/Final_Cartridge_3_1987-09_v1/i` |
| `fc2.crt` | IA zip match: `/Final_Cartridge_2_1987\.crt$/i` |
| `fc1.crt` | IA zip match: `/Final_Cartridge_1_v1_1986/i` |
| `kcs-power.crt` | IA zip match: `/KCS_Power_Cartridge_1985_v1/i` |
| `warp-speed.crt` | IA zip match: `/WarpSpeed_v1_1987/i` |
| `easyflash.crt` | IA zip match: `/macks-easyflash/i` |
