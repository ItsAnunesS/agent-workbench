const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: "dark",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const theme = () => page.locator("html").getAttribute("data-theme");
  const settings = async () =>
    page.getByRole("button", { name: "Definições", exact: true }).click();
  await page.goto("http://127.0.0.1:1420");
  await page.getByRole("heading", { name: "Uma ideia começa aqui." }).waitFor();
  assert.equal(await theme(), "dark");
  await page.screenshot({
    path: "/workspace/artifacts/theme-dark-0.5.0.png",
    fullPage: true,
  });
  await settings();
  assert.equal(
    await page.getByRole("radio", { name: "Sistema", exact: true }).isChecked(),
    true,
  );
  await page.getByRole("radio", { name: "Claro", exact: true }).check();
  assert.equal(await theme(), "light");
  assert.match(
    await page.locator(".settings-wordmark").getAttribute("src"),
    /awb-lockup-dark/,
  );
  await page.screenshot({
    path: "/workspace/artifacts/theme-settings-light-0.5.0.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Concluir", exact: true }).click();
  await page.screenshot({
    path: "/workspace/artifacts/theme-light-0.5.0.png",
    fullPage: true,
  });
  await page.reload();
  await page.getByRole("heading", { name: "Uma ideia começa aqui." }).waitFor();
  assert.equal(await theme(), "light");
  await page.emulateMedia({ colorScheme: "dark" });
  assert.equal(await theme(), "light");
  await page
    .getByRole("button", { name: "Ativar tema escuro", exact: true })
    .click();
  assert.equal(await theme(), "dark");
  await settings();
  await page.screenshot({
    path: "/workspace/artifacts/theme-settings-dark-0.5.0.png",
    fullPage: true,
  });
  await page.getByRole("radio", { name: "Sistema", exact: true }).check();
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  await page.getByRole("radio", { name: "Escuro", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page.getByRole("radio", { name: "Claro", exact: true }).isChecked(),
    true,
  );
  await page.getByRole("button", { name: "Concluir", exact: true }).click();

  for (const value of ["dark", "light"]) {
    await settings();
    await page
      .getByRole("radio", {
        name: value === "dark" ? "Escuro" : "Claro",
        exact: true,
      })
      .check();
    await page.getByRole("button", { name: "Concluir", exact: true }).click();
    const contrasts = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const luminance = (color) => {
        const rgb = color
          .replace("#", "")
          .match(/../g)
          .slice(0, 3)
          .map((channel) => parseInt(channel, 16) / 255);
        const linear = rgb.map((value) =>
          value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
        );
        return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
      };
      return [
        ["text", "bg-app"],
        ["text-secondary", "bg-surface"],
        ["text-muted", "bg-sidebar"],
        ["purple", "purple-bg"],
        ["accent-text", "bg-app"],
        ["on-accent", "accent"],
      ].map(([foreground, background]) => {
        const first = luminance(
          style.getPropertyValue(`--${foreground}`).trim(),
        );
        const second = luminance(
          style.getPropertyValue(`--${background}`).trim(),
        );
        return {
          foreground,
          background,
          ratio:
            (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05),
        };
      });
    });
    for (const pair of contrasts)
      assert.ok(
        pair.ratio >= 4.5,
        `${value}: ${pair.foreground}/${pair.background} contrast ${pair.ratio}`,
      );
    await page.getByRole("button", { name: "Worker", exact: true }).click();
    await page.setViewportSize({ width: 960, height: 700 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  await page.evaluate(() => localStorage.setItem("workbench.theme", "invalid"));
  await page.reload();
  await page.getByRole("heading", { name: "Uma ideia começa aqui." }).waitFor();
  assert.equal(await theme(), "dark");
  const blocked = await context.newPage();
  await blocked.addInitScript(() =>
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Blocked", "SecurityError");
      },
    }),
  );
  await blocked.goto("http://127.0.0.1:1420");
  await blocked
    .getByRole("heading", { name: "Uma ideia começa aqui." })
    .waitFor();
  await blocked
    .getByRole("button", { name: "Ativar tema claro", exact: true })
    .click();
  assert.equal(
    await blocked.locator("html").getAttribute("data-theme"),
    "light",
  );
  const fs = require("node:fs");
  const response = fs.readFileSync("/workspace/tmp/auth-page/received.http", "utf8");
  const separator = response.indexOf("\r\n\r\n");
  const html = response.slice(separator + 4);
  const headers = Object.fromEntries(response.slice(0, separator).split("\r\n").slice(1).map((line) => { const index = line.indexOf(":"); return [line.slice(0, index).toLowerCase(), line.slice(index + 1).trim()]; }));
  delete headers["content-length"];
  delete headers.connection;
  await page.route("**/auth/callback*", (route) => route.fulfill({ status: 200, headers, body: html }));
  for (const appearance of ["dark", "light"]) {
    await page.emulateMedia({ colorScheme: appearance });
    await page.goto("http://127.0.0.1:1420/auth/callback?code=fixture");
    await page.waitForURL("http://127.0.0.1:1420/auth/callback");
    assert.equal(await page.locator("html").evaluate((root) => getComputedStyle(root).backgroundColor), appearance === "dark" ? "rgb(27, 28, 32)" : "rgb(245, 244, 241)");
    await page.screenshot({ path: `/workspace/artifacts/theme-login-${appearance}-0.5.0.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log(
    "Themes passed: dark/light, persistence, system changes, quick toggle, keyboard selection, wordmark, contrast, responsive Worker and unavailable storage.",
  );
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
