# Disk mount policy (Tom)

Grok64 **never** auto-types **`LOAD"*",8,1`** — with or without a cartridge. VICE `vice_autostart` must not be used to load the first file on a disk.

## Floppy Play (`.d64` / `.d81`)

1. Attach the image on **unit 8** with **true drive** emulation.
2. **Hard reset** to **READY** (like closing the lid after inserting a disk).
3. Optionally type **`LOAD"$",8`** so the directory appears on the CRT (and in QA).
4. User picks a program from the listing or from the library UI.

Multi-game disks must not auto-run `*` — many disks contain several games.

## Named file Play

When the user (or catalog) names a specific file (`.prg`, `.p00`, or a known boot name like **`GEOS`** / **`RBOOT`** on a system disk), Grok64 may type **`LOAD"<name>",8,1`** and **`RUN`** — never `*`.

GEOS / Wheels one-click Play uses **`geosBootLoadCandidates()`** (named files only).

## Cartridges

Cart boot never uses Grok64 floppy autostart. Cart firmware may access the drive (e.g. Super Snapshot §11 boot sector) — see **`docs/CART_BOOT_AUTOSTART.md`**.

## QA

`grok64FloppyAutostartPoison()` flags KERNAL **`LOAD"*",8,1`** on screen (wrapper bug), not cart IEC or **`LOAD"$"`** directory listings.
