const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 920 },
    colorScheme: "dark",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.isTauri = true;
    window.windowCalls = [];
    let maximized = false;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      invoke: async (command, args = {}) => {
        if (command.startsWith("plugin:window|")) {
          window.windowCalls.push({ command, label: args.label });
          if (command.endsWith("is_maximized")) return maximized;
          if (command.endsWith("toggle_maximize")) {
            maximized = !maximized;
            window.dispatchEvent(new Event("resize"));
          }
          return;
        }
        if (command === "desktop_integration_status")
          return { supported: true, installed: false, issue: "Could not check system integration." };
        if (command === "desktop_integration_repair") { window.desktopRepaired = true; return { supported: true, installed: true, issue: null }; }
        if (command === "load_workspace")
          return {
            version: 1,
            environments: [
              {
                id: "personal",
                name: "Personal",
                color: "violet",
                instructions: "",
              },
            ],
            projects: [],
            conversations: [],
          };
        if (command === "openai_accounts") return [];
        if (command === "worker_runtime")
          return { available: true, ready: true, message: "Codex is ready. Execution is isolated by project." };
        throw `Unexpected command: ${command}`;
      },
    };
  });
  await page.goto("http://127.0.0.1:1420");
  await page.getByRole("heading", { name: "An idea starts here." }).waitFor();
  // Exercise the drag handler shipped by the installed Tauri version, including its interactive-element guard.
  const lock = fs.readFileSync("/workspace/src-tauri/Cargo.lock", "utf8");
  const version = lock.match(/name = "tauri"\nversion = "([^"]+)"/)[1];
  const registry = "/workspace/.build-cache/cargo/registry/src";
  const script = fs
    .readdirSync(registry)
    .map((entry) =>
      path.join(
        registry,
        entry,
        `tauri-${version}`,
        "src/window/scripts/drag.js",
      ),
    )
    .find((candidate) => fs.existsSync(candidate));
  assert.ok(
    script,
    "Build the native app before running the window integration test",
  );
  await page.addScriptTag({
    content: fs
      .readFileSync(script, "utf8")
      .replaceAll("__TEMPLATE_os_name__", '"linux"'),
  });
  await page.locator(".breadcrumb span").first().click();
  await page.locator(".breadcrumb span").first().dblclick();
  await page
    .getByRole("button", { name: "Restore window", exact: true })
    .waitFor();
  const dragCount = await page.evaluate(
    () =>
      window.windowCalls.filter((call) =>
        call.command.endsWith("start_dragging"),
      ).length,
  );
  assert.ok(dragCount > 0);
  await page
    .getByRole("button", { name: "Restore window", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Maximize window", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Minimize window", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Switch to light theme", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Toggle context panel", exact: true })
    .click();
  assert.equal(
    await page.evaluate(
      () =>
        window.windowCalls.filter((call) =>
          call.command.endsWith("start_dragging"),
        ).length,
    ),
    dragCount,
  );
  await page
    .getByRole("button", { name: "Toggle context panel", exact: true })
    .click();
  await page.screenshot({
    path: "/workspace/artifacts/window-light-0.6.0.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Switch to dark theme", exact: true })
    .click();
  await page.screenshot({
    path: "/workspace/artifacts/window-dark-0.6.0.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Global settings", exact: true }).click();
  await page.getByText("Could not check system integration.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Repair integration", exact: true }).click();
  await page.getByText("The logo and launcher are registered in this user's application menu.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.desktopRepaired), true);
  await page
    .getByRole("button", { name: "Close window", exact: true })
    .click();
  await page.keyboard.press("Escape");
  const calls = await page.evaluate(() => window.windowCalls);
  assert.ok(
    calls.some(
      (call) =>
        call.command === "plugin:window|minimize" && call.label === "main",
    ),
  );
  assert.ok(
    calls.some(
      (call) =>
        call.command === "plugin:window|toggle_maximize" &&
        call.label === "main",
    ),
  );
  assert.ok(
    calls.some(
      (call) => call.command === "plugin:window|close" && call.label === "main",
    ),
  );
  await page.setViewportSize({ width: 960, height: 640 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  const bounds = await page.locator(".window-controls").boundingBox();
  assert.ok(bounds.x + bounds.width <= 960 && bounds.y === 0);
  assert.deepEqual(errors, []);
  console.log(
    "Window UI passed: native Tauri drag and double click, minimize, maximize/restore, close, interactive guards, themes and minimum window size.",
  );
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
