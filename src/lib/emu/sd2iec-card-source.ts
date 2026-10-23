/**
 * SD2IEC card backing — two hardware-equivalent sources for the same firmware layer:
 * (A) raw FAT16/MBR `.img` in memory (not exploded into IndexedDB)
 * (B) host folder via File System Access API (Chromium desktop)
 */
import type { SdPartition } from "./sd2iec";
import { buildVirtualPartitionsFromDirectory, type HostDirectoryMount } from "./sd2iec-host-directory";

export type Sd2iecCardSourceKind = "indexeddb" | "fat-image" | "host-directory";

export type Sd2iecCardSourceMeta = {
  kind: Sd2iecCardSourceKind;
  label: string;
  writeEnabled: boolean;
  bytes?: number;
  /** Raw sector access is not available in the browser (Windows host app later). */
  rawBlockAccess: false;
};

type MountState =
  | { kind: "indexeddb" }
  | { kind: "fat-image"; image: Uint8Array; label: string; virtual: SdPartition[] }
  | { kind: "host-directory"; mount: HostDirectoryMount; virtual: SdPartition[] };

let state: MountState = { kind: "indexeddb" };
let writeEnabled = false;

export function getSd2iecCardSourceMeta(): Sd2iecCardSourceMeta {
  if (state.kind === "fat-image") {
    return {
      kind: "fat-image",
      label: state.label,
      writeEnabled,
      bytes: state.image.byteLength,
      rawBlockAccess: false,
    };
  }
  if (state.kind === "host-directory") {
    return {
      kind: "host-directory",
      label: state.mount.label,
      writeEnabled,
      rawBlockAccess: false,
    };
  }
  return { kind: "indexeddb", label: "Browser card (IndexedDB)", writeEnabled, rawBlockAccess: false };
}

export function isSd2iecWriteEnabled(): boolean {
  return writeEnabled;
}

export function setSd2iecWriteEnabled(on: boolean): void {
  writeEnabled = !!on;
}

export function clearSd2iecCardMount(): void {
  state = { kind: "indexeddb" };
  notifySd2iecCardChanged();
}

export function notifySd2iecCardChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("g64-sd2iec-card"));
  }
}

export function mountDirectFatImage(data: Uint8Array, label = "SD.IMG", virtual: SdPartition[]): void {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  state = { kind: "fat-image", image: copy, label, virtual };
  notifySd2iecCardChanged();
}

export async function mountHostDirectory(handle: FileSystemDirectoryHandle): Promise<SdPartition[]> {
  const mount: HostDirectoryMount = { handle, label: handle.name || "SD_FOLDER" };
  const virtual = await buildVirtualPartitionsFromDirectory(mount);
  state = { kind: "host-directory", mount, virtual };
  notifySd2iecCardChanged();
  return virtual;
}

export async function refreshHostDirectoryPartitions(): Promise<SdPartition[] | null> {
  if (state.kind !== "host-directory") return null;
  const virtual = await buildVirtualPartitionsFromDirectory(state.mount);
  state = { ...state, virtual };
  return virtual;
}

export function getHostDirectoryMount(): HostDirectoryMount | null {
  return state.kind === "host-directory" ? state.mount : null;
}

/** Active virtual partitions when not using IndexedDB file store. */
export function getVirtualSdPartitions(): SdPartition[] | null {
  if (state.kind === "fat-image" || state.kind === "host-directory") return state.virtual;
  return null;
}

export function getDirectFatImage(): Uint8Array | null {
  return state.kind === "fat-image" ? state.image : null;
}

export function supportsHostDirectoryPicker(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export function hostDirectoryPickerReason(): string | null {
  if (supportsHostDirectoryPicker()) return null;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return "Safari and iOS cannot open a real SD card folder in the browser. Use Mount .img, or the upcoming Windows Grok64 app for raw SD block access.";
  }
  if (/Safari/i.test(ua) && !/Chrome|Chromium|Edg/i.test(ua)) {
    return "Safari does not support the File System Access API (showDirectoryPicker). Use Mount .img or Chrome/Edge on desktop.";
  }
  return "This browser does not support opening a host folder. Use Mount .img or try Chrome/Edge on desktop.";
}
