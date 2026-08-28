import { chromium } from "playwright";

const url = process.argv[2] || "http://127.0.0.1:8081/";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("console", (m) => {
  const t = m.text();
  if (/error|simulat|input|probe/i.test(t)) console.log("CONSOLE", t.slice(0, 300));
});
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.getByRole("button", { name: "Power on" }).waitFor({ timeout: 15000 });
await page.evaluate(() =>
  document.querySelector(".g64-power")?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
);
await page.waitForSelector(".g64-top", { timeout: 20000 });
for (let i = 0; i < 50; i++) {
  const ok = await page.evaluate(() => window.__g64?.hasFs?.());
  if (ok) break;
  await page.waitForTimeout(200);
}
const info = await page.evaluate(() => {
  const w = window;
  const emu = w.__g64;
  // reach emu via grok64 internals: dump from player
  const root = document.getElementById("grok64-player");
  const keys = [];
  const gm = root && Object.getOwnPropertyNames(root);
  let moduleKeys = [];
  let sim = null;
  let fnSim = null;
  let raw = null;
  let opts = null;
  try {
    opts = w.__g64?.opts?.();
  } catch (e) {
    opts = String(e);
  }
  // walk possible EJS instance on window
  const inst = Object.values(w).find((v) => v && v.gameManager && v.Module);
  const target = inst || null;
  if (target?.Module) {
    moduleKeys = Object.keys(target.Module).filter((k) =>
      /simulat|input|joy|key|controller|cwrap/i.test(k),
    );
    raw = typeof target.Module._simulate_input;
    sim = typeof target.gameManager.simulateInput;
    fnSim = typeof target.gameManager.functions?.simulateInput;
  }
  return {
    hasFs: w.__g64?.hasFs?.(),
    fileName: w.__g64?.fileName?.(),
    optsType: typeof opts,
    optKeys: opts && typeof opts === "object" ? Object.keys(opts).slice(0, 40) : String(opts).slice(0, 200),
    joy: opts && typeof opts === "object" ? {
      vice_joyport: opts.vice_joyport,
      vice_joyport_type: opts.vice_joyport_type,
      vice_mapper_b: opts.vice_mapper_b,
      vice_mapper_x: opts.vice_mapper_x,
      vice_retropad_options: opts.vice_retropad_options,
    } : null,
    moduleKeys,
    raw,
    sim,
    fnSim,
    pads: [...(navigator.getGamepads?.() || [])].map((p) => p && p.id),
    foundInst: Boolean(target),
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
