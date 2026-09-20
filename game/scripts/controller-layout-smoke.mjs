/**
 * Browser smoke: phone controller always shows Recenter + Ready + Block.
 * Run with Vite up: node scripts/controller-layout-smoke.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { WebSocket } from "ws";

const ARTIFACTS = "/opt/cursor/artifacts";
mkdirSync(ARTIFACTS, { recursive: true });
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:5173";

async function waitForServer(url, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Server not reachable: " + url);
}

function openHostWs(room) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:5173/motion-ws?room=${room}&role=host`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

async function main() {
  await waitForServer(BASE + "/");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  const room = "SMOKE1";
  const hostWs = await openHostWs(room);

  await page.goto(`${BASE}/controller?room=${room}`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(800);

  await page.waitForSelector(".controller-fight-recenter", { timeout: 10_000 });
  await page.waitForSelector(".controller-fight-ready", { timeout: 5_000 });
  await page.waitForSelector(".controller-fight-block", { timeout: 5_000 });
  await page.screenshot({ path: `${ARTIFACTS}/controller_three_button_layout.png`, fullPage: true });

  console.log("RECENTER", await page.locator(".controller-fight-recenter").isVisible());
  console.log("READY", await page.locator(".controller-fight-ready").isVisible());
  console.log("BLOCK", await page.locator(".controller-fight-block").isVisible());
  console.log("FULLSCREEN_ABSENT", (await page.locator(".controller-ready-fullscreen").count()) === 0);
  console.log("METRICS_ABSENT", (await page.locator(".controller-metrics").count()) === 0);

  hostWs.close();
  await browser.close();
  console.log("SMOKE_OK");
}

main().catch((error) => {
  console.error("SMOKE_FAIL", error);
  process.exit(1);
});
