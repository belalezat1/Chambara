/**
 * Keep Test-slashing until ring-out or stall.
 * Usage: node scripts/solo-hit-until-ringout.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const ARTIFACTS = "/opt/cursor/artifacts";
mkdirSync(ARTIFACTS, { recursive: true });

async function row(page, label) {
  return (
    (await page
      .locator(".diagnostic-row")
      .filter({ hasText: label })
      .locator("strong")
      .first()
      .textContent())?.trim() ?? "?"
  );
}

async function readHud(page) {
  return {
    hits: await row(page, "HITS"),
    miss: await row(page, "MISS"),
    outcome: await row(page, "OUTCOME"),
    weapon: await row(page, "WEAPON CONTROL"),
    phase: (await page.locator(".circle-guard .section-label").first().textContent())?.trim() ?? "?",
    winner: await row(page, "WINNER").catch(() => "—"),
  };
}

async function waitAiming(page) {
  for (let i = 0; i < 40; i++) {
    const phase = (await page.locator(".circle-guard .section-label").first().textContent()) ?? "";
    if (phase.includes("AIMING")) {
      const slash = page.getByRole("button", { name: "Test slash" });
      if (!(await slash.isDisabled())) return true;
    }
    await page.waitForTimeout(100);
  }
  return false;
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--enable-webgl", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto("http://localhost:5173/", { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(6000);
  await page.getByRole("button", { name: "up", exact: true }).click();
  for (let i = 0; i < 30; i++) {
    if ((await row(page, "WEAPON CONTROL")) === "ENABLED") break;
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "Reset hits" }).click();

  const log = [];
  let prevHits = 0;
  let stalled = 0;
  const maxSwings = 25;

  for (let swing = 1; swing <= maxSwings; swing++) {
    await waitAiming(page);
    await page.waitForTimeout(400);
    const before = await readHud(page);
    await page.getByRole("button", { name: "Test slash" }).click();
    await page.waitForTimeout(1400);
    const after = await readHud(page);
    const hits = Number(after.hits);
    const gained = hits > prevHits;
    log.push({ swing, beforeHits: before.hits, afterHits: after.hits, miss: after.miss, outcome: after.outcome, winner: after.winner });
    console.log(JSON.stringify(log[log.length - 1]));

    if (after.outcome === "RINGOUT" || after.winner === "YOU" || after.winner === "OPPONENT") {
      await page.screenshot({ path: `${ARTIFACTS}/solo_ringout_success.png`, fullPage: true });
      console.log("RINGOUT_REACHED", after);
      await browser.close();
      process.exit(0);
    }

    if (!gained) {
      stalled += 1;
      if (stalled >= 3) {
        await page.screenshot({ path: `${ARTIFACTS}/solo_ringout_stalled.png`, fullPage: true });
        console.log("STALLED", after, "log", log);
        await browser.close();
        process.exit(1);
      }
    } else {
      stalled = 0;
      prevHits = hits;
      await page.screenshot({ path: `${ARTIFACTS}/solo_ringout_hit_${hits}.png`, fullPage: true });
    }
  }

  await page.screenshot({ path: `${ARTIFACTS}/solo_ringout_max_swings.png`, fullPage: true });
  console.log("MAX_SWINGS_NO_RINGOUT", log);
  await browser.close();
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(3);
});
