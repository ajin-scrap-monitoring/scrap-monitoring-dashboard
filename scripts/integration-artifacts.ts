import { randomBytes } from "node:crypto";
import { appendFile, chmod, copyFile, lstat, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const runsRoot = resolve(repositoryRoot, "test-results/service-integration");
type RunState = { project: string; sourceRoot: string; runDirectory: string };

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value as unknown[] : []; }

export function redact(value: string, secrets: string[] = []): string {
  for (const secret of secrets) if (secret) value = value.split(secret).join("[redacted]");
  return value.replace(/(?:scrap_session|csrfToken|csrf_token|password|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, "[redacted]")
    .replace(/[a-zA-Z0-9_-]{20,}/g, "[redacted]");
}

export function summarizeReport(input: unknown, secrets: string[] = []) {
  const tests: { file: string; title: string; status: string; duration: number }[] = [];
  const visit = (suite: unknown) => {
    const value = object(suite);
    for (const spec of array(value.specs)) {
      const definition = object(spec);
      for (const test of array(definition.tests)) {
        for (const result of array(object(test).results)) {
          const run = object(result);
          tests.push({
            file: redact(typeof definition.file === "string" ? definition.file : "", secrets),
            title: redact(typeof definition.title === "string" ? definition.title : "", secrets),
            status: typeof run.status === "string" && ["passed", "failed", "timedOut", "skipped", "interrupted"].includes(run.status) ? run.status : "unknown",
            duration: typeof run.duration === "number" && Number.isFinite(run.duration) ? run.duration : 0,
          });
        }
      }
    }
    array(value.suites).forEach(visit);
  };
  array(object(input).suites).forEach(visit);
  return tests;
}

export function summarizeServices(input: unknown) {
  return array(input).map((item) => {
    const service = object(item);
    return {
      service: typeof service.Service === "string" && /^[a-z-]+$/.test(service.Service) ? service.Service : "unknown",
      state: typeof service.State === "string" && /^[a-z ]+$/.test(service.State) ? service.State : "unknown",
      health: typeof service.Health === "string" && /^[a-z ]*$/.test(service.Health) ? service.Health : "unknown",
      exitCode: typeof service.ExitCode === "number" ? service.ExitCode : null,
    };
  });
}

async function validateDirectory(directory: string) {
  const path = resolve(directory);
  if (dirname(path) !== runsRoot || !/^run\.[A-Za-z0-9]{8}$/.test(basename(path)) || (await lstat(path)).isSymbolicLink()) throw new Error("Invalid integration run directory.");
  return path;
}

async function readState(directory: string): Promise<RunState> {
  const state = JSON.parse(await readFile(join(directory, "state.json"), "utf8")) as RunState;
  const expected = `dashboard-sync-${basename(directory).slice(4).toLowerCase()}`;
  if (state.project !== expected || state.runDirectory !== directory || !state.sourceRoot.startsWith("/")) throw new Error("Invalid integration run state.");
  return state;
}

async function screenshots(input: string, output: string) {
  let entries;
  try { entries = await readdir(input, { withFileTypes: true }); } catch (error) { if (object(error).code === "ENOENT") return; throw error; }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const source = join(input, entry.name);
    if (entry.isDirectory()) await screenshots(source, output);
    else if (entry.isFile() && entry.name.endsWith(".png")) {
      const bytes = await readFile(source);
      if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Invalid screenshot artifact.");
      const name = `${randomBytes(8).toString("hex")}.png`;
      await copyFile(source, join(output, name));
      await chmod(join(output, name), 0o644);
    }
  }
}

async function main() {
  const [mode, requestedDirectory, argument] = process.argv.slice(2);
  if (!requestedDirectory) throw new Error("Integration run directory is required.");
  const directory = await validateDirectory(requestedDirectory);
  if (mode === "prepare") {
    if (!argument?.startsWith("/") || /[\r\n\t]/.test(argument)) throw new Error("An absolute source directory is required.");
    await mkdir(join(directory, "private"), { mode: 0o700 });
    const state = { project: `dashboard-sync-${basename(directory).slice(4).toLowerCase()}`, sourceRoot: argument, runDirectory: directory };
    await writeFile(join(directory, "state.json"), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    const lines = [`SYNC_SOURCE_ROOT=${argument}`, `SYNC_RUN_DIRECTORY=${relative(repositoryRoot, directory)}`];
    for (const key of ["SYNC_ADMIN_PASSWORD", "SYNC_VIEWER_PASSWORD", "SYNC_EDGE_TOKEN", "SYNC_CAMERA_TOKEN", "SYNC_MEDIA_TOKEN"]) lines.push(`${key}=${randomBytes(24).toString("hex")}`);
    await writeFile(join(directory, "private/compose.env"), `${lines.join("\n")}\n`, { mode: 0o600, flag: "wx" });
  } else if (mode === "state") {
    const state = await readState(directory);
    console.log(`${state.project}\t${state.sourceRoot}\t${relative(repositoryRoot, directory)}`);
  } else if (mode === "publish") {
    await readState(directory);
    const exitCode = Number(argument);
    if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) throw new Error("Invalid integration exit code.");
    const secrets = (await readFile(join(directory, "private/compose.env"), "utf8")).split("\n").filter((line) => /PASSWORD|TOKEN/.test(line)).map((line) => line.slice(line.indexOf("=") + 1));
    let report: unknown = {};
    let services: unknown = [];
    try { report = JSON.parse(await readFile(join(directory, "private/report.json"), "utf8")) as unknown; } catch (error) { if (object(error).code !== "ENOENT") throw error; }
    try {
      const raw = await readFile(join(directory, "private/services.json"), "utf8");
      services = raw.trimStart().startsWith("[") ? JSON.parse(raw) as unknown : raw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as unknown);
    } catch (error) { if (object(error).code !== "ENOENT") throw error; }
    const output = join(directory, "artifacts");
    await mkdir(output, { mode: 0o755 });
    const summary = { exitCode, tests: summarizeReport(report, secrets), services: summarizeServices(services) };
    const serialized = `${JSON.stringify(summary, null, 2)}\n`;
    if (secrets.some((secret) => serialized.includes(secret)) || /scrap_session|csrfToken|Authorization/i.test(serialized)) throw new Error("Unsafe integration summary.");
    await writeFile(join(output, "summary.json"), serialized, { mode: 0o644 });
    await screenshots(join(directory, "private/browser"), output);
    await screenshots(join(directory, "private/screenshots"), output);
    await chmod(directory, 0o755);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `Service integration exit code: ${exitCode}\n`);
    console.log(`Service integration exit ${exitCode}; ${summary.tests.filter((item) => item.status === "passed").length} passed browser tests.`);
  } else if (mode === "clear-secrets") {
    await readState(directory);
    try { await unlink(join(directory, "private/compose.env")); } catch (error) { if (object(error).code !== "ENOENT") throw error; }
  } else throw new Error("Unknown integration artifact operation.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
