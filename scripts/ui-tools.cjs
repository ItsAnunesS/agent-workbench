const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((defaults) => {
    window.isTauri = true;
    window.toolCalls = [];
    let callback = 0;
    let workspace = {
      version: 1,
      environments: [
        {
          id: "personal",
          name: "Personal",
          color: "violet",
          instructions: "Personal rules",
        },
        { id: "work", name: "Work", color: "blue", instructions: "Work rules" },
      ],
      projects: [
        {
          id: "p",
          environmentId: "personal",
          name: "Fixture project",
          path: "/projects/fixture",
          memory: "Project context",
        },
      ],
      conversations: [
        {
          id: "task",
          environmentId: "personal",
          projectId: "p",
          mode: "worker",
          title: "Implement feature",
          messages: [],
          createdAt: new Date().toISOString(),
          sourceId: null,
        },
        ...["one", "two"].map((id) => ({
          id,
          environmentId: "personal",
          projectId: null,
          mode: "chat",
          title: `Standalone ${id}`,
          messages: [],
          createdAt: new Date().toISOString(),
          sourceId: null,
        })),
      ],
    };
    let global = { executable: "/bin/bash", args: [] };
    const overrides = {};
    const pages = {};
    let current = null;
    const key = (scope) =>
      `${scope.environmentId}:${scope.projectId ? `project:${scope.projectId}` : `conversation:${scope.conversationId}`}`;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      transformCallback: () => ++callback,
      unregisterCallback: () => {},
      invoke: async (command, args = {}) => {
        if (command.startsWith("plugin:window|")) return false;
        if (command === "load_workspace") return structuredClone(workspace);
        if (command === "save_workspace") {
          workspace = structuredClone(args.workspace);
          return;
        }
        if (command === "openai_accounts" || command === "openai_models")
          return [];
        if (command === "worker_runtime")
          return {
            available: true,
            ready: true,
            message: "Codex is ready. Execution is isolated by project.",
          };
        if (command === "worker_history")
          return args.conversationId === "task"
            ? [
                {
                  id: "run",
                  environmentId: "personal",
                  projectId: "p",
                  conversationId: "task",
                  model: "fixture",
                  status: "completed",
                  createdAt: 1805500000,
                  events: [
                    {
                      kind: "activity",
                      text: "",
                      item: {
                        id: "change",
                        type: "fileChange",
                        changes: [
                          {
                            path: "src/main.ts",
                            diff: "@@ -1 +1 @@\n-old\n+new",
                          },
                        ],
                      },
                    },
                  ],
                  output: "Done",
                  error: null,
                },
              ]
            : [];
        if (command === "load_app_settings") return defaults;
        if (command === "desktop_integration_status")
          return { supported: true, installed: true, issue: null };
        if (command === "project_agents") return { path: null, content: null };
        if (command === "terminal_preferences")
          return {
            global,
            environmentOverride: overrides[args.environmentId] || null,
            effective: overrides[args.environmentId] || global,
          };
        if (command === "save_terminal_preferences") {
          if (args.environmentId) {
            if (args.config) overrides[args.environmentId] = args.config;
            else delete overrides[args.environmentId];
          } else global = args.config;
          window.toolCalls.push({ command, args });
          return;
        }
        if (command === "tool_browser_snapshot") {
          const partition = key(args.scope);
          return {
            url: current?.partition === partition ? current.url : null,
            pages: pages[partition] || [],
          };
        }
        if (command === "tool_browser") {
          window.toolCalls.push({ command, args });
          const partition = key(args.scope);
          if (args.action === "open") {
            current = { partition, url: args.url };
            pages[partition] = [
              {
                url: args.url,
                title: `Page ${args.scope.projectId || args.scope.conversationId}`,
              },
            ];
          }
          if (args.action === "close" && current?.partition === partition)
            current = null;
          return;
        }
        if (command === "tool_files") {
          window.toolCalls.push({ command, args });
          return {
            entries: args.path
              ? [
                  {
                    name: "main.ts",
                    path: "src/main.ts",
                    directory: false,
                    symlink: false,
                  },
                ]
              : [
                  { name: "src", path: "src", directory: true, symlink: false },
                  {
                    name: "escape",
                    path: "escape",
                    directory: false,
                    symlink: true,
                  },
                ],
            truncated: false,
          };
        }
        if (command === "tool_read_file") {
          window.toolCalls.push({ command, args });
          return "const greeting = 'Hello';\nconsole.log(greeting);";
        }
        if (command === "terminal_open") {
          window.toolCalls.push({
            command,
            args: { scope: args.scope, cols: args.cols, rows: args.rows },
          });
          setTimeout(
            () =>
              args.output.onmessage({
                data: Array.from(
                  new TextEncoder().encode("fixture shell ready\r\n$ "),
                ),
                exited: false,
              }),
            40,
          );
          return "terminal-id";
        }
        if (command === "terminal_control") {
          window.toolCalls.push({ command, args });
          return;
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    };
  }, require("../src/global-settings-defaults.json"));
  await page.goto("http://127.0.0.1:1420");
  const panel = page.getByRole("complementary", { name: "Workspace tools" });
  const tab = (name) => panel.getByRole("tab", { name, exact: true }).click();
  await panel
    .getByRole("heading", { name: "Your workspace, at hand." })
    .waitFor();
  assert.equal(
    await panel
      .getByRole("button", { name: /Explore the selected project/ })
      .count(),
    1,
  );
  await page
    .getByRole("button", { name: "Fixture project", exact: true })
    .click();
  await tab("Files");
  await panel.getByRole("button", { name: "src", exact: true }).click();
  await panel.getByRole("button", { name: "main.ts", exact: true }).click();
  await panel.getByText("const greeting = 'Hello';", { exact: true }).waitFor();
  assert.equal(
    await panel
      .getByRole("button", { name: "escape", exact: true })
      .isDisabled(),
    true,
  );
  await panel
    .getByRole("button", { name: "Expand tools panel", exact: true })
    .click();
  await page.screenshot({ path: "/workspace/artifacts/tools-files.png" });
  await panel
    .getByRole("button", { name: "Restore tools panel", exact: true })
    .click();
  await tab("Browser");
  await panel
    .getByRole("textbox", { name: "Search or enter a URL" })
    .fill("example.com/project");
  await panel.getByRole("button", { name: "Go", exact: true }).click();
  await page.waitForFunction(() =>
    window.toolCalls.some(
      (call) => call.command === "tool_browser" && call.args.action === "open",
    ),
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.toolCalls.find(
          (call) =>
            call.command === "tool_browser" && call.args.action === "open",
        ).args.url,
    ),
    "https://example.com/project",
  );
  await tab("Tools dashboard");
  await panel.getByText("Page p", { exact: true }).waitFor();
  await page.screenshot({ path: "/workspace/artifacts/tools-dashboard.png" });
  await tab("Browser");
  await page
    .getByRole("button", { name: "Global settings", exact: true })
    .click();
  await page.waitForFunction(() =>
    window.toolCalls.some(
      (call) => call.command === "tool_browser" && call.args.action === "hide",
    ),
  );
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Terminal settings", { exact: true }).click();
  await dialog
    .getByRole("textbox", { name: "Shell executable", exact: true })
    .fill("/bin/zsh");
  await dialog
    .getByRole("button", { name: "Save terminal settings", exact: true })
    .click();
  await dialog.getByText("Terminal settings saved.", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Workspace settings", exact: true })
    .click();
  await dialog.getByText("Terminal settings", { exact: true }).click();
  await dialog
    .getByRole("checkbox", { name: "Use global terminal settings" })
    .uncheck();
  await dialog
    .getByRole("textbox", { name: "Shell executable", exact: true })
    .fill("/bin/fish");
  await dialog
    .getByRole("button", { name: "Save terminal settings", exact: true })
    .click();
  await dialog.getByText("Terminal settings saved.", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Worker", exact: true }).click();
  await page
    .getByRole("button", { name: "Implement feature", exact: true })
    .click();
  await tab("Changes");
  await panel
    .locator(".diff-added")
    .getByText("+new", { exact: true })
    .waitFor();
  assert.equal(await panel.locator(".diff-removed").textContent(), "-old");
  await page.screenshot({ path: "/workspace/artifacts/tools-changes.png" });
  await tab("Terminal");
  await panel.locator(".xterm").waitFor();
  await page.waitForFunction(() =>
    window.toolCalls.some((call) => call.command === "terminal_open"),
  );
  await panel.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("pwd");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() =>
    window.toolCalls.some(
      (call) =>
        call.command === "terminal_control" && call.args.action === "write",
    ),
  );
  await tab("Tools dashboard");
  await tab("Terminal");
  assert.equal(
    await page.evaluate(
      () =>
        window.toolCalls.filter((call) => call.command === "terminal_open")
          .length,
    ),
    1,
  );
  await page.screenshot({ path: "/workspace/artifacts/tools-terminal.png" });
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await page
    .getByRole("button", { name: "Standalone one", exact: true })
    .click();
  await tab("Browser");
  await panel
    .getByRole("textbox", { name: "Search or enter a URL" })
    .fill("https://example.com/one");
  await panel.getByRole("button", { name: "Go", exact: true }).click();
  await tab("Tools dashboard");
  await panel.getByText("Page one", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Standalone two", exact: true })
    .click();
  await panel
    .getByRole("heading", { name: "Your workspace, at hand." })
    .waitFor();
  assert.equal(await panel.getByText("Page one", { exact: true }).count(), 0);
  assert.equal(await panel.getByText("Page p", { exact: true }).count(), 0);
  await page.waitForFunction(() =>
    window.toolCalls.some(
      (call) =>
        call.command === "terminal_control" && call.args.action === "close",
    ),
  );
  await panel
    .getByRole("button", { name: "Expand tools panel", exact: true })
    .click();
  await page.setViewportSize({ width: 960, height: 640 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Workspace tools passed: dashboard, project files and preview, AI diffs, PTY UI/input/lifecycle, shell overrides, scoped browser requests, recent pages, modal hiding and responsive layout.",
  );
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
