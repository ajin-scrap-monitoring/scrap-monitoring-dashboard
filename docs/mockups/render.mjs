import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const mockupDirectory = dirname(fileURLToPath(import.meta.url));
const renderedDirectory = resolve(mockupDirectory, "rendered");
const indexUrl = pathToFileURL(resolve(mockupDirectory, "index.html"));
const outputs = {
  monitoring: "monitoring-screen-mockup.png",
  history: "history-screen-mockup.png",
  recordings: "recordings-screen-mockup.png",
  admin: "admin-screen-mockup.png",
  login: "login-screen-mockup.png",
};

await mkdir(renderedDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });

try {
  for (const [pageName, outputName] of Object.entries(outputs)) {
    const page = await browser.newPage({
      viewport: { width: 1584, height: 992 },
      deviceScaleFactor: 1,
    });
    const pageUrl = new URL(indexUrl);
    pageUrl.searchParams.set("page", pageName);

    await page.goto(pageUrl.href);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: resolve(renderedDirectory, outputName),
      fullPage: false,
    });
    await page.close();
  }
} finally {
  await browser.close();
}
