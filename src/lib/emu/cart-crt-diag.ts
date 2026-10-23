/** CRT header parse + last cart Play diagnostic (IndexedDB / attach debugging). */

import { readBuildId } from "./build-id";
import type { FastLoadCartKind } from "./jiffy-cart-compat";

const HW_TYPE_NAMES: Record<number, string> = {
  0: "CRT",
  1: "SIMON",
  2: "SUPER_SNAPSHOT_V5",
  3: "CAPTURE",
  4: "ACTION_REPLAY",
  5: "RETRO_REPLAY",
  6: "SUPER_SNAPSHOT",
  7: "SUPER_SNAPSHOT_V4",
  8: "IEEE",
  9: "GAME_KILLER",
  10: "PROFESSIONAL_DOS",
  11: "SUPER_EXPLODE",
  12: "FINAL_CARTRIDGE_III",
  13: "FINAL_CARTRIDGE_II",
  14: "FINAL_CARTRIDGE_I",
  15: "FREEZE_FRAME",
  16: "FREEZE_MACHINE",
  17: "SNAPSHOT64",
  18: "SUPER_EXPLODE_V5",
  19: "CAPTURE_II",
  20: "ACTION_REPLAY2",
  21: "REPLAY3",
  22: "RETRO_REPLAY",
  23: "MMC64",
  24: "MMC_REPLAY",
  25: "IDE64",
  26: "SUPER_SNAPSHOT_V5",
  27: "C64_MAX",
  28: "EASYFLASH",
  29: "GMOD2",
};

export type CrtHeaderInfo = {
  valid: boolean;
  reason?: string;
  signature?: string;
  cartName?: string;
  version?: string;
  hwTypeId?: number;
  hwTypeLabel?: string;
  exrom?: number;
  game?: number;
};

export type CartPlayValidation = {
  ok: boolean;
  userMessage: string;
  header: CrtHeaderInfo;
  headerHex64: string;
};

export type LastCartPlayDiagnostic = {
  at: number;
  fileName: string;
  libraryId: string | null;
  idbStoredSize: number | null;
  payloadBytes: number;
  headerHex64: string;
  crtSignature: string | null;
  cartName: string | null;
  hwTypeId: number | null;
  hwTypeLabel: string | null;
  validationOk: boolean;
  validationError: string | null;
  writeBootOk: boolean | null;
  /** 0 = not run; -1 = write failed; 0 = attach failed; >0 = VICE cart type id if known else 1 ok */
  attachCode: number;
  bootFileAfter: string | null;
  cartMountedOnCore: boolean;
  fastLoadCart: FastLoadCartKind | null;
  playMode: string | null;
  coreLabel: string;
  wasmBuild: string;
  routesBundle: string | null;
  viceCoreKind: string;
};

let lastDiag: LastCartPlayDiagnostic | null = null;

function ascii(data: Uint8Array, off: number, len: number): string {
  let s = "";
  for (let i = 0; i < len && off + i < data.byteLength; i++) {
    const c = data[off + i];
    s += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : ".";
  }
  return s;
}

export function formatHeaderHex64(data: Uint8Array): string {
  const n = Math.min(64, data.byteLength);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) parts.push(data[i].toString(16).padStart(2, "0"));
  return parts.join(" ");
}

export function parseCrtHeader(data: Uint8Array): CrtHeaderInfo {
  if (data.byteLength < 37) {
    return { valid: false, reason: `too_short (${data.byteLength} bytes; need ≥64 for CRT header)` };
  }
  const signature = ascii(data, 0, 16).trim();
  if (!/^C64 CARTRIDGE/.test(signature) && !/^C128 CARTRIDGE/.test(signature)) {
    return {
      valid: false,
      reason: `bad_signature (“${signature.slice(0, 20)}…” — expected C64 CARTRIDGE)`,
      signature,
    };
  }
  const cartName = ascii(data, 16, 16).trim();
  const major = data[32];
  const minor = data[33];
  const hwTypeId = data[34];
  const exrom = data[35];
  const game = data[36];
  const hwTypeLabel = HW_TYPE_NAMES[hwTypeId] ?? `TYPE_${hwTypeId}`;
  return {
    valid: true,
    signature,
    cartName,
    version: `${major}.${minor}`,
    hwTypeId,
    hwTypeLabel,
    exrom,
    game,
  };
}

/** Strict check before cart Play — rejects extension-only guesses and truncated IDB rows. */
export function validateCartForPlay(
  data: Uint8Array,
  fileName: string,
  idbStoredSize?: number | null,
): CartPlayValidation {
  const headerHex64 = formatHeaderHex64(data);
  const header = parseCrtHeader(data);

  if (idbStoredSize != null && idbStoredSize > 0 && idbStoredSize !== data.byteLength) {
    return {
      ok: false,
      userMessage: `Library entry size (${idbStoredSize}) does not match loaded bytes (${data.byteLength}). Re-import this cartridge.`,
      header,
      headerHex64,
    };
  }

  if (!header.valid) {
    const ext = /\.(crt|bin)$/i.test(fileName);
    return {
      ok: false,
      userMessage: ext
        ? `“${fileName}” is not a valid CRT image (${header.reason ?? "invalid header"}). Re-download or re-import the .crt file.`
        : `Cartridge play needs a CRT header (C64 CARTRIDGE…). This file looks like ${data.byteLength} bytes without a valid header — re-import with a .crt extension.`,
      header,
      headerHex64,
    };
  }

  if (data.byteLength < 4096) {
    return {
      ok: false,
      userMessage: `CRT looks truncated (${data.byteLength} bytes). Super Snapshot / Action Replay images are usually hundreds of KB — delete this library row and import again.`,
      header,
      headerHex64,
    };
  }

  return { ok: true, userMessage: "", header, headerHex64 };
}

/** Block saving obvious bad CRTs into IndexedDB (same rules as Play, without IDB size check). */
export function validateCrtImport(data: Uint8Array, fileName: string): string | null {
  if (!/\.(crt|bin)$/i.test(fileName)) return null;
  const v = validateCartForPlay(data, fileName, null);
  return v.ok ? null : v.userMessage;
}

export function recordLastCartPlayDiagnostic(
  patch: Partial<LastCartPlayDiagnostic> & Pick<LastCartPlayDiagnostic, "fileName">,
): LastCartPlayDiagnostic {
  const build = readBuildId();
  const prev = lastDiag;
  lastDiag = {
    at: Date.now(),
    fileName: patch.fileName,
    libraryId: patch.libraryId ?? prev?.libraryId ?? null,
    idbStoredSize: patch.idbStoredSize ?? prev?.idbStoredSize ?? null,
    payloadBytes: patch.payloadBytes ?? prev?.payloadBytes ?? 0,
    headerHex64: patch.headerHex64 ?? prev?.headerHex64 ?? "",
    crtSignature: patch.crtSignature ?? prev?.crtSignature ?? null,
    cartName: patch.cartName ?? prev?.cartName ?? null,
    hwTypeId: patch.hwTypeId ?? prev?.hwTypeId ?? null,
    hwTypeLabel: patch.hwTypeLabel ?? prev?.hwTypeLabel ?? null,
    validationOk: patch.validationOk ?? prev?.validationOk ?? false,
    validationError: patch.validationError ?? prev?.validationError ?? null,
    writeBootOk: patch.writeBootOk ?? prev?.writeBootOk ?? null,
    attachCode: patch.attachCode ?? prev?.attachCode ?? 0,
    bootFileAfter: patch.bootFileAfter ?? prev?.bootFileAfter ?? null,
    cartMountedOnCore: patch.cartMountedOnCore ?? prev?.cartMountedOnCore ?? false,
    fastLoadCart: patch.fastLoadCart ?? prev?.fastLoadCart ?? null,
    playMode: patch.playMode ?? prev?.playMode ?? null,
    coreLabel: patch.coreLabel ?? prev?.coreLabel ?? build.label,
    wasmBuild: patch.wasmBuild ?? prev?.wasmBuild ?? build.git,
    routesBundle: patch.routesBundle ?? prev?.routesBundle ?? build.routes,
    viceCoreKind: patch.viceCoreKind ?? prev?.viceCoreKind ?? "unknown",
  };
  if (typeof console !== "undefined") {
    console.info("[grok64] lastCartPlay", lastDiag);
  }
  return lastDiag;
}

export function getLastCartPlayDiagnostic(): LastCartPlayDiagnostic | null {
  return lastDiag ? { ...lastDiag } : null;
}

/** After attach attempt: writeBoot + whether CRT still appears in MEMFS boot path. */
export function cartAttachResultCode(writeBootOk: boolean, cartMounted: boolean, hwTypeId?: number | null): number {
  if (!writeBootOk) return -1;
  if (!cartMounted) return 0;
  if (hwTypeId != null && hwTypeId >= 0) return hwTypeId;
  return 1;
}

/** Merge attach outcome into the last cart Play diagnostic (About + console). */
export function publishCartAttachDiag(input: {
  fileName: string;
  libraryId?: string | null;
  idbStoredSize?: number | null;
  payload: Uint8Array;
  validation?: CartPlayValidation | null;
  writeBootOk?: boolean | null;
  mounted?: boolean;
  bootFileAfter?: string | null;
  playMode?: string | null;
  fastLoadCart?: FastLoadCartKind | null;
  viceCoreKind?: string;
}): LastCartPlayDiagnostic {
  const validation = input.validation ?? validateCartForPlay(input.payload, input.fileName, input.idbStoredSize);
  const h = validation.header;
  const mounted = input.mounted ?? false;
  const writeBootOk = input.writeBootOk ?? null;
  return recordLastCartPlayDiagnostic({
    fileName: input.fileName,
    libraryId: input.libraryId ?? null,
    idbStoredSize: input.idbStoredSize ?? null,
    payloadBytes: input.payload.byteLength,
    headerHex64: validation.headerHex64,
    crtSignature: h.signature ?? null,
    cartName: h.cartName ?? null,
    hwTypeId: h.hwTypeId ?? null,
    hwTypeLabel: h.hwTypeLabel ?? null,
    validationOk: validation.ok,
    validationError: validation.ok ? null : validation.userMessage,
    writeBootOk,
    attachCode: cartAttachResultCode(writeBootOk === true, mounted, h.hwTypeId),
    bootFileAfter: input.bootFileAfter ?? null,
    cartMountedOnCore: mounted,
    playMode: input.playMode ?? null,
    fastLoadCart: input.fastLoadCart ?? null,
    viceCoreKind: input.viceCoreKind ?? "unknown",
  });
}
