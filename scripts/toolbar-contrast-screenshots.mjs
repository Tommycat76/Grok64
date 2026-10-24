#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { patchLocalStorage, powerOnDesktop } from "./desktop-qa-lib.mjs";

const outDir = process.argv[2] ?? "screenshots/toolbar";
const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(base, { waitUntil: "domcontentloaded" });
await patchLocalStorage(page, { video: "ntsc" });
await page.reload();
await powerOnDesktop(page, base, { navigate: false });
await page.waitForTimeout(2500);
const name = process.argv[3] ?? "toolbar-desktop-1280.png";
await page.locator(".g64-top").screenshot({ path: join(outDir, name) });
await page.screenshot({ path: join(outDir, name.replace(".png", "-full.png")), fullPage: false });
console.log("wrote", join(outDir, name));
await browser.close();
