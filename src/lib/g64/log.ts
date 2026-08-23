const MAX = 120;
const lines: string[] = [];
const listeners = new Set<(all: string[]) => void>();

export function g64log(msg: string, extra?: unknown) {
  const n = new Date().toISOString().slice(11, 23);
  const row = extra ? `${n} ${msg} ${JSON.stringify(extra)}` : `${n} ${msg}`;
  lines.push(row);
  if (lines.length > MAX) lines.shift();
  const snap = lines.slice();
  listeners.forEach((fn) => fn(snap));
  if (typeof window !== "undefined") {
    (window as unknown as { __g64log?: string[] }).__g64log = snap;
  }
}

export function subscribeLog(fn: (all: string[]) => void) {
  listeners.add(fn);
  fn(lines.slice());
  return () => {
    listeners.delete(fn);
  };
}

export function getLog() {
  return lines.slice();
}
