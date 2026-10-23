# Disk mount policy (Tom)

Grok64 **never** auto-types **`LOAD"*",8,1`** — with or without a cartridge. VICE `vice_autostart` must not be used to load the first file on a disk.

## Floppy Play (`.d64` / `.d81`)

1. Attach the image on **unit 8** with **true drive** emulation.
2. **Hard reset** to **bare READY** (like closing the lid after inserting a disk).
3. User types **`LOAD"$",8`** or picks a program from the library UI when they want a directory.
4. Named one-click Play may type **`LOAD"<file>",8,1`** — never `*` and never auto-typed on mount alone.

Multi-game disks must not auto-run `*` — many disks contain several games.

## Named file Play

When the user (or catalog) names a specific file (`.prg`, `.p00`, or a known boot name like **`GEOS`** / **`RBOOT`** on a system disk), Grok64 may type **`LOAD"<name>",8,1`** and **`RUN`** — never `*`.

GEOS / Wheels one-click Play uses **`geosBootLoadCandidates()`** (named files only).

## Cartridges

Cart boot never uses Grok64 floppy autostart. Cart firmware may access the drive (e.g. Super Snapshot §11 boot sector) — see **`docs/CART_BOOT_AUTOSTART.md`**.

## QA

`grok64FloppyAutostartPoison()` flags KERNAL **`LOAD"*",8,1`** on screen (wrapper bug), not cart IEC or **`LOAD"$"`** directory listings.
