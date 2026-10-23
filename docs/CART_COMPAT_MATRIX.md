# Cartridge compatibility matrix (Grok64)

Automated **real-UI** runs: Chromium under Xvfb with **xdotool** host keys for freezer carts (Action Replay F1, hardware freeze button). Each CRT is exercised with **stock KERNAL** and **JiffyDOS** (synthetic 8K ROM pair in Settings).

**Fixtures:** Internet Archive [C64-CRT-Collection](https://archive.org/details/C64-CRT-Collection) via `node scripts/fetch-fixtures.mjs`.

**Regenerate:** `npm run test:desktop-xdotool-cart-matrix`

_Last run: 2026-10-23T12:58:35.946Z_

## Pass / fail (per cart × KERNAL)

| Cart | Stock KERNAL | JiffyDOS | Jiffy hardware note | Stock detail | Jiffy detail |
|------|--------------|----------|---------------------|--------------|--------------|
| Super Snapshot v5.00 NTSC | PASS | PASS | incompatible (Jiffy suppressed when cart loaded) | ok | ok |
| Super Snapshot v4.0 NTSC | PASS | PASS | incompatible (Jiffy suppressed when cart loaded) | ok | ok |
| Epyx FastLoad v1 | PASS | PASS | redundant | ok | ok |
| Action Replay v6.0 PAL | PASS | PASS | caution (Jiffy suppressed when cart loaded) | ok | ok |
| Action Replay v5.0 PAL | PASS | PASS | caution (Jiffy suppressed when cart loaded) | ok | ok |
| Action Replay MK4 1988 PAL | PASS | PASS | caution (Jiffy suppressed when cart loaded) | ok | ok |
| Final Cartridge III v1 | PASS | PASS | compatible | ok | ok |
| Final Cartridge II 1987 | SKIP (FC I/II menu not reliable in VICE x64sc matrix (FC3 row covers Final Cartridge family)) | SKIP (FC I/II menu not reliable in VICE x64sc matrix (FC3 row covers Final Cartridge family)) | caution |  |  |
| Final Cartridge I v1 1986 | SKIP (FC I/II menu not reliable in VICE x64sc matrix (FC3 row covers Final Cartridge family)) | SKIP (FC I/II menu not reliable in VICE x64sc matrix (FC3 row covers Final Cartridge family)) | caution |  |  |
| KCS Power Cartridge 1985 v1 | PASS | PASS | caution | ok | ok |
| Warp Speed v1 1987 | PASS | PASS | caution | ok | ok |
| EasyFlash (macks-easyflash) | PASS | PASS | caution | ok | ok |
| Retro Replay | PASS | PASS | caution | ok | ok |
| Expert Cartridge | PASS | PASS | caution | ok | ok |
| Simons' BASIC | PASS | PASS | compatible | ok | ok |
| Magic Desk | PASS | PASS | compatible | ok | ok |

## Grok64 autostart vs cart boot-sector

Floppy Play uses VICE `LOAD"*",8,1`; **cart Play must not**. Some carts (e.g. **Super Snapshot v5** §11) perform their own **track 1 / sector 0** auto-boot via IEC — that is real hardware behavior and is **not** a Grok64 regression. See **`docs/CART_BOOT_AUTOSTART.md`**.

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
| `retro-replay.crt` | IA zip match: `/superfluid-0\.8-rr_menu|retro-replay/i` |
| `expert.crt` | IA zip match: `/Expert\.crt/i` |
| `simons-basic.crt` | IA zip match: `/SIMONBAS/i` |
| `magic-desk.crt` | IA zip match: `/magic_desk/i` |
