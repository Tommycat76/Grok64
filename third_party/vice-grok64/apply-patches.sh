#!/usr/bin/env bash
set -euo pipefail
VICE_ROOT="${1:?vice-libretro path}"
PATCH_ROOT="$(cd "$(dirname "$0")" && pwd)"

cp "$PATCH_ROOT/vice/grok64_sd2iec.c" "$VICE_ROOT/vice/src/serial/grok64_sd2iec.c"
cp "$PATCH_ROOT/vice/grok64_sd2iec.h" "$VICE_ROOT/vice/src/serial/grok64_sd2iec.h"
cp "$PATCH_ROOT/libretro/grok64_exports.c" "$VICE_ROOT/libretro/grok64_exports.c"

# D64 error info goes through stock VICE (fsimage-probe.c / fsimage-dxx.c / gcr.c) untouched.
# Trees built from an earlier script carry an fsimage-dxx.c edit; restore the stock file.
FSDXX="$VICE_ROOT/vice/src/diskimage/fsimage-dxx.c"
if grep -q fsimage_dxx_fdc_error_for_gcr "$FSDXX"; then
  git -C "$VICE_ROOT" checkout -- vice/src/diskimage/fsimage-dxx.c
fi

# A configured 1541 must not be flipped to 1541-II (each type set resets the drive CPU),
# and JiffyDOS must reach it through DosName1541 as well as DosName1541ii.
if ! grep -q "Grok64: a configured 1541" "$VICE_ROOT/libretro/libretro-core.c"; then
  git -C "$VICE_ROOT" apply "$PATCH_ROOT/patches/libretro-keep-1541-drive.patch"
fi

# JiffyDOS on without a JiffyDOS 1571/1581 ROM must leave that drive on stock DOS, not unload its ROM.
if ! grep -q "Grok64: a drive without its JiffyDOS ROM" "$VICE_ROOT/retrodep/ui.c"; then
  git -C "$VICE_ROOT" apply "$PATCH_ROOT/patches/libretro-jiffy-drive-rom-optional.patch"
fi

# Makefile.x64sc
if ! grep -q grok64_sd2iec "$VICE_ROOT/Makefile.x64sc"; then
  sed -i 's|$(EMU)/serial/fsdrive.c|\\$(EMU)/serial/fsdrive.c \\\n    $(EMU)/serial/grok64_sd2iec.c \\|' "$VICE_ROOT/Makefile.x64sc"
fi
if ! grep -q grok64_exports "$VICE_ROOT/Makefile.common"; then
  sed -i 's|libretro-glue.c|\\libretro-glue.c \\\n\t$(CORE_DIR)/libretro/grok64_exports.c \\|' "$VICE_ROOT/Makefile.common"
fi

# serial-iec-bus.c
BUS="$VICE_ROOT/vice/src/serial/serial-iec-bus.c"
if ! grep -q grok64_sd2iec "$BUS"; then
  sed -i 's|#include "types.h"|#include "types.h"\n#ifdef GROK64_SD2IEC\n#include "grok64_sd2iec.h"\n#endif|' "$BUS"
  python3 <<'PY'
from pathlib import Path
import re
p = Path("$BUS".replace("$BUS", ""))
PY
fi
