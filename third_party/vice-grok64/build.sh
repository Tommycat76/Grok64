#!/usr/bin/env bash
# Grok64 vice-libretro WASM build. Requires emsdk on PATH (emcc).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD_DIR="${ROOT}/.build/vice-grok64"
OUT="${ROOT}/public/system/vice/emulatorjs/data/cores"
VICE_REF="${VICE_LIBRETRO_REF:-8818c3a39146b9a26df23a1e4880b4420f93a255}"

if ! command -v emcc >/dev/null 2>&1; then
  echo "emcc not found. Install emsdk: https://emscripten.org/docs/getting_started/downloads.html"
  echo "Then re-run: third_party/vice-grok64/build.sh"
  exit 1
fi

mkdir -p "${BUILD_DIR}" "${OUT}"
if [[ ! -d "${BUILD_DIR}/vice-libretro" ]]; then
  git clone --depth 1 https://github.com/libretro/vice-libretro.git "${BUILD_DIR}/vice-libretro"
  (cd "${BUILD_DIR}/vice-libretro" && git fetch --depth 1 origin "${VICE_REF}" && git checkout "${VICE_REF}")
fi

# Patch hook points (minimal stub — full drive integration is ongoing).
PATCH="${ROOT}/third_party/vice-grok64/patches/grok64-exports.patch"
if [[ -f "${PATCH}" ]]; then
  (cd "${BUILD_DIR}/vice-libretro" && git apply -R "${PATCH}" 2>/dev/null || true)
  (cd "${BUILD_DIR}/vice-libretro" && git apply "${PATCH}")
fi

(
  cd "${BUILD_DIR}/vice-libretro"
  make -f Makefile platform=emscripten SUBARCH=x64sc -j"$(nproc)" 2>&1 | tee "${BUILD_DIR}/build.log"
)

# EmulatorJS expects vice_x64sc_grok64-wasm.{js,data}
for f in vice_x64sc_libretro*.js vice_x64sc_libretro*.wasm vice_x64sc_libretro*.data; do
  if [[ -f "${BUILD_DIR}/vice-libretro/${f}" ]]; then
    base="${f/vice_x64sc_libretro/vice_x64sc_grok64}"
    cp "${BUILD_DIR}/vice-libretro/${f}" "${OUT}/${base}"
  fi
done

echo "Grok64 VICE cores installed under ${OUT}"
