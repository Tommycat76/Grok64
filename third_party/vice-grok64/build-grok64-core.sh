#!/usr/bin/env bash
# Build vice_x64sc_grok64 for Grok64 (Emscripten 3.1.74, EmulatorJS RetroArch link).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EMS="${ROOT}/.emsdk"
VICE="${ROOT}/.build/vice-libretro"
RA="${ROOT}/.build/ejs-compile/RetroArch"
OUT="${ROOT}/public/system/vice/emulatorjs/data/cores"

source "${EMS}/emsdk_env.sh"

bash "${ROOT}/third_party/vice-grok64/apply-patches.sh" "${VICE}"

cd "${VICE}"
emmake make clean EMUTYPE=x64sc
emmake make -j"$(nproc)" platform=emscripten EMUTYPE=x64sc

GROK64_EXPORTS_O="${VICE}/build/libretro/grok64_exports.o"
if ! test -f "${GROK64_EXPORTS_O}" || ! strings "${GROK64_EXPORTS_O}" | grep -q grok64_disk_attach; then
  echo "ERROR: ${GROK64_EXPORTS_O} missing grok64_disk_attach (grok64_exports.c not built)" >&2
  exit 1
fi

mkdir -p "${RA}/emulatorjs"
cp "${VICE}/vice_x64sc_libretro_emscripten.bc" "${RA}/libretro_emscripten.a"
cp "${ROOT}/third_party/vice-grok64/grok64_library.js" "${RA}/emulatorjs/grok64_library.js"

node "${ROOT}/scripts/patch-emulatorjs-grok64-exports.mjs" "${RA}/Makefile.emulatorjs"

cd "${RA}"
emmake make -f Makefile.emulatorjs clean
rm -rf obj-emscripten
emmake make -f Makefile.emulatorjs HAVE_7ZIP=1 HAVE_CHD=1 HAVE_THREADS=0 PTHREAD_POOL_SIZE=0 ASYNC=0 \
  HAVE_OPENGLES3=1 STACK_SIZE=4194304 INITIAL_HEAP=134217728 HAVE_AL=0 HAVE_RWEBAUDIO=1 LIGHT_DEBUG=0 \
  TARGET=vice_x64sc_libretro.js -j"$(nproc)"

mkdir -p "${OUT}"
SEVEN_ZA="${ROOT}/node_modules/7zip-bin/linux/x64/7za"
chmod +x "${SEVEN_ZA}" 2>/dev/null || true
AUX="${ROOT}/.build/grok64-core-aux"
mkdir -p "${AUX}"
if ! test -f "${AUX}/core.json"; then
  "${SEVEN_ZA}" x -o"${AUX}" "${OUT}/vice_x64sc-grok64-iec-wasm.data" core.json license.txt vice_x64sc.json -y >/dev/null 2>&1 || true
fi
for f in license.txt core.json vice_x64sc.json; do
  test -f "${AUX}/${f}" || { echo "missing aux ${f} for 7z pack" >&2; exit 1; }
done
"${SEVEN_ZA}" a -t7z "${OUT}/vice_x64sc-wasm.data" \
  "${RA}/vice_x64sc_libretro.wasm" "${RA}/vice_x64sc_libretro.js" \
  "${AUX}/license.txt" "${AUX}/core.json" "${AUX}/vice_x64sc.json"

IEC_SRC="${OUT}/vice_x64sc-wasm.data"
for alias in vice_x64sc_grok64-wasm.data vice_x64sc-grok64-iec-wasm.data; do
  cp -f "${IEC_SRC}" "${OUT}/${alias}"
  test -f "${OUT}/${alias}" || { echo "missing ${alias}" >&2; exit 1; }
done

cd "${ROOT}"
node "${ROOT}/scripts/write-grok64-core-manifest.mjs"
node "${ROOT}/scripts/check-grok64-core-manifest.mjs"
node "${ROOT}/scripts/verify-grok64-core-exports.mjs" "${OUT}/vice_x64sc-grok64-iec-wasm.data"

echo "Wrote ${IEC_SRC} (+ grok64 IEC aliases, bytes=$(wc -c <"${IEC_SRC}"))"
