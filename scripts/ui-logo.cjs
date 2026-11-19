const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:1420");
  const logo = page.locator(".interactive-brand[data-rendered='true']");
  await logo.waitFor();
  const button = page.locator(".brand-mark");
  // Keep hover CSS constant so pixel comparisons measure the 3D scene itself.
  await page.addStyleTag({
    content:
      ".brand-mark, .brand-mark:hover { background: transparent !important; border-color: transparent !important; }",
  });
  const bounds = await button.boundingBox();
  const canvas = logo.locator("canvas");
  await page.mouse.move(bounds.x + 5, bounds.y + 5);
  await page.waitForTimeout(800);
  const left = await canvas.screenshot();
  await page.mouse.move(
    bounds.x + bounds.width - 5,
    bounds.y + bounds.height - 5,
  );
  await page.waitForTimeout(800);
  const right = await canvas.screenshot();
  assert.equal(
    left.equals(right),
    false,
    "The logo and eyes follow the pointer",
  );
  await page.mouse.move(300, 300);
  await page.waitForTimeout(800);
  const neutral = await canvas.screenshot();
  assert.equal(
    right.equals(neutral),
    false,
    "Leaving returns the logo to rest",
  );
  assert.equal(
    neutral.equals(await canvas.screenshot()),
    true,
    "The resting logo stays still",
  );
  await page.screenshot({ path: "/workspace/artifacts/logo-3d-app.png" });
  await button.evaluate((element) => {
    element.style.position = "fixed";
    element.style.left = "400px";
    element.style.top = "200px";
    element.style.zIndex = "100";
    element.style.width = "220px";
    element.style.height = "220px";
  });
  await page.waitForTimeout(200);
  await button.screenshot({ path: "/workspace/artifacts/logo-3d-detail.png" });
  await button.evaluate((element) => element.removeAttribute("style"));
  await page.waitForTimeout(300);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(300);
  const reduced = await canvas.screenshot();
  await page.mouse.move(bounds.x + 5, bounds.y + 5);
  await page.waitForTimeout(300);
  assert.equal(
    reduced.equals(await canvas.screenshot()),
    true,
    "Reduced motion prevents tracking",
  );
  await button.click();
  await page
    .getByRole("dialog")
    .getByRole("heading", { name: "Global settings", exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  await canvas.evaluate((element) =>
    element.dispatchEvent(new Event("webglcontextlost", { cancelable: true })),
  );
  await page.waitForFunction(
    () => !document.querySelector(".interactive-brand").dataset.rendered,
  );
  assert.equal(
    await page
      .locator(".interactive-brand img")
      .evaluate((image) => getComputedStyle(image).opacity),
    "1",
  );

  const fallback = await browser.newPage();
  await fallback.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type.startsWith("webgl")) return null;
      return original.call(this, type, ...args);
    };
  });
  await fallback.goto("http://127.0.0.1:1420");
  await fallback
    .getByRole("heading", { name: "An idea starts here." })
    .waitFor();
  await fallback.waitForTimeout(500);
  assert.equal(await fallback.locator(".interactive-brand canvas").count(), 0);
  assert.equal(
    await fallback
      .locator(".interactive-brand img")
      .evaluate(
        (image) =>
          image.complete &&
          image.naturalWidth > 0 &&
          getComputedStyle(image).opacity === "1",
      ),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "3D logo passed: WebGL rendering, pointer tracking, rest, reduced motion, settings action, context loss and unsupported WebGL fallback.",
  );
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
