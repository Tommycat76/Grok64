import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const BLOCKED = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.|::1|\[::1\])/i;
const MAX = 6 * 1024 * 1024;
const OK_EXT = /\.(prg|p00|d64|d71|d81|g64|g71|t64|tap|crt|bin|zip|vsf|sav|m3u|sid)$/i;

function driveId(url: string): string | null {
  const file = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (file?.[1]) return file[1];
  const id = url.match(/[?&]id=([^&]+)/);
  return id?.[1] ?? null;
}

function rewrite(url: string): string {
  const id = driveId(url);
  if (id) return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
  return url;
}

function filenameOf(url: string, header: string | null): string {
  const cd = header?.match(/filename\*?=(?:UTF-8'')?["']?([^";]+)["']?/i);
  if (cd?.[1]) return decodeURIComponent(cd[1]);
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop() ?? "download";
    return decodeURIComponent(last);
  } catch {
    return "download";
  }
}

export const importFromUrl = createServerFn({ method: "POST" })
  .validator(z.object({ url: z.string().min(4).max(2000) }))
  .handler(async ({ data }) => {
    let raw = data.url.trim();
    if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
    const target = new URL(raw);
    if (BLOCKED.test(target.hostname) || target.hostname === "0.0.0.0") {
      throw new Error("That address cannot be fetched.");
    }
    const href = rewrite(target.toString());
    const res = await fetch(href, {
      redirect: "follow",
      headers: {
        Accept: "application/octet-stream,*/*",
        "User-Agent": "Mozilla/5.0 (compatible; Grok64Emu/1.0)",
      },
    });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len > MAX) throw new Error("File is larger than 6 MB.");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX) throw new Error("File is larger than 6 MB.");
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("text/html")) {
      throw new Error(
        "Got a web page instead of a disk image. On Drive, set the file to Anyone with the link, or use Files on iPhone.",
      );
    }
    const name = filenameOf(href, res.headers.get("content-disposition"));
    if (!OK_EXT.test(name) && !OK_EXT.test(target.pathname)) {
      throw new Error("Not a C64 image (use .prg .d64 .crt .t64 .tap .zip .g64).");
    }
    return { name, base64: buf.toString("base64"), size: buf.byteLength };
  });
