import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { developmentProxy } from "../vite.config.ts";

await test("development proxy is disabled without an upstream", () => {
  assert.equal(developmentProxy(undefined), undefined);
  assert.equal(developmentProxy(""), undefined);
});

await test("development proxy preserves the browser origin and only proxies API and media paths", () => {
  assert.deepEqual(developmentProxy("http://gateway:8080/"), {
    "^/api/": { target: "http://gateway:8080", changeOrigin: false },
    "^/media/": { target: "http://gateway:8080", changeOrigin: false },
  });
});

for (const target of ["invalid", "file:///tmp/config", "http://user:secret@gateway", "http://gateway/api", "http://gateway/?key=value", "http://gateway/#config"]) {
  await test(`development proxy rejects non-origin or credential-bearing targets: ${target.split(":")[0]}`, () => {
    assert.throws(() => developmentProxy(target), /DASHBOARD_DEV_PROXY_TARGET/);
  });
}

await test("daily media locations share the authenticated header and playlist boundary in production and development", async () => {
  const source = async (path: string) => readFile(new URL(path, import.meta.url), "utf8");
  const snippet = await source("../nginx/includes/proxy-daily-recording.conf");
  assert.match(snippet, /proxy_pass_request_headers off;/);
  assert.match(snippet, /proxy_pass_request_body off;/);
  for (const header of ["Cookie", "Authorization", "Accept-Encoding"]) {
    assert.ok(snippet.includes(`proxy_set_header ${header} "";`));
  }
  for (const header of ["Range", "If-Range"]) {
    assert.match(snippet, new RegExp(`proxy_set_header ${header} \\$http_`));
  }
  assert.ok(snippet.includes("sub_filter '/api/v2/daily-recordings/' '/media/daily-recordings/';"));
  assert.ok(snippet.includes('add_header Cache-Control "no-store" always;'));
  assert.match(snippet, /set \$args \$daily_recording_args;/);
  assert.match(snippet, /\$request_method !~ "\^\(GET\|HEAD\)\$"/);
  assert.match(snippet, /if \(\$request_uri !~/);
  for (const [path, auth] of [
    ["../development/nginx-proxy.conf.template", "/_development_media_access"],
    ["../integration/nginx/runtime.conf", "/_integration_media_auth"],
    ["../test/proxy/runtime/20-proxy-locations.conf", "/_proxy_test_media_access"],
  ]) {
    const config = await source(path);
    assert.ok(config.includes(`auth_request ${auth};\n`));
    assert.ok(config.includes("include /etc/nginx/includes/proxy-daily-recording.conf;"));
    assert.ok(config.includes("location /media/daily-recordings/ {\n"));
  }
  assert.match(await source("../Dockerfile"), /COPY nginx\/includes \/etc\/nginx\/includes/);
  assert.match(await source("../compose.remote-development.yaml"), /\.\/nginx\/includes:\/etc\/nginx\/includes:ro/);
});

await test("browser gateway separates Backend reads and Media viewing from Edge camera ingest", async () => {
  const config = await readFile(new URL("../development/nginx-proxy.conf.template", import.meta.url), "utf8");
  const api = config.match(/location \/api\/ \{([\s\S]*?)\n {4}\}/)?.[1];
  assert.ok(api);
  assert.match(api, /proxy_pass http:\/\/development_backend;/);
  assert.doesNotMatch(api, /development_media/);
  assert.match(config, /cameras\/\[A-Za-z0-9\][^\n]*\/live/);
  assert.doesNotMatch(config, /\/stream\$|proxy_set_header Upgrade/);
  assert.match(config, /location ~ \^\/api\/\(v2\/monitoring\/events\|v1\/monitoring\/events\)\$/);
  assert.match(config, /include \/etc\/nginx\/includes\/proxy-streaming\.conf;/);
  assert.match(config, /auth_request \/_development_media_access;/);
  const streaming = await readFile(new URL("../nginx/includes/proxy-streaming.conf", import.meta.url), "utf8");
  assert.match(streaming, /proxy_buffering off;/);
  assert.match(streaming, /proxy_cache off;/);
});

const scriptPath = fileURLToPath(new URL("./remote-development.sh", import.meta.url));
const remoteEnvironment = {
  ...process.env,
  DASHBOARD_DEV_SSH_TARGET: "developer@server",
  DASHBOARD_DEV_REMOTE_PATH: "/srv/development/scrap-monitoring-dashboard-dev",
  DASHBOARD_DEV_SSH_RELAY: "",
};

await test("remote development prints help without connecting to a server", () => {
  const result = spawnSync("bash", [scriptPath, "--help"], { encoding: "utf8", env: remoteEnvironment });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /sync\|start\|watch\|stop/);
});

await test("remote development refuses option injection in SSH targets", () => {
  const result = spawnSync("bash", [scriptPath, "sync"], {
    encoding: "utf8", env: { ...remoteEnvironment, DASHBOARD_DEV_SSH_TARGET: "-oProxyCommand=command" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SSH host or user@host/);
});

for (const remotePath of ["/", "/srv/backend", "/srv/../scrap-monitoring-dashboard-dev", "/srv//scrap-monitoring-dashboard-dev"]) {
  await test(`remote development refuses unsafe target directories: ${remotePath}`, () => {
    const result = spawnSync("bash", [scriptPath, "sync"], {
      encoding: "utf8", env: { ...remoteEnvironment, DASHBOARD_DEV_REMOTE_PATH: remotePath },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /remote path/);
  });
}

for (const relay of ["", "relay-host"]) {
  await test(`remote development preserves command boundaries ${relay ? "through a relay" : "with direct SSH"}`, async () => {
    const fixture = await mkdtemp(join(tmpdir(), "dashboard-development-transport."));
    try {
      const sshArgsPath = join(fixture, "ssh-args");
      const rsyncArgsPath = join(fixture, "rsync-args");
      await writeFile(join(fixture, "git"), "#!/usr/bin/env bash\ncase \"$*\" in *--absolute-git-dir*) printf '%s\\n' \"$DASHBOARD_TEST_GIT_DIRECTORY\" ;; *hash-object*) cat > /dev/null; printf '%s\\n' fixture-target ;; esac\n", { mode: 0o755 });
      await writeFile(join(fixture, "ssh"), "#!/usr/bin/env bash\nprintf '%s\\0' \"$@\" > \"$DASHBOARD_TEST_SSH_ARGS\"\n", { mode: 0o755 });
      await writeFile(join(fixture, "rsync"), "#!/usr/bin/env bash\nif [[ $1 == --help ]]; then printf '%s\\n' '--from0 --delete-missing-args'; exit 0; fi\nprintf '%s\\0' \"$@\" > \"$DASHBOARD_TEST_RSYNC_ARGS\"\n", { mode: 0o755 });
      const result = spawnSync("bash", [scriptPath, "sync"], {
        encoding: "utf8", timeout: 5000,
        env: {
          ...remoteEnvironment, PATH: `${fixture}:${process.env.PATH ?? "/usr/bin:/bin"}`,
          DASHBOARD_DEV_SSH_RELAY: relay,
          DASHBOARD_TEST_SSH_ARGS: sshArgsPath,
          DASHBOARD_TEST_RSYNC_ARGS: rsyncArgsPath,
          DASHBOARD_TEST_GIT_DIRECTORY: join(fixture, "git-directory"),
        },
      });
      assert.equal(result.status, 0, result.stderr);
      const sshArgs = (await readFile(sshArgsPath, "utf8")).split("\0").filter(Boolean);
      const rsyncArgs = (await readFile(rsyncArgsPath, "utf8")).split("\0").filter(Boolean);
      let preparedCommand = sshArgs.at(-1) ?? "";
      if (relay) {
        const decoded = spawnSync("sh", ["-c", `printf '%s\\0' ${preparedCommand}`], { encoding: "utf8", timeout: 5000 });
        assert.equal(decoded.status, 0, decoded.stderr);
        const argumentsAfterRelay = decoded.stdout.split("\0").filter(Boolean);
        assert.equal(argumentsAfterRelay.at(-2), "developer@server");
        preparedCommand = argumentsAfterRelay.at(-1) ?? "";
        assert.equal(sshArgs.at(-2), "relay-host");
      } else {
        assert.equal(sshArgs.at(-2), "developer@server");
      }
      assert.match(preparedCommand, /if \[ -L '\/srv\/development\/scrap-monitoring-dashboard-dev'/);
      assert.match(preparedCommand, /mkdir -p '\/srv\/development\/scrap-monitoring-dashboard-dev'/);
      assert.ok(rsyncArgs.includes("--exclude=.env.*"));
      assert.ok(rsyncArgs.includes("--delete-missing-args"));
      assert.equal(rsyncArgs.at(-1), "developer@server:/srv/development/scrap-monitoring-dashboard-dev/");
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
}

async function syncFixture() {
  const directory = await mkdtemp(join(tmpdir(), "dashboard-development-sync."));
  const repository = join(directory, "source");
  const mirror = join(directory, "mirror");
  const bin = join(directory, "bin");
  const transfers = join(directory, "transfers");
  await mkdir(join(repository, "scripts"), { recursive: true });
  await mkdir(mirror);
  await mkdir(bin);
  await copyFile(scriptPath, join(repository, "scripts", "remote-development.sh"));
  await writeFile(join(repository, "compose.remote-development.yaml"), "services: {}\n");
  const git = (...args: string[]) => {
    const result = spawnSync("git", ["-C", repository, "-c", "core.hooksPath=/dev/null", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  git("init", "--quiet");
  await writeFile(join(bin, "ssh"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
  await writeFile(join(bin, "rsync"), `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
if (args[0] === "--help") { process.stdout.write("--from0 --delete-missing-args\\n"); process.exit(0); }
const fileList = args.find(value => value.startsWith("--files-from="));
if (!fileList) process.exit(90);
const entries = fs.readFileSync(fileList.slice("--files-from=".length), "utf8").split("\\0").filter(Boolean);
fs.appendFileSync(process.env.DASHBOARD_TEST_TRANSFERS, JSON.stringify({ args, entries }) + "\\n");
if (process.env.DASHBOARD_TEST_TRANSFER_FAILURE === "true") process.exit(23);
const partialPath = process.env.DASHBOARD_TEST_PARTIAL_TRANSFER_FAILURE;
const partialFailure = partialPath !== undefined && entries.includes(partialPath);
if (partialFailure) {
  const index = entries.indexOf(partialPath);
  entries.splice(index + 1);
  fs.writeFileSync(fileList.slice("--files-from=".length), entries.join("\\0") + "\\0");
}
const source = args.at(-2);
const mirror = process.env.DASHBOARD_TEST_MIRROR;
if (process.env.DASHBOARD_TEST_REAL_RSYNC) {
  const result = spawnSync(process.env.DASHBOARD_TEST_REAL_RSYNC, [...args.slice(0, -1), mirror + "/"], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exit(result.status === 0 && partialFailure ? 23 : result.status ?? 91);
}
for (const entry of entries) {
  const destination = path.resolve(mirror, entry);
  if (!destination.startsWith(mirror + path.sep)) throw new Error("Unsafe fixture path.");
  const input = path.join(source, entry);
  let status;
  try { status = fs.lstatSync(input); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (!status) { fs.rmSync(destination, { force: true }); continue; }
  if (!status.isFile() && !status.isSymbolicLink()) throw new Error("Directory traversal in sync file list.");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (status.isSymbolicLink()) {
    fs.rmSync(destination, { force: true });
    fs.symlinkSync(fs.readlinkSync(input), destination);
  } else {
    try { if (fs.lstatSync(destination).isDirectory()) fs.rmdirSync(destination); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    fs.copyFileSync(input, destination);
  }
}
if (partialFailure) process.exit(23);
`, { mode: 0o755 });
  const sync = (overrides: Record<string, string> = {}) => spawnSync("bash", [join(repository, "scripts", "remote-development.sh"), "sync"], {
    encoding: "utf8", timeout: 10_000,
    env: { ...remoteEnvironment, PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      DASHBOARD_TEST_MIRROR: mirror, DASHBOARD_TEST_TRANSFERS: transfers, ...overrides },
  });
  const success = (overrides: Record<string, string> = {}) => {
    const result = sync(overrides);
    assert.equal(result.status, 0, result.stderr);
  };
  const manifestDirectory = join(repository, ".git", "dashboard-development-sync");
  const manifests = async () => (await readdir(manifestDirectory)).filter(name => !name.startsWith("sync."));
  const paths = async () => {
    const records = (await readFile(transfers, "utf8")).trim().split("\n").map(line => JSON.parse(line) as { args: string[]; entries: string[] });
    return records.at(-1)!;
  };
  return { directory, repository, mirror, git, sync, success, manifestDirectory, manifests, paths };
}

await test("sync removes committed and untracked deletions without deleting foreign files", async () => {
  const fixture = await syncFixture();
  try {
    const unusual = "name with space\nline|.txt";
    for (const name of ["tracked.txt", "scratch.txt", unusual]) await writeFile(join(fixture.repository, name), "public\n");
    fixture.git("add", "tracked.txt");
    fixture.git("commit", "--quiet", "-m", "Initial fixture");
    fixture.success();
    await writeFile(join(fixture.mirror, "foreign.txt"), "owned elsewhere\n");
    await writeFile(join(fixture.mirror, ".env.remote"), "protected fixture setting\n");
    await rename(join(fixture.repository, "tracked.txt"), join(fixture.directory, "removed-tracked.txt"));
    fixture.git("add", "--update");
    fixture.git("commit", "--quiet", "-m", "Delete fixture");
    await rm(join(fixture.repository, "scratch.txt"));
    await rm(join(fixture.repository, unusual));
    fixture.success();
    for (const name of ["tracked.txt", "scratch.txt", unusual]) await assert.rejects(readFile(join(fixture.mirror, name)), { code: "ENOENT" });
    assert.equal(await readFile(join(fixture.mirror, "foreign.txt"), "utf8"), "owned elsewhere\n");
    assert.equal(await readFile(join(fixture.mirror, ".env.remote"), "utf8"), "protected fixture setting\n");
    assert.equal((await fixture.paths()).args.includes("--recursive"), false);
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

await test("newly ignored files never transmit new private contents and remain eligible for later deletion", async () => {
  const fixture = await syncFixture();
  try {
    await writeFile(join(fixture.repository, "published.txt"), "public version\n");
    fixture.success();
    await writeFile(join(fixture.repository, "published.txt"), "private replacement fixture\n");
    await writeFile(join(fixture.repository, ".gitignore"), "published.txt\n");
    for (const name of [".env.remote", "secret.key", "runtime-config.json"]) await writeFile(join(fixture.repository, name), "excluded fixture\n");
    fixture.success();
    assert.equal(await readFile(join(fixture.mirror, "published.txt"), "utf8"), "public version\n");
    assert.equal((await fixture.paths()).entries.includes("published.txt"), false);
    for (const name of [".env.remote", "secret.key", "runtime-config.json"]) await assert.rejects(readFile(join(fixture.mirror, name)), { code: "ENOENT" });
    const manifest = join(fixture.manifestDirectory, (await fixture.manifests())[0]);
    assert.equal((await stat(manifest)).mode & 0o777, 0o600);
    await rm(join(fixture.repository, "published.txt"));
    fixture.success();
    await assert.rejects(readFile(join(fixture.mirror, "published.txt")), { code: "ENOENT" });
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

await test("failed sync preserves the previous manifest for a later retry", async () => {
  const fixture = await syncFixture();
  try {
    await writeFile(join(fixture.repository, "deleted.txt"), "public\n");
    fixture.success();
    const manifest = join(fixture.manifestDirectory, (await fixture.manifests())[0]);
    const previous = await readFile(manifest);
    await rm(join(fixture.repository, "deleted.txt"));
    const failure = fixture.sync({ DASHBOARD_TEST_TRANSFER_FAILURE: "true" });
    assert.equal(failure.status, 23);
    assert.deepEqual(await readFile(manifest), previous);
    fixture.success();
    await assert.rejects(readFile(join(fixture.mirror, "deleted.txt")), { code: "ENOENT" });
    assert.notDeepEqual(await readFile(manifest), previous);
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

await test("partial transfer failures retain new paths for deletion after a failed retry", async () => {
  const fixture = await syncFixture();
  try {
    fixture.success();
    const manifest = join(fixture.manifestDirectory, (await fixture.manifests())[0]);
    const previous = await readFile(manifest);
    await writeFile(join(fixture.repository, "newly-sent.txt"), "public\n");
    await writeFile(join(fixture.repository, "z-later.txt"), "public\n");
    const partial = fixture.sync({ DASHBOARD_TEST_PARTIAL_TRANSFER_FAILURE: "newly-sent.txt" });
    assert.equal(partial.status, 23, partial.stderr);
    assert.equal(await readFile(join(fixture.mirror, "newly-sent.txt"), "utf8"), "public\n");
    assert.deepEqual(await readFile(manifest), previous);
    await rm(join(fixture.repository, "newly-sent.txt"));
    assert.equal(fixture.sync({ DASHBOARD_TEST_TRANSFER_FAILURE: "true" }).status, 23);
    fixture.success();
    await assert.rejects(readFile(join(fixture.mirror, "newly-sent.txt")), { code: "ENOENT" });
    await assert.rejects(readFile(`${manifest}.pending`), { code: "ENOENT" });
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

const ownershipContexts: Record<string, string>[] = [
  { DASHBOARD_DEV_SSH_TARGET: "another@server" },
  { DASHBOARD_DEV_SSH_RELAY: "relay-host" },
  { DASHBOARD_DEV_REMOTE_PATH: "/srv/another/scrap-monitoring-dashboard-dev" },
];
for (const overrides of ownershipContexts) {
  await test(`sync ownership is separated by ${Object.keys(overrides)[0]}`, async () => {
    const fixture = await syncFixture();
    try {
      await writeFile(join(fixture.repository, "owned.txt"), "public\n");
      fixture.success();
      await rm(join(fixture.repository, "owned.txt"));
      fixture.success(overrides);
      assert.equal(await readFile(join(fixture.mirror, "owned.txt"), "utf8"), "public\n");
      assert.equal((await fixture.manifests()).length, 2);
      fixture.success();
      await assert.rejects(readFile(join(fixture.mirror, "owned.txt")), { code: "ENOENT" });
    } finally { await rm(fixture.directory, { recursive: true, force: true }); }
  });
}

await test("a tracked path replaced by a directory cannot transmit ignored child files", async () => {
  const fixture = await syncFixture();
  try {
    await writeFile(join(fixture.repository, "entry"), "public file\n");
    fixture.git("add", "entry");
    fixture.success();
    await rm(join(fixture.repository, "entry"));
    await mkdir(join(fixture.repository, "entry"));
    await writeFile(join(fixture.repository, "entry", "private.txt"), "private fixture\n");
    await writeFile(join(fixture.repository, ".gitignore"), "entry/\n");
    fixture.success();
    await assert.rejects(readFile(join(fixture.mirror, "entry")), { code: "ENOENT" });
    assert.equal((await fixture.paths()).entries.includes("entry"), false);
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

await test("nested deletions preserve foreign children and existing directory permissions", async () => {
  const fixture = await syncFixture();
  try {
    await mkdir(join(fixture.repository, "tree", "nested"), { recursive: true });
    await writeFile(join(fixture.repository, "tree", "nested", "managed.txt"), "public\n");
    fixture.success();
    const directories = [join(fixture.mirror, "tree"), join(fixture.mirror, "tree", "nested")];
    await Promise.all(directories.map(path => chmod(path, 0o755)));
    const modes = await Promise.all(directories.map(async path => (await stat(path)).mode & 0o777));
    await writeFile(join(fixture.mirror, "tree", "nested", "foreign.txt"), "owned elsewhere\n");
    await rename(join(fixture.repository, "tree"), join(fixture.directory, "removed-tree"));
    fixture.success();
    await assert.rejects(readFile(join(fixture.mirror, "tree", "nested", "managed.txt")), { code: "ENOENT" });
    assert.equal(await readFile(join(fixture.mirror, "tree", "nested", "foreign.txt"), "utf8"), "owned elsewhere\n");
    assert.deepEqual(await Promise.all(directories.map(async path => (await stat(path)).mode & 0o777)), modes);
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

await test("a managed file can become a directory containing only public child files", async () => {
  const fixture = await syncFixture();
  try {
    await writeFile(join(fixture.repository, "entry"), "public file\n");
    fixture.git("add", "entry");
    fixture.success();
    await rm(join(fixture.repository, "entry"));
    await mkdir(join(fixture.repository, "entry"));
    await writeFile(join(fixture.repository, "entry", "public.txt"), "public child\n");
    await writeFile(join(fixture.repository, "entry", "private.txt"), "private fixture\n");
    await writeFile(join(fixture.repository, ".gitignore"), "entry/private.txt\n");
    assert.equal(fixture.sync({ DASHBOARD_TEST_PARTIAL_TRANSFER_FAILURE: "entry/public.txt" }).status, 23);
    fixture.success();
    fixture.success();
    assert.equal(await readFile(join(fixture.mirror, "entry", "public.txt"), "utf8"), "public child\n");
    await assert.rejects(readFile(join(fixture.mirror, "entry", "private.txt")), { code: "ENOENT" });
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

await test("a managed directory can become a public file before the Git index changes", async () => {
  const fixture = await syncFixture();
  try {
    await mkdir(join(fixture.repository, "entry"));
    await writeFile(join(fixture.repository, "entry", "managed.txt"), "public child\n");
    fixture.git("add", "entry/managed.txt");
    fixture.success();
    await rename(join(fixture.repository, "entry"), join(fixture.directory, "removed-entry"));
    await writeFile(join(fixture.repository, "entry"), "public replacement\n");
    assert.equal(fixture.sync({ DASHBOARD_TEST_PARTIAL_TRANSFER_FAILURE: "entry" }).status, 23);
    fixture.success();
    fixture.success();
    assert.equal(await readFile(join(fixture.mirror, "entry"), "utf8"), "public replacement\n");
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

await test("directory replacement refuses to remove unmanaged remote children", async () => {
  const fixture = await syncFixture();
  try {
    await mkdir(join(fixture.repository, "entry"));
    await writeFile(join(fixture.repository, "entry", "managed.txt"), "public child\n");
    fixture.success();
    await writeFile(join(fixture.mirror, "entry", "foreign.txt"), "owned elsewhere\n");
    await rename(join(fixture.repository, "entry"), join(fixture.directory, "removed-entry"));
    await writeFile(join(fixture.repository, "entry"), "public replacement\n");
    assert.notEqual(fixture.sync().status, 0);
    assert.equal(await readFile(join(fixture.mirror, "entry", "foreign.txt"), "utf8"), "owned elsewhere\n");
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});
