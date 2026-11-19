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
    const initial = {
      version: 1,
      environments: [
        {
          id: "personal",
          name: "Personal",
          color: "violet",
          instructions: "Personal only",
        },
        {
          id: "work",
          name: "Work",
          color: "blue",
          instructions: "Work only",
        },
      ],
      projects: [],
      conversations: [],
    };
    let workspace =
      JSON.parse(localStorage.getItem("fixture-workspace") || "null") ||
      initial;
    let accounts = [];
    let callbackId = 0;
    const callbacks = new Map();
    const cancellations = new Set();
    window.fixtureCalls = [];
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      transformCallback: (callback) => {
        callbacks.set(++callbackId, callback);
        return callbackId;
      },
      unregisterCallback: (id) => callbacks.delete(id),
      invoke: async (command, args = {}) => {
        window.fixtureCalls.push({
          command,
          environmentId: args.environmentId,
          conversationId: args.conversationId,
          model: args.model,
        });
        if (command === "plugin:window|is_maximized") return false;
        if (command === "desktop_integration_status")
          return { supported: false, installed: false, issue: null };
        if (command === "load_workspace") return structuredClone(workspace);
        if (command === "save_workspace") {
          workspace = structuredClone(args.workspace);
          localStorage.setItem("fixture-workspace", JSON.stringify(workspace));
          return;
        }
        if (command === "openai_accounts") return structuredClone(accounts);
        if (command === "openai_login") {
          accounts = [
            ...accounts.filter(
              (account) => account.environmentId !== args.environmentId,
            ),
            {
              environmentId: args.environmentId,
              email: "fixture@example.test",
              connected: true,
              eligible: true,
            },
          ];
          return;
        }
        if (command === "openai_logout") {
          accounts = accounts.filter(
            (account) => account.environmentId !== args.environmentId,
          );
          return true;
        }
        if (command === "openai_models")
          return [
            {
              slug: `${args.environmentId}-model`,
              name: `${args.environmentId} model`,
            },
          ];
        if (command === "openai_cancel_chat") {
          cancellations.add(args.requestId);
          return;
        }
        if (command === "openai_chat") {
          const conversation = workspace.conversations.find(
            (item) =>
              item.id === args.conversationId &&
              item.environmentId === args.environmentId &&
              item.mode === "chat",
          );
          if (!conversation) throw "Wrong conversation boundary";
          if (conversation.messages.at(-1).content === "limite")
            throw "The usage limit has been reached. Check your limits in ChatGPT > Settings > Usage.";
          const chunks =
            conversation.messages.at(-1).content === "código"
              ? [
                  "Exemplo:\n```ts\n",
                  "const safe = '<script>alert(1)</script>';\n",
                  "```\nFim.",
                ]
              : conversation.messages.at(-1).content === "texto longo"
                ? [
                    "Linha de contexto\n".repeat(80),
                    "Continuação da resposta.\n",
                    "Resposta longa terminada.",
                  ]
                : ["Resposta ", "de teste ", "concluída."];
          args.onEvent.onmessage({
            type: "summary",
            text: "Reviewing the available context.",
          });
          for (const text of chunks) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            if (cancellations.has(args.requestId)) {
              args.onEvent.onmessage({ type: "interrupted" });
              return;
            }
            args.onEvent.onmessage({ type: "delta", text });
          }
          args.onEvent.onmessage({
            type: "completed",
            input_tokens: 12,
            output_tokens: 8,
          });
          return;
        }
        throw `Unexpected command: ${command}`;
      },
    };
  });
  await page.goto("http://127.0.0.1:1420");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Continue with ChatGPT", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Disconnect account", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Model" })
    .selectOption("personal-model");
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Mensagem pessoal");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .locator("article p")
    .filter({ hasText: "Resposta de teste concluída." })
    .waitFor();
  await page
    .getByRole("button", { name: "Stop", exact: true })
    .waitFor({ state: "hidden" });
  assert.equal(await page.locator("article").count(), 2);
  await page.locator(".response-activity summary").first().click();
  await page
    .getByText("Reviewing the available context.", { exact: true })
    .waitFor();
  const firstAnswer = await page.evaluate(() =>
    JSON.parse(
      localStorage.getItem("fixture-workspace"),
    ).conversations[0].messages.at(-1),
  );
  assert.equal(typeof firstAnswer.durationMs, "number");
  assert.equal(firstAnswer.summary, "Reviewing the available context.");

  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Interromper resposta");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .locator("article")
    .filter({ hasText: "Responding..." })
    .getByText("Resposta", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByText("Response interrupted", { exact: true }).waitFor();

  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("limite");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({
      hasText:
        "The usage limit has been reached. Check your limits in ChatGPT > Settings > Usage.",
    })
    .waitFor();
  await page
    .getByRole("button", { name: "Environment Work", exact: true })
    .click();
  assert.equal(await page.getByRole("combobox", { name: "Model" }).count(), 0);
  assert.equal(await page.locator("article").count(), 0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Continue with ChatGPT", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Disconnect account", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Model" })
    .selectOption("work-model");
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Mensagem profissional");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .locator("article p")
    .filter({ hasText: "Resposta de teste concluída." })
    .waitFor();
  await page
    .getByRole("button", { name: "Stop", exact: true })
    .waitFor({ state: "hidden" });
  const calls = await page.evaluate(() =>
    window.fixtureCalls.filter((call) => call.command === "openai_chat"),
  );
  assert.equal(calls.at(-1).model, "work-model");
  assert.equal(calls.at(-1).environmentId, "work");
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("fixture-workspace")),
  );
  const personal = stored.conversations.find(
    (item) => item.environmentId === "personal",
  );
  const work = stored.conversations.find(
    (item) => item.environmentId === "work",
  );
  assert.equal(
    personal.messages.filter((item) => item.role === "assistant").length,
    2,
  );
  assert.equal(
    work.messages.filter((item) => item.role === "assistant").length,
    1,
  );
  assert.ok(!work.messages.some((item) => item.content === "Mensagem pessoal"));
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("código");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .getByRole("button", { name: "Stop", exact: true })
    .waitFor({ state: "hidden" });
  await page
    .locator(".code-block code")
    .filter({ hasText: "const safe" })
    .waitFor();
  assert.equal(await page.locator("article script").count(), 0);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy code", exact: true }).click();
  await page.getByText("Copied", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "const safe = '<script>alert(1)</script>';",
  );
  await page.screenshot({
    path: "/workspace/artifacts/chat-0.3.0.png",
    fullPage: true,
  });
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("texto longo");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector(".message-scroll").scrollHeight >
      document.querySelector(".message-scroll").clientHeight + 300,
  );
  await page.locator(".message-scroll").evaluate((viewport) => {
    viewport.scrollTop = 0;
    viewport.dispatchEvent(new Event("scroll"));
  });
  await page
    .getByRole("button", { name: "Go to the latest message", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Stop", exact: true })
    .waitFor({ state: "hidden" });
  assert.equal(
    await page
      .locator(".message-scroll")
      .evaluate((viewport) => viewport.scrollTop),
    0,
  );
  await page
    .getByRole("button", { name: "Go to the latest message", exact: true })
    .click();
  assert.ok(
    await page
      .locator(".message-scroll")
      .evaluate((viewport) => viewport.scrollTop > 0),
  );
  assert.deepEqual(errors, []);
  console.log(
    "OpenAI UI fixtures passed: account binding, model selection, streaming, interruption, provider limits, isolated persistence.",
  );
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
