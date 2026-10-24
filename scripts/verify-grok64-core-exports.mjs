#!/usr/bin/env node
/**
 * Unpack a committed vice *.data archive and assert Grok64 disk IEC exports are wired in JS+WASM.
 */
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const manifestGate = spawnSync(process.execPath, ["scripts/check-grok64-core-manifest.mjs"], {
  encoding: "utf8",
});
if (manifestGate.status !== 0) {
  console.error(manifestGate.stdout || manifestGate.stderr);
  process.exit(1);
}

const dataPath =
  process.argv[2] ||
  join(process.cwd(), "public/system/vice/emulatorjs/data/cores/vice_x64sc-grok64-iec-wasm.data");
const seven = join(process.cwd(), "node_modules/7zip-bin/linux/x64/7za");
const tmp = join(process.cwd(), ".build/grok64-core-verify");

const REQUIRED = [
  "grok64_disk_attach",
  "grok64_disk_attach_deferred",
  "grok64_disk_detach",
  "grok64_disk_get_name",
  "grok64_disk_last_attach_rc",
  "grok64_disk_last_attach_diag",
  "grok64_work_disk_refresh",
  "grok64_fs_stat_bytes",
  "grok64_retro_save_directory",
  "grok64_drive_image_bytes",
  "grok64_drive_bam_disk_name",
  "grok64_drive_last_error_code",
  "grok64_drive_error_channel",
  "grok64_drive_reload_image",
  "grok64_drive_iec_device",
  "grok64_drive_virtual_device",
  "grok64_drive_unit_true_emulation",
  "grok64_drive_unit_type",
  "grok64_drive_unit_enabled",
  "grok64_rom_loaded",
  "grok64_drive_serial_device_type",
  "grok64_drive_vdrive_error_is_virtual",
  "grok64_drive_tde_image_bytes",
  "grok64_drive_gcr_loaded",
  "grok64_drive_vdrive_image_same",
  "grok64_drive_sync_tde_image",
  "grok64_iec_bus_reconcile",
  "grok64_drive_filesystem_device",
  "grok64_drive_cpu_clock",
  "grok64_drive_iec_bus_lines",
  "grok64_load_dollar_diag_capture",
];

rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const x = spawnSync(seven, ["x", `-o${tmp}`, dataPath, "vice_x64sc_libretro.wasm", "vice_x64sc_libretro.js", "-y"], {
  stdio: "inherit",
});
if (x.status !== 0) {
  console.error("verify: 7z extract failed");
  process.exit(1);
}

const wasmPath = join(tmp, "vice_x64sc_libretro.wasm");
const jsPath = join(tmp, "vice_x64sc_libretro.js");
const wasm = readFileSync(wasmPath);
const js = readFileSync(jsPath, "utf8");
const wasmExports = WebAssembly.Module.exports(new WebAssembly.Module(wasm));
const wasmNames = new Set(wasmExports.map((e) => e.name));

const failures = [];
for (const name of REQUIRED) {
  const underscored = `_${name}`;
  if (!js.includes(underscored)) {
    failures.push(`js-missing:${name}`);
    continue;
  }
  const re = new RegExp(
    `${name}=Module\\["${underscored}"\\][^;]*wasmExports\\["([^"]+)"\\]`,
  );
  const m = js.match(re);
  if (!m?.[1]) {
    failures.push(`js-wasm-map:${name}`);
    continue;
  }
  if (!wasmNames.has(m[1])) {
    failures.push(`wasm-missing:${name}->${m[1]}`);
  }
}

if (failures.length) {
  console.error(JSON.stringify({ ok: false, dataPath, failures, wasmExportCount: wasmExports.length }, null, 2));
  process.exit(1);
}

const sha256 = readFileSync(dataPath);
console.log(
  JSON.stringify({
    ok: true,
    dataPath,
    bytes: sha256.byteLength,
    wasmExportCount: wasmExports.length,
    grok64DiskExports: REQUIRED.length,
  }),
);
