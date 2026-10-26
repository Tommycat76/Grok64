#!/usr/bin/env node
/**
 * X11 xdotool relative moves → monotonic SID POT deltas (1351), GUI64 NTSC.
 *
 *   GROK64_FIX_MEDIA=/tmp/g64media/g64media node scripts/desktop-1351-xdotool-monotonic-proof.mjs
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { canvasLooksLikeGui64 } from "./desktop-qa-lib.mjs";
import { handConfig, openHand, sleep, waitFor, withHandDisplay } from "./desktop-hand-lib.mjs";

const cwd = process.cwd();
const mediaRoot = resolve(process.env.GROK64_FIX_MEDIA || "/tmp/g64media/g64media");
const gui64Path = join(mediaRoot, "GUI64 [NTSC].crt");
const outDir = join(cwd, "artifacts", "1351-xdotool-monotonic");
mkdirSync(outDir, { recursive: true });

function potDelta(prev, next) {
  let dx = (next.potX - prev.potX) & 0xff;
  let dy = (next.potY - prev.potY) & 0xff;
  if (dx > 127) dx -= 256;
  if (dy > 127) dy -= 256;
  return { dx, dy };
}

async function waitFrames(page, n = 30) {
  await page.evaluate((frames) => {
    return new Promise((r) => {
      let left = frames;
      const tick = () => {
        left -= 1;
        if (left <= 0) r(true);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, n);
}

async function ensureMouse(hand, on) {
  await hand.page.evaluate((want) => window.__g64?.setMouseMode?.(want), on);
  await sleep(200);
}

async function ensurePort(hand, port) {
  await hand.page.evaluate((p) => window.__g64?.setJoyPort?.(p), port);
  await sleep(150);
}

async function importAndPlay(hand, filePath) {
  const name = basename(filePath);
  const b64 = readFileSync(filePath).toString("base64");
  await hand.page.evaluate(
    async ({ n, data }) => {
      const bin = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      await window.__g64?.importLibraryBytes?.(n, bin);
      const rows = await window.__g64?.libraryRows?.();
      const row = rows?.find((r) => r.name === n);
      if (!row?.id) throw new Error("library import failed");
      await window.__g64?.playLibrary?.(row.id);
    },
    { n: name, data: b64 },
  );
}

async function screenBox(page) {
  return page.evaluate(() => {
    const el = document.querySelector(".g64-screen");
    const r = el?.getBoundingClientRect();
    if (!r || r.width < 8) return null;
    return { left: r.left, top: r.top, w: r.width, h: r.height };
  });
}

async function main() {
  if (!existsSync(gui64Path)) {
    const run = { pass: false, skipped: true, reason: "missing-gui64", path: gui64Path };
    writeFileSync(join(outDir, "results.json"), JSON.stringify(run, null, 2));
    console.log(JSON.stringify(run));
    process.exit(0);
  }

  const cfg = handConfig();
  const run = { pass: false, vectors: [], sha1: createHash("sha1").update(readFileSync(gui64Path)).digest("hex") };

  await withHandDisplay(cfg, async () => {
    const hand = await openHand(cfg);
    try {
      await hand.start();
      await hand.ensurePowered();
      await importAndPlay(hand, gui64Path);
      await waitFor(async () => (await canvasLooksLikeGui64(hand.page)).pass, 180_000, 600);
      await ensureMouse(hand, true);
      await ensurePort(hand, 1);
      await sleep(800);
      run.plugRc = await hand.page.evaluate(() => window.__g64?.mousePlugRc?.());

      const box = await screenBox(hand.page);
      if (!box) throw new Error("no g64-screen");
      const cx = box.left + box.w / 2;
      const cy = box.top + box.h / 2;
      await hand.xmove(cx, cy);
      await sleep(400);

      const readPots = () => hand.page.evaluate(() => window.__g64?.mousePots?.());
      let prev = await readPots();
      if (!prev) throw new Error("mousePots missing");

      const moves = [
        { px: 80, py: 0 },
        { px: 0, py: 40 },
        { px: -30, py: -25 },
      ];

      for (const m of moves) {
        const wantX = Math.round(m.px * (320 / box.w));
        const wantY = Math.round(m.py * (200 / box.h));
        const parts = 4;
        for (let i = 0; i < parts; i++) {
          await hand.sh("xdotool", [
            "mousemove_relative",
            "--sync",
            String(Math.round(m.px / parts)),
            String(Math.round(m.py / parts)),
          ]);
          await waitFrames(hand.page, 10);
        }
        await sleep(500);
        const next = await readPots();
        const { dx, dy } = potDelta(prev, next);
        const row = {
          hostPx: m,
          wantX,
          wantY,
          potDx: dx,
          potDy: dy,
          ratioX: wantX ? dx / wantX : null,
          ratioY: wantY ? dy / wantY : null,
        };
        run.vectors.push(row);
        prev = next;
      }

      run.pass = run.vectors.every((r) => {
        if (r.wantX) {
          if (Math.sign(r.potDx) !== Math.sign(r.wantX) && Math.abs(r.potDx) > 4) return false;
          const ratio = Math.abs(r.ratioX);
          if (ratio < 0.3 || ratio > 2.5) return false;
        }
        if (r.wantY) {
          if (Math.sign(r.potDy) !== Math.sign(r.wantY) && Math.abs(r.potDy) > 4) return false;
          const ratio = Math.abs(r.ratioY);
          if (ratio < 0.3 || ratio > 2.5) return false;
        }
        return true;
      });
    } finally {
      await hand.close();
    }
  });

  writeFileSync(join(outDir, "results.json"), JSON.stringify(run, null, 2));
  console.log(JSON.stringify({ pass: run.pass, plugRc: run.plugRc, vectors: run.vectors }));
  process.exit(run.pass ? 0 : 1);
}

main().catch((err) => {
  writeFileSync(join(outDir, "results.json"), JSON.stringify({ pass: false, error: String(err) }, null, 2));
  console.error(err);
  process.exit(1);
});
