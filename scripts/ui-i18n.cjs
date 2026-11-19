const assert = require("node:assert/strict");
const portuguese = require("../src/locales/pt.json");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: "pt-PT",
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    ({ portuguese }) => {
      window.isTauri = true;
      window.apiCalls = [];
      let workspace = {
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
      window.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: "main" } },
        invoke: async (command, args = {}) => {
          if (command.startsWith("plugin:window|")) return false;
          window.apiCalls.push({ command, locale: args.locale });
          const message = (key) =>
            args.locale === "pt" ? portuguese[key] || key : key;
          if (command === "load_workspace") return structuredClone(workspace);
          if (command === "save_workspace") {
            workspace = structuredClone(args.workspace);
            return;
          }
          if (command === "openai_accounts") return [];
          if (command === "worker_history") return [];
          if (command === "worker_runtime")
            return {
              available: true,
              ready: false,
              message: message(
                "Prepare the Codex runtime. The first installation may take a few minutes.",
              ),
            };
          if (command === "worker_prepare")
            throw message("Invalid environment.");
          if (command === "desktop_integration_status")
            return {
              supported: true,
              installed: false,
              issue: message("Could not check system integration."),
            };
          throw new Error(`Unexpected command: ${command}`);
        },
      };
    },
    { portuguese },
  );
  await page.goto("http://127.0.0.1:1420");
  await page
    .getByRole("heading", { name: "An idea starts here.", exact: true })
    .waitFor();
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  const draft = "Texto do utilizador <script> sem tradução";
  await page.getByRole("textbox", { name: "Message", exact: true }).fill(draft);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByText("Could not check system integration.", { exact: true })
    .waitFor();
  await page.getByRole("combobox", { name: /Language/ }).selectOption("pt");
  await page
    .getByRole("heading", { name: "A tua conta, neste ambiente", exact: true })
    .waitFor();
  await page
    .getByText("Não foi possível consultar a integração do sistema.", {
      exact: true,
    })
    .waitFor();
  await page
    .getByRole("button", { name: "Preparar Worker", exact: true })
    .click();
  await page.getByText("Ambiente inválido.", { exact: true }).waitFor();
  assert.equal(await page.locator("html").getAttribute("lang"), "pt");
  await page.screenshot({
    path: "/workspace/artifacts/i18n-settings-pt.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Concluir", exact: true }).click();
  assert.equal(
    await page
      .getByRole("textbox", { name: "Mensagem", exact: true })
      .inputValue(),
    draft,
  );
  await page
    .getByRole("button", { name: "Guardar mensagem localmente", exact: true })
    .click();
  await page.locator("article p").filter({ hasText: draft }).waitFor();
  await page.getByRole("button", { name: "Definições", exact: true }).click();
  await page.getByRole("combobox", { name: /Idioma/ }).selectOption("en");
  await page.getByText("Invalid environment.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.locator("article p").filter({ hasText: draft }).waitFor();
  await page.reload();
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("combobox", { name: /Language/ }).selectOption("pt");
  await page.reload();
  await page
    .getByRole("heading", { name: "Uma ideia começa aqui.", exact: true })
    .waitFor();
  assert.equal(await page.locator("html").getAttribute("lang"), "pt");
  const calls = await page.evaluate(() => window.apiCalls);
  assert.ok(calls.length > 0 && calls.every((call) => call.locale === "pt"));
  await page.getByRole("button", { name: "Definições", exact: true }).click();
  await page.getByRole("combobox", { name: /Idioma/ }).selectOption("en");
  await page.screenshot({
    path: "/workspace/artifacts/i18n-settings-en.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 960, height: 640 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  const failedStartup = await context.newPage();
  failedStartup.on("pageerror", (error) => errors.push(error.message));
  await failedStartup.addInitScript(() => {
    localStorage.setItem("workbench.locale", "pt");
    window.isTauri = true;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      invoke: async (command) => {
        if (command === "load_workspace") throw "Local data unavailable.";
        if (command === "openai_accounts") return [];
        if (command === "worker_runtime") return { available: false, ready: false, message: "Start Docker and check again." };
        return false;
      },
    };
  });
  await failedStartup.goto("http://127.0.0.1:1420");
  await failedStartup.getByText("Não foi possível abrir os dados locais. Reinicia a aplicação.", { exact: true }).waitFor();
  assert.equal(await failedStartup.locator("html").getAttribute("lang"), "pt");
  assert.deepEqual(errors, []);
  console.log(
    "i18n UI passed: English default, live language switching, native API locale, localized errors, preserved user content, persistence and responsive layout.",
  );
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
