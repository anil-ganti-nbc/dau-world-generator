#!/usr/bin/env node
// E2E smoke: generate → probe → freeze → commit through the real UI.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const PORT = 8097;
const BASE = `http://localhost:${PORT}/`;
function fail(m) { console.error(`✖ ${m}`); process.exit(1); }
async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  fail(`server not ready: ${url}`);
}

const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const cwd = fileURLToPath(new URL("..", import.meta.url));
// Windows requires shell:true for .cmd shims (Node ≥ 18.20 batch-file hardening).
const vite = spawn(NPM, ["run", "dev"], { cwd, stdio: "ignore", detached: true, shell: process.platform === "win32" });

try {
  await waitForServer(BASE);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e?.message || e)));

  await page.goto(`${BASE}?practice=demo`, { waitUntil: "domcontentloaded" });
  await page.getByText("DAU World Generator").first().waitFor({ timeout: 10_000 });
  // demo payload auto-generates a world
  await page.locator("#world:not(.hidden)").waitFor({ timeout: 10_000 });
  console.log("✔ demo practice payload rendered a world");

  const briefingLen = (await page.locator("#briefing p").count());
  if (briefingLen < 2) fail("briefing should have multiple paragraphs");
  console.log(`✔ briefing rendered (${briefingLen} paragraphs)`);

  // probe three distinct actions
  const buttons = page.locator("#actions button");
  const n = Math.min(3, await buttons.count());
  for (let i = 0; i < n; i++) {
    await buttons.nth(i).click();
    await page.waitForTimeout(50);
  }
  const obsCount = await page.locator("#log .obs").count();
  if (obsCount !== n) fail(`expected ${n} observations in log, got ${obsCount}`);
  console.log(`✔ probing recorded ${obsCount} observations`);

  // re-probing the same action must not duplicate
  await buttons.nth(0).click();
  const obsAfterReprobe = await page.locator("#log .obs").count();
  if (obsAfterReprobe !== n) fail("re-probe should replace, not duplicate");
  console.log("✔ re-probe replaces earlier reading");

  // freeze first hypothesis -> commit becomes available
  await page.locator("#hypotheses .hypothesis").first().click();
  const commitDisabled = await page.locator("#commit").isDisabled();
  if (commitDisabled) fail("commit should be enabled after freezing a hypothesis");
  await page.locator("#commit").click();
  await page.locator("#result:not(.hidden)").waitFor({ timeout: 5_000 });
  const verdict = await page.locator("#result-body p").first().textContent();
  console.log(`✔ committed; verdict: ${verdict.trim().slice(0, 40)}…`);

  const resultJson = await page.locator(".result-json").textContent();
  JSON.parse(resultJson);
  console.log("✔ result payload is valid JSON");

  if (errors.length) fail(`page errors: ${errors.join("; ")}`);
  console.log("✔ no page errors");

  await browser.close();
  console.log("\ne2e smoke passed");
} finally {
  // Kill the whole detached process group; on Windows use taskkill /T.
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(vite.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {}
  } else {
    try { process.kill(-vite.pid); } catch {}
  }
}
