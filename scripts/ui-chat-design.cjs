const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    colorScheme: "dark",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.isTauri = true;
    const chat = (id, title, projectId, mode = "chat") => ({
      id,
      title,
      projectId,
      mode,
      environmentId: "personal",
      createdAt: "2026-11-19",
      sourceId: null,
      messages: [
        {
          id: `prompt-${id}`,
          role: "user",
          content: `Context for ${title}`,
          createdAt: "2026-11-19",
        },
        {
          id: `answer-${id}`,
          role: "assistant",
          content: `Answer for ${title}`,
          createdAt: "2026-11-19",
          durationMs: 125000,
          summary: "Reviewed the project context.",
        },
      ],
    });
    let workspace = JSON.parse(
      localStorage.getItem("design-workspace") || "null",
    ) || {
      version: 1,
      environments: [
        { id: "personal", name: "Personal", color: "violet", instructions: "" },
        { id: "work", name: "Work", color: "blue", instructions: "" },
      ],
      projects: [
        {
          id: "alpha",
          environmentId: "personal",
          name: "Alpha",
          path: "/projects/alpha",
          memory: "",
        },
        {
          id: "beta",
          environmentId: "personal",
          name: "Beta",
          path: "/projects/beta",
          memory: "",
        },
      ],
      conversations: [
        chat("alpha-chat", "Alpha chat", "alpha"),
        chat("standalone", "Standalone chat", null),
        chat("alpha-task", "Alpha task", "alpha", "worker"),
      ],
    };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      invoke: async (command, args = {}) => {
        if (command.startsWith("plugin:window|")) return false;
        if (command === "load_workspace") return structuredClone(workspace);
        if (command === "save_workspace") {
          workspace = structuredClone(args.workspace);
          localStorage.setItem("design-workspace", JSON.stringify(workspace));
          return;
        }
        if (command === "openai_accounts" || command === "worker_history")
          return [];
        if (command === "worker_runtime")
          return {
            available: true,
            ready: true,
            message: "Codex is ready. Execution is isolated by project.",
          };
        if (command === "desktop_integration_status")
          return { supported: false, installed: false, issue: null };
        throw new Error(`Unexpected command: ${command}`);
      },
    };
  });
  await page.goto("http://127.0.0.1:1420");
  const button = (name) => page.getByRole("button", { name, exact: true });
  const action = async (name, item) => {
    await button(item).click({ button: "right" });
    await page.getByRole("menuitem", { name, exact: true }).click();
  };
  await button("Alpha").waitFor();
  assert.equal(await button("Alpha").getAttribute("aria-expanded"), "false");
  assert.equal(await button("Alpha chat").count(), 0);
  await button("Alpha").click();
  await button("Alpha chat").waitFor();
  assert.equal(
    await page
      .locator(".conversation-list")
      .getByText("Alpha chat", { exact: true })
      .count(),
    0,
  );
  await page
    .locator(".conversation-list")
    .getByText("Standalone chat", { exact: true })
    .waitFor();
  await button("Alpha").click();
  assert.equal(await button("Alpha chat").count(), 0);
  await button("Alpha").click();
  await button("Alpha chat").click();
  await page.getByText("Worked for 2m 5s", { exact: true }).waitFor();
  assert.equal(
    await page
      .locator(".user-message > div:last-child")
      .evaluate((element) =>
        getComputedStyle(element).borderRadius.includes("20px"),
      ),
    true,
  );
  await page.screenshot({
    path: "/workspace/artifacts/chat-design-dark.png",
    fullPage: true,
  });
  await action("Rename", "Alpha chat");
  await page.getByRole("dialog").getByRole("textbox").fill("Renamed chat");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await button("Renamed chat").waitFor();
  await action("Pin", "Renamed chat");
  await action("Move to project", "Renamed chat");
  await page.getByRole("dialog").getByRole("combobox").selectOption("beta");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page
    .locator(".sidebar-project")
    .filter({ has: button("Beta") })
    .getByRole("button", { name: "Renamed chat", exact: true })
    .waitFor();
  await action("Archive", "Renamed chat");
  await page
    .getByText("This conversation is archived. Restore it to continue.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .isDisabled(),
    true,
  );
  await button("Show archived").click();
  await action("Restore", "Renamed chat");
  await button("Show active").click();
  await button("Renamed chat").waitFor();
  await action("Duplicate", "Standalone chat");
  await button("Standalone chat (copy)").waitFor();
  await action("Delete", "Standalone chat (copy)");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  assert.equal(await button("Standalone chat (copy)").count(), 0);
  await action("Archive", "Alpha");
  assert.equal(await button("Alpha").count(), 0);
  await button("Show archived").click();
  await action("Restore", "Alpha");
  await button("Show active").click();
  await action("Delete", "Alpha");
  await page
    .getByText(
      "The project will be removed. Its conversations and tasks will move to General. Local files will not be deleted.",
      { exact: true },
    )
    .waitFor();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await button("Worker").click();
  await page
    .locator(".conversation-list")
    .getByRole("button", { name: "Alpha task", exact: true })
    .waitFor();
  await button("Alpha task").click();
  await page
    .getByRole("combobox", { name: "Approval mode", exact: true })
    .selectOption("auto");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("workbench.approvalMode")),
    "auto",
  );
  await page.reload();
  await button("Worker").click();
  await button("Alpha task").click();
  assert.equal(
    await page
      .getByRole("combobox", { name: "Approval mode", exact: true })
      .inputValue(),
    "auto",
  );
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("design-workspace")),
  );
  assert.equal(
    stored.conversations.find((item) => item.id === "alpha-chat").projectId,
    "beta",
  );
  assert.equal(
    stored.conversations.find((item) => item.id === "alpha-chat").pinned,
    true,
  );
  assert.equal(
    stored.conversations.find((item) => item.id === "alpha-task").projectId,
    null,
  );
  await page.setViewportSize({ width: 960, height: 700 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Chat design UI passed: accordion nesting, standalone lists, elapsed time, context actions, pinning, moving, archive/restore, project removal, persisted approval mode and responsive layout.",
  );
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
