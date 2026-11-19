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
    window.isTauri = true;
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
        if (command === "project_agents") return { path: null, content: null };
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
  const globalSettings = () =>
    page.getByRole("button", { name: "Global settings", exact: true }).click();
  const workspaceSettings = () =>
    page
      .getByRole("button", { name: "Workspace settings", exact: true })
      .click();
  await globalSettings();
  await dialog
    .getByRole("heading", { name: "Global settings", exact: true })
    .waitFor();
  await dialog.getByRole("combobox", { name: /Language/ }).waitFor();
  await dialog.getByRole("radio", { name: "Dark", exact: true }).check();
  assert.equal(await dialog.locator(".settings-account-card").count(), 0);
  assert.equal(
    await dialog.getByText("personal@example.test", { exact: true }).count(),
    0,
  );
  await dialog.getByText("System integration", { exact: true }).waitFor();
  await dialog.getByText("Codex runtime", { exact: true }).waitFor();
  await dialog
    .getByText("Global AGENTS.md and Git conventions", { exact: true })
    .click();
  await dialog
    .getByRole("textbox", { name: "Global AGENTS.md", exact: true })
    .fill("# Global rules\nInclude validation in every task.");
  await dialog
    .getByRole("textbox", { name: "Commit convention", exact: true })
    .fill("fix(scope): concise English description");
  await dialog
    .getByRole("textbox", { name: "Pull request convention", exact: true })
    .fill("Describe behavior and validation.");
  await dialog
    .getByRole("textbox", { name: "Branch naming convention", exact: true })
    .fill("feature/{ticket}-{description}");
  await dialog
    .getByRole("button", { name: "Save global instructions", exact: true })
    .click();
  await dialog
    .getByText("Global instructions saved.", { exact: true })
    .waitFor();
  await page.screenshot({
    path: "/workspace/artifacts/global-settings.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Selected project", exact: true })
    .click();
  await workspaceSettings();
  await dialog
    .getByRole("heading", { name: "Workspace settings", exact: true })
    .waitFor();
  await dialog.getByText("personal@example.test", { exact: true }).waitFor();
  assert.equal(
    await dialog.getByRole("combobox", { name: /Language/ }).count(),
    0,
  );
  assert.equal(await dialog.getByRole("radio").count(), 0);
  assert.equal(
    await dialog
      .getByRole("textbox", { name: "Global AGENTS.md", exact: true })
      .count(),
    0,
  );
  await dialog.getByText("Project settings", { exact: true }).waitFor();
  await dialog.getByText("/projects/fixture", { exact: true }).waitFor();
  await dialog.getByText("Project memory stays", { exact: true }).waitFor();
  assert.equal(
    await dialog.getByText("Codex runtime", { exact: true }).count(),
    0,
  );
  await page.screenshot({
    path: "/workspace/artifacts/workspace-settings.png",
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Edit workspace instructions", exact: true })
    .click();
  const instructions = dialog.getByRole("textbox");
  assert.equal(await instructions.inputValue(), "Personal instructions");
  await instructions.fill("Updated workspace instructions");
  await dialog
    .getByRole("button", { name: "Save context", exact: true })
    .click();
  const saved = await page.evaluate(() => window.savedSettingsWorkspace);
  assert.equal(
    saved.environments[0].instructions,
    "Updated workspace instructions",
  );
  assert.equal(saved.environments[1].instructions, "Work instructions");
  assert.equal(saved.projects[0].memory, "Project memory stays");
  await page
    .getByRole("button", { name: "Environment Work", exact: true })
    .click();
  await workspaceSettings();
  await dialog.getByText("work@example.test", { exact: true }).waitFor();
  assert.equal(
    await dialog.getByText("personal@example.test", { exact: true }).count(),
    0,
  );
  await page.keyboard.press("Escape");
  await globalSettings();
  await dialog
    .getByText("Global AGENTS.md and Git conventions", { exact: true })
    .click();
  assert.equal(
    await dialog
      .getByRole("textbox", { name: "Global AGENTS.md", exact: true })
      .inputValue(),
    "# Global rules\nInclude validation in every task.",
  );
  assert.equal(
    await dialog
      .getByRole("textbox", { name: "Branch naming convention", exact: true })
      .inputValue(),
    "feature/{ticket}-{description}",
  );
  assert.equal(
    await dialog.getByRole("radio", { name: "Dark", exact: true }).isChecked(),
    true,
  );
  await dialog.getByRole("combobox", { name: /Language/ }).selectOption("pt");
  await dialog
    .getByRole("heading", { name: "Definições globais", exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Definições do workspace", exact: true })
    .click();
  await dialog
    .getByRole("heading", { name: "Definições do workspace", exact: true })
    .waitFor();
  await dialog.getByText("work@example.test", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.reload();
  await page
    .getByRole("button", { name: "Definições globais", exact: true })
    .click();
  await dialog
    .getByText("AGENTS.md global e convenções Git", { exact: true })
    .click();
  assert.equal(
    await dialog
      .getByRole("textbox", { name: "AGENTS.md global", exact: true })
      .inputValue(),
    "# Global rules\nInclude validation in every task.",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Settings UI passed: global/workspace routes, isolated accounts and instructions, preserved project memory, shared appearance and localized labels.",
  );
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
