/**
 * Browser smoke: simulated pose + two Test slashes; report Hits / Miss HUD.
 * Run: npx playwright test (or node with playwright).
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const ARTIFACTS = "/opt/cursor/artifacts";
mkdirSync(ARTIFACTS, { recursive: true });

function hudRow(page, label) {
  return page.locator(".diagnostic-row").filter({ hasText: label }).locator("strong").first();
}

async function readHud(page) {
  const hits = (await hudRow(page, "HITS").textContent())?.trim() ?? "?";
  const miss = (await hudRow(page, "MISS").textContent())?.trim() ?? "?";
  const weapon = (await hudRow(page, "WEAPON CONTROL").textContent())?.trim() ?? "?";
  const phase = await page.locator(".circle-guard .section-label").first().textContent();
  return { hits, miss, weapon, phase: phase?.trim() ?? "?" };
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--enable-webgl", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("CONSOLE_ERROR:", msg.text());
  });
  page.on("pageerror", (err) => console.log("PAGE_ERROR:", err.message));

  console.log("Navigating...");
  await page.goto("http://localhost:5173/", { waitUntil: "networkidle", timeout: 120_000 });

  // Wait for asset load labels (player/dummy ready-ish)
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `${ARTIFACTS}/solo_hit_01_loaded.png`, fullPage: true });

  // Rim poses only — neutral sits inside MIN_SWING_RADIUS and cannot slash.
  const poseCandidates = ["up", "right", "left", "down", "diagonalRight", "diagonalLeft"];
  let clickedPose = null;
  for (const pose of poseCandidates) {
    const btn = page.getByRole("button", { name: pose, exact: true });
    if (await btn.count()) {
      await btn.click();
      clickedPose = pose;
      break;
    }
  }
  if (!clickedPose) throw new Error("No rim simulated pose button found");
  console.log("Pose:", clickedPose);
  // Let CircleSword aim ease to the rim before Test slash.
  await page.waitForTimeout(1200);

  // Wait until weapon control enabled
  for (let i = 0; i < 40; i++) {
    const hud = await readHud(page);
    console.log(`wait weapon i=${i}`, hud);
    if (hud.weapon === "ENABLED") break;
    await page.waitForTimeout(500);
  }

  // Reset hits if button exists
  const reset = page.getByRole("button", { name: "Reset hits" });
  if (await reset.count()) await reset.click();
  await page.waitForTimeout(300);

  const before = await readHud(page);
  console.log("BEFORE", before);
  await page.screenshot({ path: `${ARTIFACTS}/solo_hit_02_before.png`, fullPage: true });

  const slash = page.getByRole("button", { name: "Test slash" });
  await slash.click();
  await page.waitForTimeout(1500);
  const after1 = await readHud(page);
  console.log("AFTER_SLASH_1", after1);
  await page.screenshot({ path: `${ARTIFACTS}/solo_hit_03_after_slash1.png`, fullPage: true });

  // Wait for recover to aiming
  for (let i = 0; i < 30; i++) {
    const hud = await readHud(page);
    if (hud.phase?.includes("AIMING")) break;
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(800);

  await slash.click();
  await page.waitForTimeout(1500);
  const after2 = await readHud(page);
  console.log("AFTER_SLASH_2", after2);
  await page.screenshot({ path: `${ARTIFACTS}/solo_hit_04_after_slash2.png`, fullPage: true });

  const h0 = Number(before.hits);
  const h1 = Number(after1.hits);
  const h2 = Number(after2.hits);
  const ok =
    h1 === h0 + 1 &&
    h2 === h1 + 1 &&
    (after1.miss === "—" || after1.miss === "-") &&
    (after2.miss === "—" || after2.miss === "-");

  console.log("RESULT_JSON", JSON.stringify({ before, after1, after2, ok, pose: clickedPose }));
  await browser.close();
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
