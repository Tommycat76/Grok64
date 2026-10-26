#!/usr/bin/env node
/**
 * SD2IEC card source A (.img) + B (host folder via OPFS handle) through real IEC UI.
 *   npm run test:desktop-sd2iec-card-sources
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { powerOnDesktop, typeBasic, waitRunning } from "./desktop-qa-lib.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const outDir = join(process.cwd(), "artifacts", "desktop-sd2iec-card-sources");
mkdirSync(outDir, { recursive: true });

const rows = [];

function prgPayload(tag) {
  const body = new Uint8Array(10);
  body[0] = 1;
  body[1] = 8;
  for (let i = 2; i < body.length; i++) body[i] = (tag + i) & 0xff;
  return body.buffer;
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

try {
  await powerOnDesktop(page, base);
  await waitRunning(page, 120_000);

  await page.evaluate(() => window.__g64?.setIecSlot?.(8, "sd2iec"));
  await page.waitForTimeout(800);

  const fatMount = await page.evaluate(async () => {
    await window.__g64?.seedSd?.([
      { name: "IMGSRC.PRG", path: "", data: new Uint8Array([1, 8, 0, 10, 0xaa]).buffer },
    ]);
    const blob = await window.__g64?.exportSdImage?.();
    const buf = await blob.arrayBuffer();
    await window.__g64?.clearSd2iecMount?.();
    const meta = await window.__g64?.mountSdFatImage?.(buf, "QA.IMG");
    const dos = await window.__g64?.runDos?.("X");
    return { meta, dos };
  });
  rows.push({
    id: "fat-image-mount-meta",
    pass: fatMount.meta?.kind === "fat-image" && fatMount.meta?.rawBlockAccess === false,
    detail: fatMount.meta,
  });

  await page.evaluate(() => window.__g64?.setIecSlot?.(8, "sd2iec"));
  await page.waitForTimeout(800);
  await typeBasic(page, 'LOAD"$",8', { afterMs: 22_000 });
  let text = await page.evaluate(() => window.__g64?.screenText?.() || "");
  const fatList = await page.evaluate(() => {
    const iec = window.__g64?.debugWasmIec?.(8, 0);
    const head = iec?.head ?? [];
    const wasmDir =
      (iec?.dataLen ?? 0) > 32 && head.includes(71) && head.includes(82) && head.includes(79);
    return { wasmDir, dataLen: iec?.dataLen ?? 0 };
  });
  rows.push({
    id: "fat-image-load-dollar",
    pass: fatList.wasmDir || /IMGSRC|PRG|BLOCKS|GROK64/i.test(text),
    head: text.slice(0, 100),
    detail: fatList,
  });

  const hostMount = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("grok64-sd2iec-qa", { create: true });
    const fh = await dir.getFileHandle("HOSTDIR.PRG", { create: true });
    const w = await fh.createWritable();
    await w.write(new Uint8Array([1, 8, 0, 10, 0xbb]));
    await w.close();
    const meta = await window.__g64?.mountSdHostFolder?.(dir);
    const dos = await window.__g64?.runDos?.("X");
    return { meta, dos };
  });
  rows.push({
    id: "host-folder-mount-meta",
    pass: hostMount.meta?.kind === "host-directory",
    detail: hostMount.meta,
  });

  await page.evaluate(() => window.__g64?.setIecSlot?.(8, "sd2iec"));
  await page.waitForTimeout(800);
  await typeBasic(page, 'LOAD"$",8', { afterMs: 22_000 });
  text = await page.evaluate(() => window.__g64?.screenText?.() || "");
  const hostList = await page.evaluate(() => {
    const iec = window.__g64?.debugWasmIec?.(8, 0);
    const head = iec?.head ?? [];
    const wasmDir =
      (iec?.dataLen ?? 0) > 32 && head.includes(71) && head.includes(82) && head.includes(79);
    return { wasmDir, dataLen: iec?.dataLen ?? 0 };
  });
  rows.push({
    id: "host-folder-load-dollar",
    pass: hostList.wasmDir || /HOSTDIR|PRG|BLOCKS|GROK64/i.test(text),
    head: text.slice(0, 100),
    detail: hostList,
  });

  const native1541 = await page.evaluate(() => {
    window.__g64?.setIecSlot?.(8, "1541");
    window.__g64?.setIecSlot?.(9, "none");
    const opts = window.__g64?.runtimeViceOpts?.() ?? {};
    return { drive8: opts.vice_drive8_type, sdMeta: window.__g64?.sd2iecCardMeta?.() };
  });
  rows.push({
    id: "vice-1541-not-sd2iec-volume",
    pass: native1541.drive8 === "1541" || native1541.drive8 === 1541,
    detail: native1541,
  });

  const hostSupport = await page.evaluate(() => window.__g64?.sd2iecHostFolderSupport?.());
  rows.push({
    id: "chromium-host-folder-api",
    pass: hostSupport?.ok === true,
    detail: hostSupport,
  });
} finally {
  await browser.close();
}

const failed = rows.filter((r) => !r.pass);
const report = { at: new Date().toISOString(), pass: failed.length === 0, rows };
writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(failed.length ? 1 : 0);
