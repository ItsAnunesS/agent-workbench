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
    window.fileContent =
      "# Root rules\nUse local project conventions.\n<script>window.instructionsExecuted=true</script>";
    window.instructionCalls = [];
    window.fileError = false;
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
        if (command === "project_agents") {
          window.instructionCalls.push(args);
          if (window.fileError)
            throw args.locale === "pt"
              ? "Não foi possível ler o AGENTS.md do projeto. Verifica as permissões do ficheiro."
              : "Could not read the project's AGENTS.md. Check file permissions.";
          return {
            path:
              window.fileContent == null ? null : "/projects/fixture/AGENTS.md",
            content: window.fileContent,
          };
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
  const button = (name) => page.getByRole("button", { name, exact: true });
  const dialog = page.getByRole("dialog");
  await button("Selected project").click();
  await button("Workspace settings").click();
  await dialog.getByText("Recognized automatically", { exact: true }).waitFor();
  await dialog
    .getByText("/projects/fixture/AGENTS.md", { exact: true })
    .waitFor();
  await dialog.getByText("View project instructions", { exact: true }).click();
  await dialog
    .locator(".project-instructions-preview")
    .getByText("Use local project conventions.", { exact: false })
    .waitFor();
  assert.equal(
    await page.evaluate(() => window.instructionsExecuted),
    undefined,
  );
  assert.equal(
    await dialog.getByText("Personal instructions", { exact: true }).count(),
    1,
  );
  await page.evaluate(() => {
    window.fileContent = "Updated on disk";
  });
  await button("Refresh project instructions").click();
  await dialog
    .locator(".project-instructions-preview")
    .getByText("Updated on disk", { exact: true })
    .waitFor();
  await page.evaluate(() => {
    window.fileContent = "Updated on window focus";
    window.dispatchEvent(new Event("focus"));
  });
  await dialog
    .locator(".project-instructions-preview")
    .getByText("Updated on window focus", { exact: true })
    .waitFor();
  await page.screenshot({ path: "artifacts/project-instructions.png" });
  await page.evaluate(() => {
    window.fileContent = null;
  });
  await button("Refresh project instructions").click();
  await dialog
    .getByText("No AGENTS.md or agents.md found in the project root.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await dialog.locator(".project-instructions-preview").count(),
    0,
  );
  await page.evaluate(() => {
    window.fileError = true;
  });
  await button("Refresh project instructions").click();
  await dialog
    .getByRole("alert")
    .filter({ hasText: "Could not read the project's AGENTS.md." })
    .waitFor();
  await page.keyboard.press("Escape");
  await button("Global settings").click();
  await dialog.getByRole("combobox", { name: /Language/ }).selectOption("pt");
  await page.keyboard.press("Escape");
  await button("Definições do workspace").click();
  await dialog
    .getByRole("alert")
    .filter({ hasText: "Não foi possível ler o AGENTS.md do projeto." })
    .waitFor();
  await page.evaluate(() => {
    window.fileError = false;
    window.fileContent = "Portuguese preview content stays verbatim";
  });
  await button("Atualizar instruções do projeto").click();
  await dialog
    .getByText("Reconhecido automaticamente", { exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  await button("Ambiente Work").click();
  await button("Definições do workspace").click();
  assert.equal(
    await dialog
      .getByText("/projects/fixture/AGENTS.md", { exact: true })
      .count(),
    0,
  );
  assert.ok(
    await page.evaluate(() =>
      window.instructionCalls.every(
        (call) =>
          call.environmentId === "personal" && call.projectId === "project",
      ),
    ),
  );
  const workspace = await page.evaluate(() => window.savedSettingsWorkspace);
  assert.equal(workspace, undefined);
  assert.deepEqual(errors, []);
  console.log(
    "Project instructions UI passed: automatic detection, escaped preview, explicit/focus refresh, removal, errors, Portuguese and environment isolation without overwriting settings.",
  );
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
