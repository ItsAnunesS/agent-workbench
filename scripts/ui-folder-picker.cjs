const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
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
    window.folderCalls = [];
    window.nextFolder = "/projects/selected folder ";
    window.folderError = false;
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
        if (command === "select_project_folder") {
          window.folderCalls.push(args);
          if (window.folderError)
            throw "Could not open the folder chooser. Try again.";
          if (window.delayFolder)
            return new Promise((resolve) => {
              window.resolveFolder = resolve;
            });
          return window.nextFolder;
        }
        if (command === "app_update_check")
          return { supported: false, version: null };
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
  const button = (name) => page.getByRole("button", { name, exact: true });
  const dialog = page.getByRole("dialog");
  await button("Create project").click();
  await dialog.getByRole("textbox", { name: /Name/ }).fill("Native selection");
  assert.equal(await dialog.getByRole("textbox").count(), 1);
  await button("Choose folder").click();
  await dialog
    .getByLabel("Selected folder")
    .getByText("/projects/selected folder ", { exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(() => window.savedSettingsWorkspace),
    undefined,
  );
  await button("Create").click();
  await button("Native selection").waitFor();
  const savedPath = () =>
    page.evaluate(
      () =>
        window.savedSettingsWorkspace.projects.find(
          (project) => project.name === "Native selection",
        ).path,
    );
  assert.equal(await savedPath(), "/projects/selected folder ");
  await button("Workspace settings").click();
  await button("Set folder").click();
  assert.equal(await dialog.getByRole("textbox").count(), 0);
  await page.evaluate(() => {
    window.nextFolder = null;
  });
  await button("Change folder").click();
  assert.equal(
    await dialog.getByLabel("Selected folder").textContent(),
    "/projects/selected folder ",
  );
  await page.evaluate(() => {
    window.folderError = true;
  });
  await button("Change folder").click();
  await dialog
    .getByRole("alert")
    .filter({ hasText: "Could not open the folder chooser." })
    .waitFor();
  await page.evaluate(() => {
    window.folderError = false;
    window.nextFolder = "/projects/new folder";
    window.delayFolder = true;
  });
  await button("Change folder").click();
  assert.equal(await button("Save folder").isDisabled(), true);
  await page.evaluate(() => window.resolveFolder(window.nextFolder));
  await dialog
    .getByLabel("Selected folder")
    .getByText("/projects/new folder", { exact: true })
    .waitFor();
  assert.equal(await savedPath(), "/projects/selected folder ");
  await page.screenshot({ path: "artifacts/folder-picker.png" });
  await button("Save folder").click();
  assert.equal(await savedPath(), "/projects/new folder");
  await button("Workspace settings").click();
  await button("Set folder").click();
  await button("Remove folder").click();
  await dialog.getByText("No folder selected", { exact: true }).waitFor();
  await button("Save folder").click();
  assert.equal(await savedPath(), "");
  await button("Global settings").click();
  await dialog.getByRole("combobox", { name: /Language/ }).selectOption("pt");
  await page.keyboard.press("Escape");
  await button("Criar projeto").click();
  await dialog
    .getByRole("button", { name: "Selecionar pasta", exact: true })
    .waitFor();
  assert.ok(
    await page.evaluate(() =>
      window.folderCalls.every((call) => call.locale === "en"),
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "Folder picker UI passed: native invocation, cancellation, errors, disabled save while pending, exact paths, explicit persistence, detach and Portuguese labels.",
  );
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
