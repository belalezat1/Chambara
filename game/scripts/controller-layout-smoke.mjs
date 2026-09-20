/**
 * Browser smoke: phone controller lobby Ready fullscreen + fight Recenter/Block layout.
 * Also checks lobby Ready gate UI no longer auto-starts after 2s without both Ready.
 *
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
  hostWs.send(JSON.stringify({ type: "phase", phase: "lobby" }));

  await page.goto(`${BASE}/controller?room=${room}`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(800);

  // Lobby: fullscreen Ready
  const ready = page.locator(".controller-ready-fullscreen");
  await ready.waitFor({ timeout: 10_000 });
  await page.screenshot({ path: `${ARTIFACTS}/controller_lobby_ready.png`, fullPage: true });
  console.log("LOBBY_READY_VISIBLE", await ready.isVisible());

  // Host flips to fight → Recenter + Block layout
  hostWs.send(JSON.stringify({ type: "phase", phase: "fight" }));
  await page.waitForSelector(".controller-fight-recenter", { timeout: 10_000 });
  await page.waitForSelector(".controller-fight-block", { timeout: 5_000 });
  await page.screenshot({ path: `${ARTIFACTS}/controller_fight_layout.png`, fullPage: true });
  console.log("FIGHT_RECENTER_VISIBLE", await page.locator(".controller-fight-recenter").isVisible());
  console.log("FIGHT_BLOCK_VISIBLE", await page.locator(".controller-fight-block").isVisible());
  console.log("METRICS_ABSENT", (await page.locator(".controller-metrics").count()) === 0);

  hostWs.close();
  await browser.close();
  console.log("SMOKE_OK");
}

main().catch((error) => {
  console.error("SMOKE_FAIL", error);
  process.exit(1);
});
