import type { EjsInstance } from "./host";
import { runtimeViceOpts } from "./host";
import { defaultIecMap, viceRcSafeFloppyProfile } from "./play-session";
import type { IecMap } from "./types";
import { grok64DiskApi } from "./grok64-api";
import { bindGrok64DiskExports, grok64DiskModule } from "./vice-disk";

const GROK64_SETTINGS_LS = "grok64-settings";

const FRESH_PROFILE_BASELINE = {
  machineId: "c64",
  videoStandard: "pal",
  coreMode: "accurate",
  jiffyDos: false,
  reuSize: "none",
  iecDrive: "1541",
  iecUnit: 8,
  iecMap: defaultIecMap(),
  driveMode: "1541",
} as const;

export type Grok64ProfilePersistDiff = {
  freshBaseline: typeof FRESH_PROFILE_BASELINE;
  storedSettings: Record<string, unknown> | null;
  settingsDiff: Record<string, { fresh: unknown; stored: unknown }>;
  localStorageKeys: { key: string; byteLength: number }[];
  runtimeViceOpts: Record<string, string>;
  vicercOnDisk: Record<string, string | null>;
  vicercFreshBaseline: string;
  wasmDriveResources: Record<string, unknown> | null;
  wasmDriveResourcesError?: string;
};

function readLsJson(key: string): Record<string, unknown> | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: Record<string, unknown> };
    return parsed?.state && typeof parsed.state === "object" ? parsed.state : null;
  } catch {
    return null;
  }
}

function diffSettings(stored: Record<string, unknown> | null): Record<string, { fresh: unknown; stored: unknown }> {
  const out: Record<string, { fresh: unknown; stored: unknown }> = {};
  const base = FRESH_PROFILE_BASELINE as Record<string, unknown>;
  for (const key of Object.keys(base)) {
    const fresh = base[key];
    const got = stored?.[key];
    const same =
      key === "iecMap"
        ? JSON.stringify(got ?? {}) === JSON.stringify(fresh)
        : Object.is(got, fresh) || JSON.stringify(got) === JSON.stringify(fresh);
    if (!same) out[key] = { fresh, stored: got ?? null };
  }
  if (stored) {
    for (const key of Object.keys(stored)) {
      if (key in base) continue;
      if (stored[key] !== undefined) out[key] = { fresh: undefined, stored: stored[key] };
    }
  }
  return out;
}

const VICERC_ROOTS = [
  "/data",
  "/home/web_user/retroarch/userdata",
  "/home/web_user/retroarch",
];

function readVicercBodies(emu: EjsInstance | null): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const FS = emu?.Module?.FS ?? emu?.gameManager?.FS;
  if (!FS?.readFile) return out;
  for (const root of VICERC_ROOTS) {
    const path = `${root}/vicerc`;
    try {
      const raw = FS.readFile(path);
      if (typeof raw === "string") out[path] = raw;
      else if (raw instanceof Uint8Array) out[path] = new TextDecoder().decode(raw);
      else out[path] = null;
    } catch {
      out[path] = null;
    }
  }
  return out;
}

export function grok64ProfilePersistDiff(emu: EjsInstance | null): Grok64ProfilePersistDiff {
  const storedSettings = readLsJson(GROK64_SETTINGS_LS);
  const localStorageKeys: { key: string; byteLength: number }[] = [];
  if (typeof localStorage !== "undefined") {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      localStorageKeys.push({ key, byteLength: (localStorage.getItem(key) ?? "").length });
    }
  }
  const mod = grok64DiskModule(emu);
  if (mod) bindGrok64DiskExports(mod, emu);
  const snap = grok64DiskApi(mod)?.viceDriveResourceSnapshot?.();
  return {
    freshBaseline: FRESH_PROFILE_BASELINE,
    storedSettings,
    settingsDiff: diffSettings(storedSettings),
    localStorageKeys,
    runtimeViceOpts: runtimeViceOpts(),
    vicercOnDisk: readVicercBodies(emu),
    vicercFreshBaseline: viceRcSafeFloppyProfile(8, storedSettings?.iecMap as IecMap | undefined),
    wasmDriveResources: snap && typeof snap === "object" ? snap : null,
    wasmDriveResourcesError:
      snap && typeof snap === "object" && "error" in snap ? String((snap as { error?: string }).error) : undefined,
  };
}
