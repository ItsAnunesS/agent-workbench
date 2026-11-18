const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.isTauri = true;
    let workspace = JSON.parse(
      localStorage.getItem("worker-fixture") || "null",
    ) || {
      version: 1,
      environments: [
        {
          id: "personal",
          name: "Pessoal",
          color: "violet",
          instructions: "Personal instructions",
        },
        {
          id: "work",
          name: "Trabalho",
          color: "blue",
          instructions: "Work instructions",
        },
      ],
      projects: [
        {
          id: "project",
          environmentId: "personal",
          name: "Fixture project",
          path: "/projects/fixture",
          memory: "Fixture memory",
        },
      ],
      conversations: [],
    };
    const records = JSON.parse(localStorage.getItem("worker-runs") || "[]");
    let pending;
    let callback = 0;
    window.workerCalls = [];
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      transformCallback: () => ++callback,
      unregisterCallback: () => {},
      invoke: async (command, args = {}) => {
        window.workerCalls.push({
          command,
          environmentId: args.environmentId,
          conversationId: args.conversationId,
          accept: args.accept,
        });
        if (command === "plugin:window|is_maximized") return false;
        if (command === "desktop_integration_status")
          return { supported: false, installed: false, issue: null };
        if (command === "load_workspace") return structuredClone(workspace);
        if (command === "save_workspace") {
          workspace = structuredClone(args.workspace);
          localStorage.setItem("worker-fixture", JSON.stringify(workspace));
          return;
        }
        if (command === "openai_accounts")
          return [
            {
              environmentId: "personal",
              email: "fixture@example.test",
              connected: true,
              eligible: true,
            },
          ];
        if (command === "openai_models")
          return [{ slug: "fixture-codex", name: "Codex fixture" }];
        if (command === "worker_runtime")
          return {
            available: true,
            ready: true,
            message: "Codex pronto. Execução isolada por projeto.",
          };
        if (command === "worker_history")
          return structuredClone(
            records.filter(
              (run) =>
                run.environmentId === args.environmentId &&
                run.conversationId === args.conversationId,
            ),
          );
        if (command === "worker_run") {
          const task = workspace.conversations.find(
            (item) =>
              item.id === args.conversationId &&
              item.environmentId === args.environmentId &&
              item.mode === "worker",
          );
          if (!task || task.projectId !== "project")
            throw "Invalid Worker scope";
          const run = {
            id: args.runId,
            environmentId: args.environmentId,
            conversationId: args.conversationId,
            projectId: "project",
            model: args.model,
            createdAt: Date.now() / 1000,
            status: "awaitingApproval",
            events: [],
            output: "",
            error: null,
          };
          const emit = (event) => {
            run.events.push(event);
            args.onEvent.onmessage(event);
          };
          emit({
            kind: "status",
            text: "Worker iniciado num container isolado.",
          });
          emit({
            kind: "activity",
            text: "",
            item: {
              type: "commandExecution",
              id: "command",
              command: "npm test",
              cwd: "/workspace",
              status: "inProgress",
            },
          });
          emit({
            kind: "approval",
            text: "Executar os testes do projeto?",
            approvalId: "approval-fixture",
            item: {
              type: "commandExecution",
              command: "npm test",
              cwd: "/workspace",
            },
          });
          return new Promise((resolve) => {
            pending = { args, run, resolve, emit };
          });
        }
        if (command === "worker_approve" || command === "worker_cancel") {
          if (
            !pending ||
            pending.run.id !== args.runId ||
            pending.run.environmentId !== args.environmentId ||
            pending.run.conversationId !== args.conversationId
          )
            throw "Invalid action scope";
          const { run, emit, resolve } = pending;
          if (command === "worker_cancel") {
            run.status = "interrupted";
            run.output = "Tarefa interrompida.";
          } else {
            emit({
              kind: "decision",
              text: args.accept ? "Ação autorizada uma vez." : "Ação recusada.",
              approvalId: args.approvalId,
            });
            emit({
              kind: "activity",
              text: "",
              item: {
                type: "commandExecution",
                id: "command",
                command: "npm test",
                cwd: "/workspace",
                status: "completed",
                exitCode: 0,
                output: "All tests passed",
              },
            });
            emit({
              kind: "activity",
              text: "",
              item: {
                type: "fileChange",
                changes: [
                  { path: "/workspace/app.ts", diff: "+ const result = true;" },
                ],
                status: "completed",
              },
            });
            run.status = "completed";
            run.output = args.accept
              ? "Testes executados e alterações verificadas."
              : "Comando recusado pelo utilizador.";
          }
          emit({ kind: "delta", text: run.output });
          records.unshift(structuredClone(run));
          localStorage.setItem("worker-runs", JSON.stringify(records));
          pending = null;
          setTimeout(() => resolve(structuredClone(run)), 100);
          return;
        }
        throw `Unexpected command: ${command}`;
      },
    };
  });
  await page.goto("http://127.0.0.1:1420");
  await page
    .getByRole("button", { name: "Fixture project", exact: true })
    .click();
  await page.getByRole("button", { name: "Worker", exact: true }).click();
  await page
    .getByRole("button", { name: "Definir pasta", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("textbox")
    .fill("/projects/fixture-updated");
  await page
    .getByRole("button", { name: "Guardar pasta", exact: true })
    .click();
  await page
    .locator(".worker-project code")
    .filter({ hasText: "/projects/fixture-updated" })
    .waitFor();
  await page
    .getByRole("combobox", { name: "Modelo" })
    .selectOption("fixture-codex");
  await page
    .getByRole("textbox", { name: "Descrição da tarefa" })
    .fill("Implementar uma feature com testes");
  await page
    .getByRole("textbox", { name: "Descrição da tarefa" })
    .press("Enter");
  const approve = page.getByRole("button", {
    name: "Autorizar uma vez",
    exact: true,
  });
  await approve.waitFor();
  await page.screenshot({
    path: "/workspace/artifacts/worker-approval-0.4.0.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Ambiente Trabalho", exact: true })
    .click();
  assert.equal(await approve.count(), 0);
  assert.equal(await page.locator(".worker-run").count(), 0);
  await page.getByRole("button", { name: "Ver tarefa", exact: true }).click();
  await approve.click();
  await page
    .locator("article")
    .filter({ hasText: "Testes executados e alterações verificadas." })
    .waitFor();
  await page.getByText("Ação autorizada uma vez.", { exact: true }).waitFor();
  await page.getByText("Ver saída", { exact: true }).click();
  await page.getByText("All tests passed", { exact: true }).waitFor();
  await page.screenshot({
    path: "/workspace/artifacts/worker-completed-0.4.0.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  assert.equal(
    await page.getByText("Testes executados e alterações verificadas.").count(),
    0,
  );
  await page.getByRole("button", { name: "Worker", exact: true }).click();
  await page
    .getByText("Implementar uma feature com testes", { exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Executar tarefa", exact: true })
    .click();
  await page.getByRole("button", { name: "Recusar", exact: true }).click();
  await page
    .locator("article")
    .filter({ hasText: "Comando recusado pelo utilizador." })
    .waitFor();
  await page
    .getByRole("button", { name: "Executar tarefa", exact: true })
    .click();
  await approve.waitFor();
  await page.locator(".composer .stop-button").click();
  await page
    .locator("article")
    .filter({ hasText: "Tarefa interrompida." })
    .waitFor();
  const calls = await page.evaluate(() =>
    window.workerCalls.filter((call) =>
      ["worker_run", "worker_approve", "worker_cancel"].includes(call.command),
    ),
  );
  assert.equal(calls.filter((call) => call.command === "worker_run").length, 3);
  assert.ok(calls.every((call) => call.environmentId === "personal"));
  await page.reload();
  await page
    .getByRole("button", { name: "Fixture project", exact: true })
    .click();
  await page.getByRole("button", { name: "Worker", exact: true }).click();
  await page
    .getByText("Implementar uma feature com testes", { exact: true })
    .first()
    .click();
  await page.locator(".worker-history").first().waitFor();
  assert.equal(await page.locator(".worker-history").count(), 3);
  await page.setViewportSize({ width: 960, height: 700 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Worker UI passed: task execution, one-time approval, refusal, cancellation, activity, persisted history and environment/Chat boundaries.",
  );
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
