/** Authoritative in-session mount list (VICE MEMFS scan alone misses hot-swapped work disks). */

export type SessionMediaSlot = {
  name: string;
  bytes: Uint8Array;
  kind: "disk" | "cart" | "tape";
  unit?: number;
};

const slots: SessionMediaSlot[] = [];

export function clearSessionMedia() {
  slots.length = 0;
}

export function setSessionDisk(name: string, bytes: Uint8Array, unit = 8) {
  const rest = slots.filter((s) => s.kind !== "disk" || s.unit !== unit);
  slots.length = 0;
  slots.push(...rest, { name, bytes: new Uint8Array(bytes), kind: "disk", unit });
}

export function setSessionCart(name: string, bytes: Uint8Array) {
  const without = slots.filter((s) => s.kind !== "cart");
  slots.length = 0;
  slots.push(...without, { name, bytes: new Uint8Array(bytes), kind: "cart" });
}

export function removeSessionCart() {
  const next = slots.filter((s) => s.kind !== "cart");
  slots.length = 0;
  slots.push(...next);
}

export function sessionMediaList(): SessionMediaSlot[] {
  return slots.map((s) => ({ ...s, bytes: s.bytes }));
}
