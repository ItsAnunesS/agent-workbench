const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((defaults) => {
    window.isTauri = true;
    window.updateChecks = 0;
    window.updateInstalls = 0;
    window.checkFailure = false;
    window.installFailure = false;
    window.updateSupported = true;
    window.latestVersion = "1.10.0";
    const callbacks = new Map();
    let callbackId = 0;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      transformCallback: (callback) => { callbacks.set(++callbackId, callback); return callbackId; },
      unregisterCallback: (id) => callbacks.delete(id),
      invoke: async (command, args = {}) => {
        if (command.startsWith("plugin:window|")) return false;
        if (command === "load_workspace") return {
          version: 1,
          environments: [{ id: "personal", name: "Personal", color: "violet", instructions: "" }],
          projects: [], conversations: [],
        };
        if (command === "openai_accounts" || command === "worker_history") return [];
        if (command === "load_app_settings") return structuredClone(defaults);
        if (command === "terminal_preferences") return {
          global: { executable: "/bin/bash", args: [] }, environmentOverride: null,
          effective: { executable: "/bin/bash", args: [] },
        };
        if (command === "worker_runtime") return { available: false, ready: false, message: "" };
        if (command === "desktop_integration_status") return { supported: false, installed: false, issue: null };
        if (command === "app_update_check") {
          window.updateChecks++;
          if (window.checkFailure) throw "GitHub is limiting update checks. Try again later.";
          return { supported: window.updateSupported, version: window.updateSupported ? window.latestVersion : null };
        }
        if (command === "app_update_install") {
          window.updateInstalls++;
          assertVersion(args.version);
          if (window.installFailure) throw "The update size or checksum does not match the release.";
          callbacks.get(args.progress.id)({ index: 0, message: { downloaded: 50, total: 100 } });
          await new Promise((resolve) => { window.finishUpdate = resolve; });
          return;
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    };
    function assertVersion(version) {
      if (version !== window.latestVersion) throw new Error("Wrong version requested");
    }
  }, require("../src/global-settings-defaults.json"));
  await page.goto(process.env.APP_URL || "http://127.0.0.1:1420");
  const dialog = page.getByRole("dialog");
  const openSettings = () => page.getByRole("button", { name: "Global settings", exact: true }).click();
  await page.getByRole("button", { name: "Update available", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.updateChecks), 1);
  assert.equal(await page.evaluate(() => window.updateInstalls), 0);
  await openSettings();
  const automatic = dialog.getByRole("checkbox", { name: "Check GitHub releases automatically" });
  assert.equal(await automatic.isChecked(), true);
  await automatic.uncheck();
  await page.reload();
  await openSettings();
  assert.equal(await automatic.isChecked(), false);
  await page.waitForTimeout(3200);
  assert.equal(await page.evaluate(() => window.updateChecks), 0);
  await page.evaluate(() => { window.checkFailure = true; });
  const check = dialog.getByRole("button", { name: "Check for updates", exact: true });
  await check.click();
  await dialog.getByRole("alert").filter({ hasText: "GitHub is limiting" }).waitFor();
  await page.evaluate(() => { window.checkFailure = false; });
  await check.click();
  await dialog.getByText("Version 1.10.0 is available.", { exact: true }).waitFor();
  await page.evaluate(() => { window.installFailure = true; });
  await dialog.getByRole("button", { name: "Download and install", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "checksum" }).waitFor();
  await page.evaluate(() => { window.installFailure = false; });
  await dialog.getByRole("button", { name: "Download and install", exact: true }).click();
  await dialog.getByText("Downloading update: 50%", { exact: true }).waitFor();
  assert.equal(await check.isDisabled(), true);
  await page.keyboard.press("Escape");
  await openSettings();
  await dialog.getByText("Downloading update: 50%", { exact: true }).waitFor();
  await page.evaluate(() => window.finishUpdate());
  await dialog.getByText("Update installed. Close and reopen the app when your work is finished.", { exact: true }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: "Download and install", exact: true }).count(), 0);
  await dialog.getByRole("combobox", { name: /Language/ }).selectOption("pt");
  await dialog.getByText("Atualização instalada. Feche e volte a abrir a aplicação quando terminar o seu trabalho.", { exact: true }).waitFor();
  await page.screenshot({ path: process.env.UPDATE_SCREENSHOT || "/tmp/agent-workbench-updates.png", fullPage: true });
  await dialog.getByRole("combobox", { name: /Idioma/ }).selectOption("en");
  await page.reload();
  await openSettings();
  await page.evaluate(() => { window.latestVersion = null; });
  await check.click();
  await dialog.getByText("You are using the latest version.", { exact: true }).waitFor();
  await page.evaluate(() => { window.updateSupported = false; });
  await check.click();
  await dialog.getByText("In-app updates require the Linux x86_64 AppImage.", { exact: true }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: "Download and install", exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  await browser.close();
  console.log("Updates UI passed: automatic checks, persisted opt-out, manual retries, download progress, modal reopening, deferred activation, Portuguese labels and unsupported platforms.");
})().catch((error) => { console.error(error); process.exit(1); });
