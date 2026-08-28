import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const MAX = 120;
const buf: string[] = [];
const listeners = new Set<(lines: string[]) => void>();
let flushTimer: number | null = null;
let lastFireLog = 0;

export function logLines() {
  return buf.slice();
}

export function subscribeLog(fn: (lines: string[]) => void) {
  listeners.add(fn);
  fn(buf.slice());
  return () => {
    listeners.delete(fn);
  };
}

export function glog(msg: string, extra?: Record<string, unknown>) {
  const stamp = new Date().toISOString().slice(11, 23);
  const line = extra ? `${stamp} ${msg} ${JSON.stringify(extra)}` : `${stamp} ${msg}`;
  buf.push(line);
  if (buf.length > MAX) buf.shift();
  const snap = buf.slice();
  listeners.forEach((fn) => fn(snap));
  if (typeof window !== "undefined") {
    const w = window as unknown as { __g64log?: string[] };
    w.__g64log = snap;
    if (flushTimer) return;
    flushTimer = window.setTimeout(() => {
      flushTimer = null;
      void pushDebugLog({ data: { lines: buf.slice(-24) } }).catch(() => {
        /* preview may be static */
      });
    }, 700);
  }
}

export function glogFire(down: boolean, extra?: Record<string, unknown>) {
  const now = Date.now();
  if (down || now - lastFireLog > 200) {
    lastFireLog = now;
    glog(down ? "FIRE down" : "FIRE up", extra);
  }
}

export const pushDebugLog = createServerFn({ method: "POST" })
  .validator(
    z.object({
      lines: z.array(z.string().max(400)).max(40),
    }),
  )
  .handler(async ({ data }) => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = "/tmp";
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "g64.jsonl");
    fs.appendFileSync(file, `${data.lines.join("\n")}\n---\n`);
    return { ok: true as const };
  });
