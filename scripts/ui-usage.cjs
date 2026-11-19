const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((defaults) => {
    let globalSettings =
      JSON.parse(localStorage.getItem("fixture-global-settings") || "null") ||
      defaults;
    localStorage.setItem("workbench.theme", "dark");
    window.isTauri = true;
    window.usageCalls = [];
    window.failUsage = false;
    window.delayUsage = false;
    const total = (count) => ({
      responses: 2,
      tokens: {
        input: count - 20,
        output: 20,
        total: count,
        cached: 10,
        reasoning: null,
      },
      firstRecordedAt: 1700000000,
      incompleteResponses: 0,
    });
    let workspace = {
      version: 1,
      environments: [
        {
          id: "personal",
          name: "Personal",
          color: "violet",
          instructions: "Personal instructions",
        },
        {
          id: "work",
          name: "Work",
          color: "blue",
          instructions: "Work instructions",
        },
      ],
      projects: [
        {
          id: "project",
          environmentId: "personal",
          name: "Selected project",
          path: "/projects/fixture",
          memory: "Project memory stays",
        },
      ],
      conversations: [],
    };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      invoke: async (command, args = {}) => {
        if (command === "openai_manage_usage") {
          window.usageManaged = true;
          return;
        }
        if (command === "openai_usage") {
          window.usageCalls.push(args);
          if (window.failUsage) throw "Could not read token usage.";
          const snapshot = {
            connected: true,
            recordingIssue: false,
            allTime: total(args.environmentId === "personal" ? 140 : 720),
            today: total(60),
            lastSevenDays: total(100),
            daily: [
              {
                date: new Date().toISOString().slice(0, 10),
                totalTokens: 60,
                responses: 1,
              },
            ],
            recent: [
              {
                model: "fixture-model",
                source: "review",
                createdAt: 1700000000,
                tokens: total(30).tokens,
              },
            ],
          };
          if (window.delayUsage)
            await new Promise((resolve) => setTimeout(resolve, 800));
          return snapshot;
        }
        if (command === "terminal_preferences")
          return {
            global: { executable: "/bin/bash", args: [] },
            environmentOverride: null,
            effective: { executable: "/bin/bash", args: [] },
          };
        if (command === "load_app_settings")
          return structuredClone(globalSettings);
        if (command === "save_app_settings") {
          globalSettings = structuredClone(args.settings);
          localStorage.setItem(
            "fixture-global-settings",
            JSON.stringify(globalSettings),
          );
          return;
        }

        if (command.startsWith("plugin:window|")) return false;
        if (command === "load_workspace") return structuredClone(workspace);
        if (command === "save_workspace") {
          workspace = structuredClone(args.workspace);
          window.savedSettingsWorkspace = structuredClone(workspace);
          return;
        }
        if (command === "openai_accounts")
          return ["personal", "work"].map((environmentId) => ({
            environmentId,
            email: `${environmentId}@example.test`,
            connected: true,
            eligible: true,
          }));
        if (command === "openai_models" || command === "worker_history")
          return [];
        if (command === "desktop_integration_status")
          return { supported: true, installed: true, issue: null };
        if (command === "worker_runtime")
          return {
            available: true,
            ready: true,
            message: "Codex is ready. Execution is isolated by project.",
          };
        throw new Error(`Unexpected command: ${command}`);
      },
    };
  }, require("../src/global-settings-defaults.json"));
  await page.goto("http://127.0.0.1:1420");
  const dialog = page.getByRole("dialog");
  const open = () =>
    page.getByRole("button", { name: "Usage", exact: true }).click();
  await open();
  await dialog
    .getByRole("heading", { name: "Tokens recorded by this app" })
    .waitFor();
  await dialog
    .locator(".usage-metric")
    .filter({ hasText: "All recorded usage" })
    .getByText("140", { exact: true })
    .waitFor();
  assert.equal(
    await dialog
      .getByText("Not provided by this connection", { exact: true })
      .count(),
    2,
  );
  await dialog.getByText("Not reported", { exact: true }).waitFor();
  await dialog.getByText("Approval review", { exact: false }).waitFor();
  await dialog.getByRole("button", { name: "Manage usage" }).click();
  assert.equal(await page.evaluate(() => window.usageManaged), true);
  await page.screenshot({ path: "artifacts/usage-dark.png" });
  await page.evaluate(() => {
    window.failUsage = true;
  });
  await dialog.getByRole("button", { name: "Refresh usage" }).click();
  await dialog
    .getByRole("alert")
    .filter({ hasText: "Could not read token usage." })
    .waitFor();
  await page.evaluate(() => {
    window.failUsage = false;
  });
  await dialog.getByRole("button", { name: "Refresh usage" }).click();
  await dialog
    .locator(".usage-metric")
    .filter({ hasText: "All recorded usage" })
    .getByText("140", { exact: true })
    .waitFor();
  await page.evaluate(() => {
    window.delayUsage = true;
  });
  await dialog.getByRole("button", { name: "Refresh usage" }).click();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Environment Work", exact: true })
    .click();
  await open();
  await dialog.getByText("Usage in Work", { exact: true }).waitFor();
  assert.equal(await dialog.getByText("140", { exact: true }).count(), 0);
  await dialog
    .locator(".usage-metric")
    .filter({ hasText: "All recorded usage" })
    .getByText("720", { exact: true })
    .waitFor();
  await page.waitForTimeout(900);
  assert.equal(await dialog.getByText("140", { exact: true }).count(), 0);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Global settings", exact: true })
    .click();
  await dialog.getByRole("combobox", { name: /Language/ }).selectOption("pt");
  await dialog.getByRole("radio", { name: "Claro", exact: true }).check();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Utilização", exact: true }).click();
  await dialog
    .getByText("Limites do plano e créditos", { exact: true })
    .waitFor();
  await dialog.getByText("Não reportado", { exact: true }).waitFor();
  await page.setViewportSize({ width: 1000, height: 760 });
  await page.screenshot({ path: "artifacts/usage-light-pt.png" });
  assert.equal(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    true,
  );
  assert.ok(
    await page.evaluate(() =>
      window.usageCalls.every(
        (call) =>
          ["personal", "work"].includes(call.environmentId) &&
          ["en", "pt"].includes(call.locale),
      ),
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "Usage UI passed: measured tokens, unknown limits, manage action, retry, stale scope rejection and Portuguese/light layout.",
  );
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
