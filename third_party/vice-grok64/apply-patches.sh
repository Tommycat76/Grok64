#!/usr/bin/env bash
set -euo pipefail
VICE_ROOT="${1:?vice-libretro path}"
PATCH_ROOT="$(cd "$(dirname "$0")" && pwd)"

cp "$PATCH_ROOT/vice/grok64_sd2iec.c" "$VICE_ROOT/vice/src/serial/grok64_sd2iec.c"
cp "$PATCH_ROOT/vice/grok64_sd2iec.h" "$VICE_ROOT/vice/src/serial/grok64_sd2iec.h"
cp "$PATCH_ROOT/libretro/grok64_exports.c" "$VICE_ROOT/libretro/grok64_exports.c"

FSDXX="$VICE_ROOT/vice/src/diskimage/fsimage-dxx.c"
if ! grep -q fsimage_dxx_fdc_error_for_gcr "$FSDXX"; then
  python3 <<PY
from pathlib import Path
p = Path("$FSDXX")
text = p.read_text()
needle = "static log_t fsimage_dxx_log = LOG_DEFAULT;\n\n"
insert = """static log_t fsimage_dxx_log = LOG_DEFAULT;

/* D64 error-info tail: byte 0 is used on some images; VICE read path treats 0 like OK. */
static fdc_err_t fsimage_dxx_fdc_error_for_gcr(fdc_err_t rf)
{
    if (rf == 0) {
        return CBMDOS_FDC_ERR_OK;
    }
    return rf;
}

"""
if needle not in text:
    raise SystemExit("fsimage-dxx.c layout changed")
text = text.replace(needle, insert, 1)
old = "                            rf = fsimage->error_info.map[sectors];\n"
new = old + "                            rf = fsimage_dxx_fdc_error_for_gcr(rf);\n"
if old not in text:
    raise SystemExit("fsimage-dxx GCR rf assignment not found")
text = text.replace(old, new, 1)
p.write_text(text)
PY
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
