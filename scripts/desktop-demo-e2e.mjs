#!/usr/bin/env node
/**
 * Multi-disk demo smoke — GROK64_DEMO_DIR with .d64/.d71/.m3u (private).
 *   GROK64_DEMO_DIR=/path npm run test:desktop-demo
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { canvasHasSignal, powerOnDesktop, waitRunning } from "./desktop-qa-lib.mjs";

const dir = process.env.GROK64_DEMO_DIR;
const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const outDir = join(process.cwd(), "artifacts", "desktop-demo-e2e");
mkdirSync(outDir, { recursive: true });

if (!dir || !existsSync(dir)) {
  writeFileSync(join(outDir, "results.json"), JSON.stringify({ skipped: true, reason: "GROK64_DEMO_DIR missing" }));
  console.log("SKIP desktop-demo (set GROK64_DEMO_DIR)");
  process.exit(0);
}

function bootOrder(files) {
  const m3u = files.find((f) => f.toLowerCase().endsWith(".m3u"));
  if (m3u) {
    const lines = readFileSync(join(dir, m3u), "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    return lines.map((l) => files.find((f) => f.toLowerCase() === l.toLowerCase()) || l).filter(Boolean);
  }
  return files.filter((f) => /\.(d64|d71|d81|g64|g71)$/i.test(f)).sort();
}

const all = readdirSync(dir);
const order = bootOrder(all);
if (!order.length) {
  console.log("SKIP no disks in demo dir");
  process.exit(0);
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await powerOnDesktop(page, base);

const rows = [];
for (const file of order.slice(0, 4)) {
  const path = join(dir, file);
  if (!existsSync(path)) continue;
  const bytes = [...readFileSync(path)];
  await page.evaluate(
    async ({ file, bytes }) => {
      await window.__g64?.playBytes?.(file, bytes);
    },
    { file, bytes },
  );
  await waitRunning(page, 90000);
  await page.waitForTimeout(12000);
  rows.push({ file, pass: await canvasHasSignal(page) });
}

writeFileSync(join(outDir, "results.json"), JSON.stringify({ rows }, null, 2));
await browser.close();
const failed = rows.filter((r) => !r.pass).length;
console.log(JSON.stringify({ rows, failed }, null, 2));
process.exit(failed ? 1 : 0);
