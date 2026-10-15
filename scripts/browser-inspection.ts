import { parseArgs } from "node:util";
import { chmod, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium, type Page } from "@playwright/test";

const routes = new Set(["/", "/login", "/history", "/recordings", "/admin"]);

export function inspectionOptions(args: string[]) {
  const { values } = parseArgs({ args, options: {
    path: { type: "string", default: "/recordings" },
    width: { type: "string", default: "1920" },
    height: { type: "string", default: "1080" },
    "recording-index": { type: "string" },
    "recording-status": { type: "boolean", default: false },
    "full-page": { type: "boolean", default: false },
    "base-url": { type: "string", default: "http://127.0.0.1:5173" },
    "state-dir": { type: "string", default: "/state" },
    "output-dir": { type: "string", default: "/artifacts" },
  } });
  const integer = (value: string, min: number, max: number, label: string) => {
    if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) throw new Error(`Invalid ${label}.`);
    return Number(value);
  };
  if (!routes.has(values.path)) throw new Error("Unsupported inspection route.");
  const base = new URL(values["base-url"]);
  if (base.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(base.hostname)
    || base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
    throw new Error("Browser inspection requires a credential-free loopback HTTP origin.");
  }
  const recordingIndex = values["recording-index"] === undefined ? undefined
    : integer(values["recording-index"], 0, 49, "recording index");
  if (recordingIndex !== undefined && values.path !== "/recordings") throw new Error("Recording selection requires /recordings.");
  if (values["recording-status"] && values.path !== "/recordings") throw new Error("Recording status requires /recordings.");
  return { path: values.path, width: integer(values.width, 1280, 3840, "width"),
    height: integer(values.height, 600, 2160, "height"), recordingIndex, recordingStatus: values["recording-status"],
    fullPage: values["full-page"], baseUrl: base.origin,
    stateDirectory: resolve(values["state-dir"]), outputDirectory: resolve(values["output-dir"]) };
}

export function inspectionCredentials(value: unknown): { username: string; password: string } {
  if (!value || typeof value !== "object") throw new Error("Invalid browser credentials file.");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !["username", "password"].includes(key))
    || typeof record.username !== "string" || !record.username.trim() || record.username.length > 256
    || typeof record.password !== "string" || !record.password || record.password.length > 1024) {
    throw new Error("Invalid browser credentials file.");
  }
  return { username: record.username.trim(), password: record.password };
}

export function inspectionRequestAllowed(url: string, method: string, origin: string) {
  const target = new URL(url);
  return target.origin === origin && (["GET", "HEAD"].includes(method)
    || (method === "POST" && target.pathname === "/api/v1/session" && !target.search));
}

export function summarizeRecordingResponse(url: URL, status: number, body: unknown) {
  const value = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const list = url.pathname === "/api/v1/recordings";
  const items: unknown[] = list ? Array.isArray(value.items) ? value.items : [] : status === 200 ? [body] : [];
  const records = items.map(item => item && typeof item === "object" ? item as Record<string, unknown> : {});
  const timestamp = (value: unknown) => typeof value === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
  const states = ["collecting", "processing", "ready", "failed", "deleted", "expired", "blocked"];
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  return { endpoint: list ? "/api/v1/recordings" : "/api/v1/recordings/{id}", httpStatus: status,
    query: { keys: [...url.searchParams.keys()].sort(), hasPit: Boolean(url.searchParams.get("pit_id")),
      ...(list ? { explicitTimeOffsets: timestamp(from) && timestamp(to), orderedRange: Boolean(from && to && Date.parse(from) < Date.parse(to)),
        page: url.searchParams.get("page"), pageSize: url.searchParams.get("pageSize"), category: url.searchParams.get("category") ?? "all" } : {}) },
    itemCount: records.length,
    items: records.map(record => ({ validIdentifier: typeof record.id === "string" && record.id.length > 0,
      validInterval: timestamp(record.startedAt) && timestamp(record.endedAt) && Date.parse(String(record.startedAt)) < Date.parse(String(record.endedAt)),
      mediaStatus: states.includes(String(record.mediaStatus)) ? record.mediaStatus : record.mediaStatus == null ? null : "unknown",
      available: record.status === "available", hasContent: typeof record.contentPath === "string", hasDownload: typeof record.downloadPath === "string",
      unknownMetadata: ["durationSeconds", "widthPixels", "heightPixels", "frameRate", "sizeBytes", "retainedFrom", "retainedUntil"].filter(key => record[key] == null),
      errorCode: typeof record.errorCode === "string" && /^[A-Z0-9_]{1,64}$/.test(record.errorCode) ? record.errorCode : record.errorCode == null ? null : "unrecognized",
      errorCharacters: typeof record.errorCode === "string" ? record.errorCode.length : 0,
    })) };
}

async function optionalState(path: string) {
  try {
    if (!(await lstat(path)).isFile()) throw new Error("Browser state must be a regular file.");
    return path;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function waitForPage(page: Page) {
  await page.locator("main h1").waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const heading = document.querySelector("main h1")?.textContent ?? "";
    return !["데이터를 불러오는 중입니다.", "화면을 불러오는 중입니다."].includes(heading);
  });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

export async function inspectBrowser(options: ReturnType<typeof inspectionOptions>) {
  process.umask(0o077);
  await mkdir(options.stateDirectory, { recursive: true, mode: 0o700 });
  await mkdir(options.outputDirectory, { recursive: true, mode: 0o700 });
  for (const directory of [options.stateDirectory, options.outputDirectory]) {
    if (!(await lstat(directory)).isDirectory()) throw new Error("Browser directories must not be symbolic links.");
    await chmod(directory, 0o700);
  }
  const statePath = join(options.stateDirectory, "session.json");
  const state = await optionalState(statePath);
  for (const filename of ["capture.png", "metadata.json"]) await optionalState(join(options.outputDirectory, filename));
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: options.width, height: options.height },
      deviceScaleFactor: 1, acceptDownloads: false, storageState: state });
    await context.route("**/*", route => inspectionRequestAllowed(route.request().url(), route.request().method(), options.baseUrl)
      ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    const recordingResponses: Promise<ReturnType<typeof summarizeRecordingResponse>>[] = [];
    page.on("response", response => {
      const url = new URL(response.url());
      if (url.origin === options.baseUrl && /^\/api\/v1\/recordings(?:\/[^/]+)?$/.test(url.pathname)
        && response.request().method() === "GET" && recordingResponses.length < 100) {
        recordingResponses.push(response.json().then((body: unknown) => summarizeRecordingResponse(url, response.status(), body))
          .catch(() => summarizeRecordingResponse(url, response.status(), null)));
      }
    });
    let consoleErrors = 0;
    let pageErrors = 0;
    page.on("console", message => { if (message.type() === "error") consoleErrors += 1; });
    page.on("pageerror", () => { pageErrors += 1; });
    const destination = new URL(options.path, options.baseUrl);
    destination.searchParams.set("source", "api");
    await page.goto(destination.href, { waitUntil: "domcontentloaded" });
    await waitForPage(page);
    let authenticated = new URL(page.url()).pathname !== "/login";
    if (!authenticated && options.path !== "/login") {
      const credentialsPath = join(options.stateDirectory, "credentials.json");
      if (await optionalState(credentialsPath)) {
        if ((await lstat(credentialsPath)).size > 4096) throw new Error("Browser credentials file is too large.");
        const credentials = inspectionCredentials(JSON.parse(await readFile(credentialsPath, "utf8")) as unknown);
        await page.getByLabel("아이디", { exact: true }).fill(credentials.username);
        await page.getByLabel("비밀번호", { exact: true }).fill(credentials.password);
        await page.getByRole("button", { name: "로그인", exact: true }).click();
        await page.waitForURL(url => url.pathname !== "/login");
        await page.goto(destination.href, { waitUntil: "domcontentloaded" });
        await waitForPage(page);
        authenticated = new URL(page.url()).pathname !== "/login";
      }
    }
    authenticated = await page.evaluate(async () => {
      try { return (await fetch("/api/v1/session", { credentials: "same-origin", cache: "no-store" })).ok; }
      catch { return false; }
    });
    if (authenticated && options.recordingIndex !== undefined) {
      const items = page.locator(".recording-item");
      await items.first().waitFor({ state: "visible" });
      if (options.recordingIndex >= await items.count()) throw new Error("Recording index is outside the visible list.");
      await items.nth(options.recordingIndex).click();
    }
    if (options.path === "/recordings") {
      await page.getByRole("button", { name: "확인 중 상세", exact: true }).waitFor({ state: "hidden" });
    }
    await page.waitForTimeout(800);
    if (authenticated && options.recordingStatus) {
      await page.locator(".recording-status-trigger").click();
      await page.getByRole("dialog", { name: "녹화 상태 상세", exact: true }).waitFor({ state: "visible" });
    }
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const layout = await page.evaluate(() => {
      const selectors = [".recordings-main", ".recordings-list", ".recording-player", ".recordings-side", ".recording-info", ".recording-download"];
      return { viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth,
        boxes: selectors.flatMap(selector => {
          const element = document.querySelector<HTMLElement>(selector);
          if (!element) return [];
          const { x, y, width, height } = element.getBoundingClientRect();
          return [{ selector, x, y, width, height, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }];
        }) };
    });
    await page.screenshot({ path: join(options.outputDirectory, "capture.png"), fullPage: options.fullPage });
    await context.storageState({ path: statePath });
    await chmod(statePath, 0o600);
    const metadata = { requestedPath: options.path, actualPath: new URL(page.url()).pathname, authenticated,
      width: options.width, height: options.height, fullPage: options.fullPage, recordingStatus: options.recordingStatus,
      ...(options.recordingIndex === undefined ? {} : { recordingIndex: options.recordingIndex }),
      consoleErrors, pageErrors, recordingResponses: await Promise.all(recordingResponses), ...layout };
    await writeFile(join(options.outputDirectory, "metadata.json"), JSON.stringify(metadata, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify({ captured: true, authenticated, path: metadata.actualPath, width: options.width, height: options.height }));
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await inspectBrowser(inspectionOptions(process.argv.slice(2)));
  } catch {
    console.error("Browser inspection failed. Check the route, development service, credentials and session without publishing private diagnostics.");
    process.exitCode = 1;
  }
}
