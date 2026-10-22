#!/usr/bin/env node
/** Verify EmulatorJS applies vice_sid_extra at runtime. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { powerOnDesktop } from "./desktop-qa-lib.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const out = join(process.cwd(), "artifacts", "vice-sid-probe");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await powerOnDesktop(page, base);

const report = await page.evaluate(() => {
  window.__g64?.setSidAddresses?.({ sid2: "0xde00", sid2Model: "8580" });
  const rt = window.__g64?.runtimeViceOpts?.() || {};
  return {
    libretroDocumented: ["vice_sid_extra"],
    libretroNotDocumented: ["vice_sid_extra2", "vice_sid_model3"],
    runtimeAfterStereo: {
      vice_sid_extra: rt.vice_sid_extra,
      vice_sid_model2: rt.vice_sid_model2,
      vice_sid_extra2: rt.vice_sid_extra2,
    },
    stereoHonored: String(rt.vice_sid_extra || "").toLowerCase() === "0xde00",
  };
});

writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
process.exit(report.stereoHonored ? 0 : 1);
