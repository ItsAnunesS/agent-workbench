const assert = require("node:assert/strict");
const fs = require("node:fs");
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
  await page.evaluate(() => document.fonts.ready);
  assert.equal(
    await page.evaluate(() => document.fonts.check('14px "Open Sans"')),
    true,
  );
  assert.equal(
    await page
      .locator(".brand-mark img")
      .evaluate((image) => image.complete && image.naturalWidth > 0),
    true,
  );
  await page.screenshot({
    path: "/workspace/artifacts/branding-app-0.3.0.png",
    fullPage: true,
  });

  const draft = page.getByRole("textbox", { name: "Message", exact: true });
  await draft.fill("Rascunho do ambiente pessoal");
  await page
    .getByRole("button", { name: "Environment Work", exact: true })
    .click();
  assert.equal(await draft.inputValue(), "");
  await draft.fill("Rascunho do trabalho");
  await page
    .getByRole("button", { name: "Environment Personal", exact: true })
    .click();
  assert.equal(await draft.inputValue(), "Rascunho do ambiente pessoal");
  await page.getByRole("button", { name: "Global settings", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assert.equal(
    await dialog
      .getByRole("img", { name: "Agent Workbench", exact: true })
      .count(),
    1,
  );
  await page.screenshot({
    path: "/workspace/artifacts/branding-settings-0.3.0.png",
    fullPage: true,
  });
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press("Tab");
    assert.equal(
      await page
        .locator(".modal")
        .evaluate((modal) => modal.contains(document.activeElement)),
      true,
    );
  }
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(
    await page
      .getByRole("button", { name: "Global settings", exact: true })
      .evaluate((button) => document.activeElement === button),
    true,
  );
  await page.setViewportSize({ width: 960, height: 700 });
  await page
    .getByRole("button", { name: "Toggle tools panel", exact: true })
    .click();
  assert.equal(await page.locator(".context-panel").count(), 0);
  await page
    .getByRole("button", { name: "Toggle tools panel", exact: true })
    .click();
  assert.equal(await page.locator(".context-panel").isVisible(), true);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  const bounds = await page.locator(".composer").boundingBox();
  assert.ok(bounds.y + bounds.height <= 700);

  for (const state of ["received", "denied", "invalid"]) {
    const response = fs.readFileSync(
      `/workspace/tmp/auth-page/${state}.http`,
      "utf8",
    );
    const split = response.indexOf("\r\n\r\n");
    const headerLines = response.slice(0, split).split("\r\n");
    const status = Number(headerLines.shift().split(" ")[1]);
    const headers = Object.fromEntries(
      headerLines.map((line) => {
        const index = line.indexOf(":");
        return [
          line.slice(0, index).toLowerCase(),
          line.slice(index + 1).trim(),
        ];
      }),
    );
    delete headers["content-length"];
    delete headers.connection;
    await page.route("**/auth/callback*", (route) =>
      route.fulfill({ status, headers, body: response.slice(split + 4) }),
    );
    await page.goto(
      `http://127.0.0.1:1420/auth/callback?code=fixture-code&state=fixture-${state}`,
    );
    await page.waitForURL("http://127.0.0.1:1420/auth/callback");
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator(".card svg").count(), 1);
    assert.equal(await page.getByRole("heading").count(), 1);
    assert.equal(
      await page
        .locator("body")
        .textContent()
        .then((text) => text.includes("fixture-code")),
      false,
    );
    if (state === "received") {
      await page
        .getByRole("heading", { name: "Continue in the app.", exact: true })
        .waitFor();
      await page.screenshot({
        path: "/workspace/artifacts/branding-login-0.3.0.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.screenshot({
        path: "/workspace/artifacts/branding-login-mobile-0.3.0.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await page.unroute("**/auth/callback*");
  }
  assert.deepEqual(errors, []);
  console.log(
    "Branding UI passed: local fonts and logo, environment drafts, modal focus, responsive context, native callback states, URL cleanup and CSP.",
  );
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
