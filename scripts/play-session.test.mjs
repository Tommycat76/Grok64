import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const {
  planPlay,
  floppyNeedsRecycle,
  liveDriveOptions,
  viceRcForUser,
  viceDriveTypeCode,
  cmdKeepsFloppyUnit8,
  defaultCmdUnit,
  nextDiskIndex,
  viceDriveTypeVars,
  viceRcForDrives,
  defaultIecMap,
  iecMapFromLegacy,
  setIecSlot,
  userAttachFromMap,
  mapHasDrive,
  withLiveFloppy,
  PLAY_UNLOCK_VICE_OPTS,
  userResetKind,
  shouldRecoverBoot,
  shouldDropToSplash,
  shouldRefuseStartRecycle,
  shouldSkipPlayPersist,
  shouldDismissPictureHold,
  iosPlayKeepsLiveCrt,
  iosMustKeepLiveCore,
  iosInPlaceMediaKind,
  markLivePlay,
  clearLivePlay,
  livePlayTitle,
} = await server.ssrLoadModule("/src/lib/emu/play-session.ts");
const {
  classifyPress,
  actionForPress,
  hwButtonById,
  visibleHwButtons,
  cmdSwapUnits,
  cmdDriveMap,
  sd2iecSwapUnit,
  HW_LONG_MS,
  HW_BUTTONS,
} = await server.ssrLoadModule("/src/lib/emu/hw-buttons.ts");
const { workDiskFor, C64OS_REU, reuForVice, buildViceExtras } = await server.ssrLoadModule("/src/lib/emu/vice-extras.ts");
await server.close();

test("floppy Play from SD2IEC@8 recycles to a real 1541 on unit 8", () => {
  const plan = planPlay({
    filename: "paradroidalldri.d64",
    userIec: "sd2iec",
    userUnit: 8,
    liveIec: "sd2iec",
    liveWorkDisk: "8_fs",
    autostart: true,
  });
  assert.equal(plan.kind, "floppy");
  assert.deepEqual(plan.attach, { iec: "1541", unit: 8 });
  assert.deepEqual(plan.live, { iec: "1541", unit: 8 });
  assert.deepEqual(plan.user, { iec: "sd2iec", unit: 8 });
  assert.equal(plan.recycle, true);
  assert.equal(plan.autostartAfterReady, true);
  assert.equal(plan.softIec, false);
  assert.equal(plan.trueDrive, true);
});

test("MULE / Burger Time same attach — user SD2IEC preference is not overwritten", () => {
  for (const name of ["MULE.d64", "Burger_Time_1983.d64"]) {
    const plan = planPlay({
      filename: name,
      userIec: "sd2iec",
      userUnit: 8,
      liveIec: "sd2iec",
      liveWorkDisk: "8_fs",
    });
    assert.deepEqual(plan.user, { iec: "sd2iec", unit: 8 });
    assert.deepEqual(plan.attach, { iec: "1541", unit: 8 });
    assert.equal(plan.recycle, true);
  }
});

test("CMD HD on unit 9 keeps a 1541 on 8 — floppy Play does not gut CMD", () => {
  assert.equal(cmdKeepsFloppyUnit8({ iec: "cmdhd", unit: 9 }), true);
  assert.equal(floppyNeedsRecycle("cmdhd", "8_d64", { iec: "cmdhd", unit: 9 }), false);
  const plan = planPlay({
    filename: "paradroid.d64",
    userIec: "cmdhd",
    userUnit: 9,
    liveIec: "1541",
    liveWorkDisk: "8_d64",
  });
  assert.equal(plan.recycle, false);
  assert.deepEqual(plan.user, { iec: "cmdhd", unit: 9 });
  assert.deepEqual(plan.live, { iec: "1541", unit: 8 });
});

test("CMD HD on unit 8 must recycle for floppy Autostart", () => {
  const plan = planPlay({
    filename: "mule.d64",
    userIec: "cmdhd",
    userUnit: 8,
    liveIec: "cmdhd",
    liveWorkDisk: "disabled",
  });
  assert.equal(plan.recycle, true);
  assert.deepEqual(plan.user, { iec: "cmdhd", unit: 8 });
  assert.deepEqual(plan.live, { iec: "1541", unit: 8 });
});

test("already-1541 hot-swap — no recycle", () => {
  const plan = planPlay({
    filename: "paradroid.d64",
    userIec: "1541",
    userUnit: 8,
    liveIec: "1541",
    liveWorkDisk: "8_d64",
  });
  assert.equal(plan.recycle, false);
  assert.equal(plan.autostartAfterReady, true);
});

test("BASIC / C64 OS kit keeps user IEC (SD2IEC or CMD)", () => {
  const sd = planPlay({
    filename: "WORK DISK.D64",
    work: true,
    userIec: "sd2iec",
    userUnit: 8,
    liveIec: "sd2iec",
    liveWorkDisk: "8_fs",
    autostart: false,
  });
  assert.equal(sd.kind, "basic");
  assert.deepEqual(sd.live, { iec: "sd2iec", unit: 8 });
  assert.equal(sd.autostartAfterReady, false);
  assert.equal(sd.softIec, false);

  const cmd = planPlay({
    filename: "WORK DISK.D64",
    work: true,
    userIec: "cmdhd",
    userUnit: 9,
    liveIec: "cmdhd",
    liveWorkDisk: "disabled",
    autostart: false,
  });
  assert.deepEqual(cmd.user, { iec: "cmdhd", unit: 9 });
  assert.deepEqual(cmd.live, { iec: "1541", unit: 8 });
  assert.equal(cmd.trueDrive, true);
});

test("live drive options: CMD is real (no 8_fs traps); SD2IEC is VICE FS card", () => {
  assert.deepEqual(liveDriveOptions({ iec: "cmdhd", unit: 9 }), {
    vice_work_disk: "disabled",
    vice_virtual_device_traps: "disabled",
    vice_drive_true_emulation: "enabled",
    vice_drive9_type: "CMD HD",
  });
  assert.deepEqual(liveDriveOptions({ iec: "sd2iec", unit: 8 }), {
    vice_work_disk: "8_fs",
    vice_virtual_device_traps: "enabled",
    vice_drive_true_emulation: "disabled",
    vice_drive8_type: "None",
  });
  assert.deepEqual(liveDriveOptions({ iec: "1541", unit: 8 }), {
    vice_work_disk: "8_d64",
    vice_virtual_device_traps: "disabled",
    vice_drive_true_emulation: "enabled",
    vice_drive8_type: "1541",
  });
  assert.equal(workDiskFor("cmdhd", 9), "disabled");
  assert.equal(workDiskFor("sd2iec", 8), "8_fs");
  assert.equal(workDiskFor("1541", 8), "8_d64");
});

test("vicerc: CMD HD type 4844 on unit 9, 1541 on 8", () => {
  const rc = viceRcForUser({ iec: "cmdhd", unit: 9 }, { iec: "1541", unit: 8 });
  assert.match(rc, /Drive8Type=1541/);
  assert.match(rc, /Drive9Type=4844/);
  assert.match(rc, /VirtualDevices=0/);
  assert.equal(viceDriveTypeCode("cmdhd"), 4844);
});

test("CMD chip defaults to unit 9 so floppy Autostart keeps device 8", () => {
  assert.equal(defaultCmdUnit(8), 9);
  assert.equal(defaultCmdUnit(9), 9);
  assert.equal(defaultCmdUnit(11), 11);
});

test("SD2IEC freeze button wraps the disk list like real hardware", () => {
  assert.equal(nextDiskIndex(0, 3, 1), 1);
  assert.equal(nextDiskIndex(2, 3, 1), 0);
  assert.equal(nextDiskIndex(0, 3, -1), 2);
  assert.equal(nextDiskIndex(0, 0, 1), 0);
});

test("recycled C64 core bakes vice_drive8_type=1541 at boot", () => {
  const opts = buildViceExtras({
    reu: "none",
    iec: "1541",
    iecUnit: 8,
    mouse: false,
    joyPort: 2,
    scpu: false,
    jiffy: false,
  });
  assert.equal(opts.vice_work_disk, "8_d64");
  assert.equal(opts.vice_drive8_type, "1541");
  assert.equal(opts.vice_jiffydos, "disabled");
});

test("C64 OS REU is a real 16 MB unit — never stubbed", () => {
  assert.equal(C64OS_REU, "16384kB");
  assert.equal(reuForVice("16384kB"), "16384kB");
  assert.equal(reuForVice("2048kB"), "2048kB");
});

test("CMD SWAP exchanges with #8 and hold restores", () => {
  assert.deepEqual(cmdSwapUnits(9, false), { cmd: 9, floppy: 8 });
  assert.deepEqual(cmdSwapUnits(9, true), { cmd: 8, floppy: 9 });
  assert.deepEqual(cmdSwapUnits(8, false), { cmd: 8, floppy: 9 });
  assert.deepEqual(cmdSwapUnits(8, true), { cmd: 9, floppy: 8 });
  assert.deepEqual(cmdSwapUnits(10, true), { cmd: 8, floppy: 10 });
  const swapped = cmdDriveMap(9, true);
  assert.equal(swapped[8], "cmdhd");
  assert.equal(swapped[9], "1541");
  const rc = viceRcForDrives(swapped, false);
  assert.match(rc, /Drive8Type=4844/);
  assert.match(rc, /Drive9Type=1541/);
  const vars = viceDriveTypeVars(swapped);
  assert.equal(vars.vice_drive8_type, "CMD HD");
  assert.equal(vars.vice_drive9_type, "1541");
});

test("SD2IEC SWAP 8/9 and disk-change wrap", () => {
  assert.equal(sd2iecSwapUnit(8), 9);
  assert.equal(sd2iecSwapUnit(9), 8);
  assert.equal(sd2iecSwapUnit(10), 8);
});

test("hardware buttons: short/long map matches real devices", () => {
  assert.equal(classifyPress(200), "short");
  assert.equal(classifyPress(HW_LONG_MS), "long");
  assert.equal(classifyPress(1500), "long");
  const cart = hwButtonById("cart-fz");
  const sd = hwButtonById("sd-disk");
  const sd89 = hwButtonById("sd-swap");
  const cmd = hwButtonById("cmd-swap");
  assert.equal(actionForPress(cart, "short"), "cart-freeze");
  assert.equal(actionForPress(cart, "long"), "cart-reset");
  assert.equal(actionForPress(sd, "short"), "sd2iec-next");
  assert.equal(actionForPress(sd, "long"), "sd2iec-prev");
  assert.equal(actionForPress(sd89, "short"), "sd2iec-swap89");
  assert.equal(actionForPress(sd89, "long"), "sd2iec-unit8");
  assert.equal(actionForPress(cmd, "short"), "cmd-swap");
  assert.equal(actionForPress(cmd, "long"), "cmd-unswap");
  const ids = visibleHwButtons({ cart: true, sd2iec: true, cmdhd: true, scpu: true }).map((b) => b.id);
  assert.deepEqual(ids, ["cart-fz", "sd-disk", "sd-swap", "cmd-swap", "scpu-rst"]);
  const noCmd = visibleHwButtons({ cart: true, sd2iec: true, cmdhd: false, scpu: false }).map((b) => b.id);
  assert.deepEqual(noCmd, ["cart-fz", "sd-disk", "sd-swap"]);
  assert.deepEqual(visibleHwButtons({}).map((b) => b.id), []);
  assert.deepEqual(visibleHwButtons({ cart: false, sd2iec: false }).map((b) => b.id), []);
  assert.ok(HW_BUTTONS.every((b) => b.shortAction));
});

test("iPhone + Jiffy wanted but not live recycles even when 1541 is already up", () => {
  assert.equal(
    floppyNeedsRecycle("1541", "8_d64", { iec: "cmdhd", unit: 11 }, {
      iosPhone: true,
      jiffyWant: true,
      jiffyLive: false,
    }),
    true,
  );
  const plan = planPlay({
    filename: "paradroidalldri.d64",
    userIec: "cmdhd",
    userUnit: 11,
    liveIec: "1541",
    liveWorkDisk: "8_d64",
    iosPhone: true,
    jiffyWant: true,
    jiffyLive: false,
  });
  assert.equal(plan.recycle, true);
  assert.deepEqual(plan.live, { iec: "1541", unit: 8 });
  assert.deepEqual(plan.user, { iec: "cmdhd", unit: 11 });
});

test("iPhone Play keeps the live CRT after READY — no WASM recycle", () => {
  assert.equal(iosPlayKeepsLiveCrt({ iosPhone: true, hasLiveFs: true, kind: "floppy" }), true);
  assert.equal(iosPlayKeepsLiveCrt({ iosPhone: true, hasLiveFs: false, kind: "floppy" }), false);
  assert.equal(iosPlayKeepsLiveCrt({ iosPhone: true, hasLiveFs: true, kind: "basic" }), false);
  assert.equal(iosPlayKeepsLiveCrt({ iosPhone: false, hasLiveFs: true, kind: "floppy" }), false);
});

test("iPhone floppy Play never hot-swaps — even CMD@11 + live 1541 + Jiffy live", () => {
  const plan = planPlay({
    filename: "mule.d64",
    userIec: "cmdhd",
    userUnit: 11,
    liveIec: "1541",
    liveWorkDisk: "8_d64",
    iosPhone: true,
    jiffyWant: true,
    jiffyLive: true,
  });
  assert.equal(plan.recycle, true);
  assert.deepEqual(plan.live, { iec: "1541", unit: 8 });
  assert.deepEqual(plan.user, { iec: "cmdhd", unit: 11 });
});

test("user SD2IEC + stale 1541 session recycles (Tom chip-on / hot-swap log)", () => {
  const plan = planPlay({
    filename: "paradroidalldri.d64",
    userIec: "sd2iec",
    userUnit: 8,
    liveIec: "1541",
    liveWorkDisk: "8_d64",
    iosPhone: false,
  });
  assert.equal(plan.recycle, true);
});

test("desktop Jiffy-not-live still hot-swaps on a real 1541", () => {
  const plan = planPlay({
    filename: "paradroid.d64",
    userIec: "1541",
    userUnit: 8,
    liveIec: "1541",
    liveWorkDisk: "8_d64",
    iosPhone: false,
    jiffyWant: true,
    jiffyLive: false,
  });
  assert.equal(plan.recycle, false);
});

test("vicerc omits CMD type 4844 when the ROM is missing", () => {
  const withRom = viceRcForUser({ iec: "cmdhd", unit: 11 }, { iec: "1541", unit: 8 }, { cmdRom: true });
  assert.match(withRom, /Drive8Type=1541/);
  assert.match(withRom, /Drive11Type=4844/);
  const noRom = viceRcForUser({ iec: "cmdhd", unit: 11 }, { iec: "1541", unit: 8 }, { cmdRom: false });
  assert.match(noRom, /Drive8Type=1541/);
  assert.doesNotMatch(noRom, /4844/);
});

test("Autostart is never a core-start flag — always after ready", () => {
  const plan = planPlay({
    filename: "paradroid.d64",
    userIec: "sd2iec",
    userUnit: 8,
    liveIec: "sd2iec",
    liveWorkDisk: "8_fs",
    autostart: true,
  });
  assert.equal(plan.autostartAfterReady, true);
});

test("IEC map: one unit number is one drive", () => {
  const fresh = defaultIecMap();
  assert.equal(fresh[8], "1541");
  assert.equal(fresh[9], "none");
  const two = setIecSlot(setIecSlot(fresh, 9, "1541"), 10, "1581");
  assert.equal(two[8], "1541");
  assert.equal(two[9], "1541");
  assert.equal(two[10], "1581");
  const cmd = iecMapFromLegacy("cmdhd", 9);
  assert.equal(cmd[8], "1541");
  assert.equal(cmd[9], "cmdhd");
  assert.deepEqual(userAttachFromMap(cmd), { iec: "cmdhd", unit: 9 });
  const sd = setIecSlot(cmd, 8, "sd2iec");
  assert.equal(sd[8], "sd2iec");
  assert.equal(mapHasDrive(sd, "sd2iec"), true);
  const uniq = setIecSlot(sd, 11, "sd2iec");
  assert.equal(uniq[8], "1541");
  assert.equal(uniq[11], "sd2iec");
  const empty8 = setIecSlot(fresh, 8, "none");
  assert.equal(empty8[8], "1541");
  const live = withLiveFloppy(sd, { iec: "1541", unit: 8 });
  assert.equal(live[8], "1541");
  assert.equal(live[9], "cmdhd");
});

test("play-unlock disarms Autostart so a later reset cannot re-LOAD to READY", () => {
  assert.equal(PLAY_UNLOCK_VICE_OPTS.vice_autostart, "disabled");
  assert.equal(PLAY_UNLOCK_VICE_OPTS.vice_autostart_warp, "disabled");
  assert.equal(PLAY_UNLOCK_VICE_OPTS.vice_autoloadwarp, "disabled");
  assert.equal(PLAY_UNLOCK_VICE_OPTS.vice_reset, "hard");
});

test("toolbar Reset is always a cold boot — never Autostart re-fire", () => {
  assert.equal(userResetKind("disk"), "hard");
  assert.equal(userResetKind("basic"), "hard");
  assert.equal(userResetKind("auto"), "hard");
});

test("iPhone powered floppy Play must keep the live core", () => {
  assert.equal(iosMustKeepLiveCore({ iosPhone: true, powered: true, hasEmu: true, kind: "floppy" }), true);
  assert.equal(iosMustKeepLiveCore({ iosPhone: true, powered: true, hasEmu: false, kind: "floppy" }), false);
  assert.equal(iosMustKeepLiveCore({ iosPhone: true, powered: false, hasEmu: true, kind: "floppy" }), false);
  assert.equal(iosMustKeepLiveCore({ iosPhone: false, powered: true, hasEmu: true, kind: "floppy" }), false);
  assert.equal(iosMustKeepLiveCore({ iosPhone: true, powered: true, hasEmu: true, kind: "basic" }), false);
  assert.equal(iosMustKeepLiveCore({ iosPhone: true, powered: true, hasEmu: true, kind: "cart" }), true);
  assert.equal(iosMustKeepLiveCore({ iosPhone: true, powered: true, hasEmu: true, kind: "tape" }), true);
  assert.equal(iosPlayKeepsLiveCrt({ iosPhone: true, hasLiveFs: true, kind: "floppy" }), true);
  assert.equal(iosPlayKeepsLiveCrt({ iosPhone: true, hasLiveFs: true, kind: "prg" }), true);
  assert.equal(iosPlayKeepsLiveCrt({ iosPhone: true, hasLiveFs: true, kind: "cart" }), false);
});

test("please-hold dismisses when READY/paint is live — not a 16s timer", () => {
  assert.equal(
    shouldDismissPictureHold({ hold: true, booting: false, running: true, paintSettled: false }),
    true,
  );
  assert.equal(
    shouldDismissPictureHold({ hold: true, booting: true, running: false, paintSettled: true }),
    true,
  );
  assert.equal(
    shouldDismissPictureHold({ hold: true, booting: true, running: false, paintSettled: false }),
    false,
  );
  assert.equal(
    shouldDismissPictureHold({ hold: false, booting: false, running: true, paintSettled: true }),
    false,
  );
});

test("live-play lock survives a remount that reset refs to basic", () => {
  clearLivePlay();
  markLivePlay("Paradroid");
  assert.equal(livePlayTitle(), "Paradroid");
  assert.equal(
    shouldDropToSplash({
      playMode: "basic",
      playLock: false,
      inGameplay: false,
      powered: true,
      hasFs: false,
      title: "BASIC",
    }),
    false,
  );
  assert.equal(
    shouldRecoverBoot({
      playMode: "basic",
      playLock: false,
      inGameplay: false,
      powered: true,
      hasFs: false,
      title: "BASIC",
    }),
    false,
  );
  assert.equal(
    shouldRefuseStartRecycle({
      iosPhone: true,
      powered: true,
      playMode: "basic",
      inGameplay: false,
      title: "BASIC",
    }),
    true,
  );
  assert.equal(
    shouldSkipPlayPersist({
      iosPhone: true,
      playMode: "disk",
      inGameplay: true,
      title: "Paradroid",
    }),
    true,
  );
  assert.equal(
    shouldSkipPlayPersist({
      iosPhone: false,
      playMode: "disk",
      inGameplay: true,
      title: "Paradroid",
    }),
    false,
  );
  assert.equal(
    shouldSkipPlayPersist({
      ios: true,
      playMode: "auto",
      inGameplay: true,
      title: "Impossible Mission",
    }),
    true,
  );
  assert.equal(
    shouldSkipPlayPersist({
      iosPhone: true,
      playMode: "auto",
      inGameplay: true,
      title: "Impossible Mission",
    }),
    true,
  );
  assert.equal(iosInPlaceMediaKind("cart"), true);
  assert.equal(iosInPlaceMediaKind("floppy"), false);
  assert.equal(
    shouldDropToSplash({
      playMode: "auto",
      playLock: false,
      inGameplay: true,
      powered: true,
      hasFs: true,
      title: "Impossible Mission",
    }),
    false,
  );
  clearLivePlay();
  assert.equal(
    shouldRefuseStartRecycle({
      iosPhone: true,
      powered: true,
      playMode: "basic",
      inGameplay: false,
      title: "BASIC",
    }),
    false,
  );
});

test("splash remount is only for a failed cold BASIC start", () => {
  clearLivePlay();
  assert.equal(
    shouldDropToSplash({
      playMode: "disk",
      playLock: false,
      inGameplay: true,
      powered: true,
      hasFs: true,
      title: "Boulder Dash",
    }),
    false,
  );
  assert.equal(
    shouldDropToSplash({
      playMode: "basic",
      playLock: false,
      inGameplay: true,
      powered: true,
      hasFs: false,
      title: "BASIC",
    }),
    false,
  );
  assert.equal(
    shouldDropToSplash({
      playMode: "basic",
      playLock: false,
      inGameplay: false,
      powered: true,
      hasFs: false,
      title: "Paradroid",
    }),
    false,
  );
  assert.equal(
    shouldDropToSplash({
      playMode: "basic",
      playLock: false,
      inGameplay: false,
      powered: true,
      hasFs: false,
      title: "BASIC",
    }),
    true,
  );
});

test("boot recover must not replace a live floppy session with BASIC", () => {
  clearLivePlay();
  assert.equal(
    shouldRecoverBoot({
      playMode: "disk",
      playLock: false,
      inGameplay: true,
      powered: true,
      hasFs: false,
    }),
    false,
  );
  assert.equal(
    shouldRecoverBoot({
      playMode: "disk",
      playLock: true,
      inGameplay: false,
      powered: true,
      hasFs: false,
    }),
    false,
  );
  assert.equal(
    shouldRecoverBoot({
      playMode: "basic",
      playLock: false,
      inGameplay: false,
      powered: true,
      hasFs: true,
    }),
    false,
  );
  assert.equal(
    shouldRecoverBoot({
      playMode: "basic",
      playLock: false,
      inGameplay: false,
      powered: true,
      hasFs: false,
    }),
    true,
  );
});
