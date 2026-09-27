// Windows smoke test for the built JDF Reader: launches the real exe with WebView2
// remote debugging enabled, attaches over CDP, opens a fixture through the recent
// list (real Rust read_text_file / read_binary_file), and reports what rendered.
//   node scripts/win-smoke.mjs [exe] [fixture] [screenshot.png]
// Defaults: the release exe from `pnpm --filter @jdf/reader tauri build`,
// spec/examples/elements-gallery.jdf, .win-smoke.png. Exit 1 on any console
// error, [unknown:] marker, "Open failed" toast or a <video> that did not load.
// This is the Windows counterpart of the parity gate's browser render: the gate
// runs apps/reader/dist in Chrome without Tauri's CSP, so a CSP block (as the
// video element hit on 0.2.3) only shows up here, in the real WebView2.
import { spawn } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require(path.join(repo, "node_modules/.pnpm/node_modules/playwright"))); } catch { ({ chromium } = await import("playwright")); }

const [exeArg, fixtureArg, shotArg] = process.argv.slice(2);
const exe = exeArg || path.join(repo, "apps/reader/src-tauri/target/release/jdf-reader.exe");
const fixture = fixtureArg || path.join(repo, "spec/examples/elements-gallery.jdf");
const shot = shotArg || path.join(repo, ".win-smoke.png");
const abs = path.resolve(fixture);
const PORT = 9222;
// Own WebView2 profile: instances sharing a user-data folder share one browser process,
// so a reader the user already has open would swallow our debugging flag (and we must never kill theirs).
const userData = path.join(process.env.TEMP || process.env.TMP || ".", "jdf-smoke-webview2");
const proc = spawn(exe, [], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`, WEBVIEW2_USER_DATA_FOLDER: userData },
  stdio: "ignore", detached: false,
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browser;
for (let i = 0; i < 40 && !browser; i++) {
  await sleep(500);
  try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); } catch {}
}
if (!browser) { console.log("FAIL: could not attach to WebView2"); proc.kill(); process.exit(1); }
const result = { fixture: path.basename(abs), errors: [] };
try {
  const ctx = browser.contexts()[0];
  let page = ctx.pages()[0];
  page.on("pageerror", (e) => result.errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") result.errors.push(m.text()); });
  await page.waitForLoadState("domcontentloaded");
  await sleep(1000);
  result.firstRunWizardShown = await page.evaluate(() => !!document.querySelector(".z-\\[9999\\]"));
  result.csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || "(no meta csp)");
  // Seed recent list + skip wizard, then reload so the welcome screen shows the fixture.
  await page.evaluate((abs) => { localStorage.setItem("jdf-first-run-done", "1"); localStorage.setItem("jdf-recent", JSON.stringify([abs])); }, abs);
  await page.reload();
  await sleep(800);
  await page.getByText(path.basename(abs), { exact: true }).click({ timeout: 10000 });
  await page.waitForSelector(".jdf-page", { timeout: 15000 });
  await sleep(2500);
  const info = await page.evaluate(() => {
    const top = [...document.querySelectorAll(".jdf-page [data-jdf-type]")].filter((n) => !n.parentElement.closest("[data-jdf-type]")).map((n) => n.dataset.jdfType);
    const unknown = document.body.innerText.match(/\[unknown:[^\]]*\]/g) || [];
    const videos = [...document.querySelectorAll("video")].map((v) => ({ src: v.currentSrc.slice(0, 60), readyState: v.readyState, networkState: v.networkState, error: v.error ? `${v.error.code}:${v.error.message}` : null, tracks: v.textTracks.length, w: v.videoWidth, h: v.videoHeight }));
    const images = [...document.querySelectorAll(".jdf-page img")].map((i) => ({ complete: i.complete, natural: i.naturalWidth }));
    const forms = { inputs: document.querySelectorAll(".jdf-page input, .jdf-page textarea, .jdf-page select").length, canvases: document.querySelectorAll(".jdf-page canvas").length };
    const toast = document.body.innerText.match(/Open failed[^\n]*/)?.[0] || null;
    const title = document.querySelector("[data-titlebar], .titlebar")?.textContent?.trim() || null;
    return { top, unknown, videos, images, forms, toast, title, dark: document.documentElement.classList.contains("dark") };
  });
  Object.assign(result, info);
  await page.screenshot({ path: shot, fullPage: false });
} catch (e) {
  result.errors.push(`script: ${String(e.message).split("\n")[0]}`);
} finally {
  console.log(JSON.stringify(result, null, 2));
  try { await browser.close(); } catch {}
  proc.kill();
  // WebView2 helper processes can outlive the parent
  spawn("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { stdio: "ignore" });
  const badVideo = (result.videos || []).some((v) => v.error || v.readyState < 1);
  const bad = result.errors.length || (result.unknown || []).length || result.toast || badVideo;
  console.log(bad ? "\nWindows smoke FAILED" : "\nWindows smoke passed: real app renders the fixture with no CSP/console errors.");
  process.exitCode = bad ? 1 : 0;
}
