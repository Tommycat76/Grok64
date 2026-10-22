#!/usr/bin/env bash
# Build vice_x64sc_grok64 for Grok64 (Emscripten 3.1.74, EmulatorJS RetroArch link).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EMS="${ROOT}/.emsdk"
VICE="${ROOT}/.build/vice-libretro"
RA="${ROOT}/.build/ejs-compile/RetroArch"
OUT="${ROOT}/public/system/vice/emulatorjs/data/cores"

source "${EMS}/emsdk_env.sh"

bash "${ROOT}/third_party/vice-grok64/apply-patches.sh" "${VICE}" 2>/dev/null || true

cd "${VICE}"
emmake make clean EMUTYPE=x64sc
emmake make -j"$(nproc)" platform=emscripten EMUTYPE=x64sc

mkdir -p "${RA}/emulatorjs"
cp "${VICE}/vice_x64sc_libretro_emscripten.bc" "${RA}/libretro_emscripten.a"
cp "${ROOT}/third_party/vice-grok64/grok64_library.js" "${RA}/emulatorjs/grok64_library.js"

MAKEFILE="${RA}/Makefile.emulatorjs"
if ! grep -q '_grok64_sd2iec_attach' "${MAKEFILE}"; then
  sed -i 's|_ejs_get_controller_port_info|_ejs_get_controller_port_info,_grok64_sd2iec_attach,_grok64_sd2iec_poll,_grok64_c64_read,_grok64_c64_write|' "${MAKEFILE}"
fi

cd "${RA}"
emmake make -f Makefile.emulatorjs HAVE_7ZIP=1 HAVE_CHD=1 HAVE_THREADS=0 PTHREAD_POOL_SIZE=0 ASYNC=0 \
  HAVE_OPENGLES3=1 STACK_SIZE=4194304 INITIAL_HEAP=134217728 HAVE_AL=0 HAVE_RWEBAUDIO=1 LIGHT_DEBUG=0 \
  TARGET=vice_x64sc_libretro.js -j"$(nproc)"

mkdir -p "${OUT}"
SEVEN_ZA="${ROOT}/node_modules/7zip-bin/linux/x64/7za"
chmod +x "${SEVEN_ZA}" 2>/dev/null || true
STOCK="${ROOT}/package"
"${SEVEN_ZA}" a -t7z "${OUT}/vice_x64sc-wasm.data" \
  "${RA}/vice_x64sc_libretro.wasm" "${RA}/vice_x64sc_libretro.js" \
  "${STOCK}/license.txt" "${STOCK}/core.json" "${STOCK}/reports/vice_x64sc.json"

cp -f "${OUT}/vice_x64sc-wasm.data" "${OUT}/vice_x64sc_grok64-wasm.data"
echo "Wrote ${OUT}/vice_x64sc-wasm.data"
