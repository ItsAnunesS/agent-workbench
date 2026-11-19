const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:1420");
  await page.getByRole("heading", { name: "An idea starts here." }).waitFor();
  await page.screenshot({
    path: "/workspace/artifacts/interface.png",
    fullPage: true,
  });

  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Contexto pessoal reservado");
  await page
    .getByRole("button", { name: "Save message locally" })
    .click();
  await page
    .locator("article")
    .filter({ hasText: "Contexto pessoal reservado" })
    .waitFor();
  await page.getByRole("button", { name: "Worker", exact: true }).click();
  assert.equal(await page.locator("article").count(), 0);
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await page
    .getByRole("button", { name: "Contexto pessoal reservado", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create a task from this conversation" })
    .click();
  await page
    .getByText("Context copied from a Chat in this environment.", { exact: false })
    .waitFor();
  assert.equal(await page.locator("article").count(), 1);

  await page
    .getByRole("button", { name: "Environment Work", exact: true })
    .click();
  assert.equal(await page.locator("article").count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "Contexto pessoal reservado", exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Projeto profissional");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit context", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("textbox")
    .fill("Memória exclusiva do projeto profissional");
  await page
    .getByRole("button", { name: "Save context", exact: true })
    .click();
  await page
    .locator(".memory-preview")
    .filter({ hasText: "Memória exclusiva do projeto profissional" })
    .waitFor();

  await page
    .getByRole("button", { name: "Create environment", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Nexlo Games");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page
    .getByRole("button", { name: "Environment Nexlo Games", exact: true })
    .waitFor();
  assert.equal(
    await page
      .locator(".memory-preview")
      .filter({ hasText: "Memória exclusiva do projeto profissional" })
      .count(),
    0,
  );
  await page.setViewportSize({ width: 960, height: 700 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "UI smoke passed: environment isolation, mode separation, explicit handoff, projects, memory, responsive layout.",
  );
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
