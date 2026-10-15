import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFile, chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { inspectBrowser, inspectionCredentials, inspectionOptions, inspectionRequestAllowed, summarizeRecordingResponse } from "./browser-inspection.ts";

void test("browser inspection defaults to the FHD API recordings screen", () => {
  const options = inspectionOptions([]);
  assert.equal(options.width, 1920);
  assert.equal(options.height, 1080);
  assert.equal(options.path, "/recordings");
  assert.equal(options.baseUrl, "http://127.0.0.1:5173");
});

void test("browser inspection permits only dashboard routes and bounded desktop viewports", () => {
  for (const args of [["--path", "https://example.com"], ["--path", "/api/v1/session"], ["--width", "1279"], ["--height", "2161"], ["--recording-index", "50"], ["--path", "/login", "--recording-index", "0"], ["--path", "/login", "--recording-status"], ["--base-url", "http://example.com"], ["--base-url", "http://user:secret@localhost:5173"]]) {
    assert.throws(() => inspectionOptions(args));
  }
  assert.equal(inspectionOptions(["--recording-index", "2", "--full-page"]).recordingIndex, 2);
  assert.equal(inspectionOptions(["--recording-status"]).recordingStatus, true);
});

void test("inspection credentials require a bounded username and password without exposing input", () => {
  assert.deepEqual(inspectionCredentials({ username: " test-user ", password: "test-only" }), { username: "test-user", password: "test-only" });
  for (const input of [null, {}, { username: "", password: "secret" }, { username: "test", password: 1 }, { username: "test", password: "secret", origin: "http://example.com" }]) {
    assert.throws(() => inspectionCredentials(input), /^Error: Invalid browser credentials file\.$/);
  }
});

void test("inspection blocks foreign origins and mutations other than session creation", () => {
  const origin = "http://127.0.0.1:5173";
  assert.equal(inspectionRequestAllowed(origin + "/api/v1/session", "POST", origin), true);
  assert.equal(inspectionRequestAllowed(origin + "/api/v2/monitoring/snapshot", "GET", origin), true);
  for (const [url, method] of [["https://example.com", "GET"], [origin + "/api/v1/settings/alerts", "PUT"], [origin + "/api/v1/notifications/read-all", "POST"], [origin + "/api/v1/session", "DELETE"], [origin + "/api/v1/session?x=1", "POST"]]) {
    assert.equal(inspectionRequestAllowed(url, method, origin), false);
  }
});

void test("recording diagnostics report contract checks without identifiers, timestamps or raw errors", () => {
  const result = summarizeRecordingResponse(new URL("http://localhost/api/v1/recordings?pit_id=private-pit&from=2026-10-15T00:00:00Z&to=2026-10-16T00:00:00Z&page=1&pageSize=100"), 200, {
    items: [{ id: "private-recording", startedAt: "2026-10-15T00:00:00Z", endedAt: "2026-10-15T00:01:00Z", mediaStatus: "failed", status: "unavailable", errorCode: "private raw diagnostic ".repeat(100) }],
  });
  assert.equal(result.query.explicitTimeOffsets, true);
  assert.equal(result.query.orderedRange, true);
  assert.equal(result.items[0].validInterval, true);
  assert.equal(result.items[0].errorCode, "unrecognized");
  assert.doesNotMatch(JSON.stringify(result), /private-|2026-10|private raw/);
});

void test("remote browser help does not connect and unsafe SSH arguments are rejected", () => {
  const script = fileURLToPath(new URL("./remote-browser.sh", import.meta.url));
  assert.equal(spawnSync("bash", [script, "--help"], { encoding: "utf8" }).status, 0);
  const result = spawnSync("bash", [script, "capture"], { encoding: "utf8", env: { ...process.env, DASHBOARD_DEV_SSH_TARGET: "-oProxyCommand=invalid" } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid SSH target/);
});

void test("SSH relay preserves complete quoted commands without running them locally", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dashboard-browser-relay-test."));
  try {
    const bin = join(directory, "bin");
    const log = join(directory, "calls.jsonl");
    await mkdir(bin);
    await appendFile(log, "");
    await writeFile(join(bin, "ssh"), `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
appendFileSync(process.env.INSPECTION_SSH_LOG, JSON.stringify(args) + '\\n');
if (args.includes('relay-host')) process.exit(spawnSync('sh', ['-c', args.at(-1)], { stdio: 'inherit' }).status ?? 1);
`);
    await writeFile(join(bin, "rsync"), "#!/bin/sh\nexit 0\n");
    await chmod(join(bin, "ssh"), 0o700);
    await chmod(join(bin, "rsync"), 0o700);
    const result = spawnSync("bash", [fileURLToPath(new URL("./remote-browser.sh", import.meta.url)), "clear-session"], {
      encoding: "utf8", env: { ...process.env, PATH: bin + ":" + process.env.PATH, INSPECTION_SSH_LOG: log,
        DASHBOARD_DEV_SSH_TARGET: "user@server-host", DASHBOARD_DEV_SSH_RELAY: "relay-host",
        DASHBOARD_DEV_REMOTE_PATH: "/srv/scrap-monitoring-dashboard-dev" },
    });
    assert.equal(result.status, 0, result.stderr);
    const calls = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line) as string[]);
    assert.equal(calls.length, 4);
    assert.match(calls[1].at(-1) ?? "", /test -f '\/srv\/scrap-monitoring-dashboard-dev\/compose.remote-development.yaml'/);
    assert.match(calls[3].at(-1) ?? "", /rm -- '\/srv\/scrap-monitoring-dashboard-dev\/\.secrets\/dashboard-browser\/session.json'/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

void test("inspection logs in once, reuses a private session, captures FHD and blocks writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dashboard-browser-capture-test."));
  let loginRequests = 0;
  let mutationRequests = 0;
  const server = createServer((request, response) => {
    const authenticated = request.headers.cookie?.includes("inspection=fixture") ?? false;
    if (request.url === "/api/v1/session") {
      if (request.method === "POST") {
        loginRequests += 1;
        response.setHeader("Set-Cookie", "inspection=fixture; HttpOnly; SameSite=Lax; Path=/");
        response.end("{}");
      } else { response.writeHead(authenticated ? 200 : 401); response.end("{}"); }
      return;
    }
    if (request.url === "/api/v1/settings/alerts") {
      mutationRequests += 1;
      response.end("{}");
      return;
    }
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (!authenticated && pathname !== "/login") {
      response.writeHead(302, { Location: "/login" }); response.end(); return;
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(pathname === "/login" ? `<!doctype html><main><h1>로그인</h1>
      <form><label>아이디<input name="username"></label><label>비밀번호<input name="password" type="password"></label><button>로그인</button></form></main>
      <script>document.querySelector('form').onsubmit = async event => {event.preventDefault(); await fetch('/api/v1/session', {method:'POST'}); location.assign('/');};</script>`
      : `<!doctype html><main><h1>녹화 영상</h1><div class="recordings-main"><button class="recording-item">fixture</button><section class="recording-info">fixture</section></div></main>
      <script>fetch('/api/v1/settings/alerts', {method:'PUT'}).catch(() => {});</script>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const state = join(directory, "state");
    await mkdir(state, { mode: 0o700 });
    await writeFile(join(state, "credentials.json"), JSON.stringify({ username: "fixture-user", password: "fixture-only" }), { mode: 0o600 });
    for (const run of ["first", "second"]) {
      const output = join(directory, run);
      await inspectBrowser(inspectionOptions(["--base-url", `http://127.0.0.1:${address.port}`, "--state-dir", state, "--output-dir", output, "--recording-index", "0"]));
      const metadata = JSON.parse(await readFile(join(output, "metadata.json"), "utf8")) as Record<string, unknown>;
      assert.equal(metadata.authenticated, true);
      assert.equal(metadata.actualPath, "/recordings");
      const png = await readFile(join(output, "capture.png"));
      assert.equal(png.readUInt32BE(16), 1920);
      assert.equal(png.readUInt32BE(20), 1080);
      assert.equal((await stat(join(output, "metadata.json"))).mode & 0o777, 0o600);
    }
    assert.equal(loginRequests, 1);
    assert.equal(mutationRequests, 0);
    assert.equal((await stat(join(state, "session.json"))).mode & 0o777, 0o600);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
