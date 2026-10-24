#!/usr/bin/env node
/** Ensure Makefile.emulatorjs EXPORTED_FUNCTIONS includes all Grok64 IEC + disk symbols. */
import { readFileSync, writeFileSync } from "node:fs";

const makefile = process.argv[2];
if (!makefile) {
  console.error("usage: patch-emulatorjs-grok64-exports.mjs <Makefile.emulatorjs>");
  process.exit(1);
}

const GROK64_EXPORTS = [
  "_grok64_sd2iec_attach",
  "_grok64_sd2iec_detach",
  "_grok64_sd2iec_poll",
  "_grok64_c64_read",
  "_grok64_c64_write",
  "_grok64_kbdbuf_feed",
  "_grok64_kbdbuf_feed_runcmd",
  "_grok64_kbdbuf_flush",
  "_grok64_cartridge_trigger_freeze",
  "_grok64_retro_keyboard",
  "_grok64_disk_attach",
  "_grok64_disk_attach_deferred",
  "_grok64_disk_detach",
  "_grok64_disk_get_name",
  "_grok64_retro_save_directory",
  "_grok64_disk_last_attach_rc",
  "_grok64_work_disk_refresh",
  "_grok64_disk_last_attach_diag",
  "_grok64_fs_stat_bytes",
  "_grok64_drive_image_bytes",
  "_grok64_drive_bam_disk_name",
  "_grok64_drive_last_error_code",
  "_grok64_drive_error_channel",
  "_grok64_drive_reload_image",
  "_grok64_drive_iec_device",
];

let text = readFileSync(makefile, "utf8");
const base =
  "EXPORTED_FUNCTIONS = _main,_malloc,_free,_load_state, \\\n" +
  "                     _ejs_set_variable,_simulate_input,_shader_enable,_save_state_info,_set_cheat,_cmd_take_screenshot, \\\n" +
  "                     _system_restart,_cmd_savefiles,_get_core_options,_get_core_options_json,_cmd_save_state,_supports_states,_reset_cheat,_toggleMainLoop, \\\n" +
  "                     _save_file_path,_get_disk_count,_set_current_disk,_get_current_disk,_refresh_save_files,_toggle_fastforward,_set_ff_ratio, \\\n" +
  "                     _toggle_slow_motion,_set_sm_ratio,_toggle_rewind,_set_rewind_granularity,_get_current_frame_count,_ejs_set_keyboard_enabled, \\\n" +
  "                     _set_vsync,_set_video_rotation,_get_video_dimensions,EmscriptenSendCommand,EmscriptenReceiveCommandReply,_get_memory_data, \\\n" +
  `                     _ejs_set_controller_port_device,_ejs_get_controller_port_info,${GROK64_EXPORTS.join(",")}`;

if (!text.includes("EXPORTED_FUNCTIONS =")) {
  console.error("EXPORTED_FUNCTIONS block not found");
  process.exit(1);
}

text = text.replace(/^EXPORTED_FUNCTIONS =[\s\S]*?(?=\n\n|\nEXPORTS)/m, `${base}\n`);
writeFileSync(makefile, text);
console.log(JSON.stringify({ ok: true, grok64Exports: GROK64_EXPORTS.length }));
