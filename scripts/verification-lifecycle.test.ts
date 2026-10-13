import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const dockerMock = `#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const args = process.argv.slice(2);
if (args[0] === 'version') console.log('29.8.0');
else if (args[0] === 'buildx') console.log('github.com/docker/buildx v0.37.1 synthetic');
else if (args[0] === 'context') console.log('unix://' + process.env.FIXTURE_SOCKET);
else if (args[0] === 'run') {
  const index = args.indexOf('node');
  const mappedArgs = args.slice(index + 1).map((argument) => argument.startsWith('/app/')
    ? resolve(process.env.FIXTURE_REPOSITORY, argument.slice(5)) : argument);
  const result = spawnSync(process.execPath, mappedArgs, { cwd: process.env.FIXTURE_REPOSITORY, stdio: 'inherit' });
  process.exit(result.status ?? 1);
} else if (args[0] === 'compose') {
  if (args[1] === 'version') console.log('5.5.1');
  else if (args.includes('ps')) console.log('[]');
  else if (args.includes('down')) {
    const path = process.env.FIXTURE_DIRECTORY + '/cleanup-count';
    const count = fs.existsSync(path) ? Number(fs.readFileSync(path, 'utf8')) : 0;
    fs.writeFileSync(path, String(count + 1));
  }
  else if (args.includes('up') && process.env.FIXTURE_MODE === 'interrupt') setInterval(() => {}, 1000);
  else if (args.includes('run') && args.includes('browser') && !args.includes('install')) {
    const env = fs.readFileSync(args[args.indexOf('--env-file') + 1], 'utf8');
    console.log('RAW-CREDENTIAL ' + env.split('\\n').find((line) => line.startsWith('SYNC_ADMIN_PASSWORD=')));
    process.exit(process.env.FIXTURE_MODE === 'failure' ? 17 : 0);
  }
} else if (args[0] === 'container' && args[1] === 'inspect') {
  console.log('sha256:' + 'a'.repeat(64) + '\\nsha256:' + 'a'.repeat(64));
} else if (['container', 'network', 'volume'].includes(args[0]) && args[1] === 'ls') {
  const path = process.env.FIXTURE_DIRECTORY + '/cleanup-count';
  const count = fs.existsSync(path) ? Number(fs.readFileSync(path, 'utf8')) : 0;
  if (process.env.FIXTURE_MODE === 'cleanup-race' && count < 2) console.log('late-created-resource');
} else process.exit(1);
`;
const gitMock = `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
if (args.includes('rev-parse')) {
  const directory = path.basename(args[args.indexOf('-C') + 1]);
  const manifest = JSON.parse(fs.readFileSync(path.join(process.env.FIXTURE_REPOSITORY, 'docs/contracts/backend/manifest.json'), 'utf8'));
  console.log(manifest.sources.find((source) => source.directory === directory).revision);
}
`;

async function run(mode: string) {
  const directory = await mkdtemp(join(tmpdir(), "dashboard-script-test."));
  const fixtureRepository = join(directory, "repository");
  const server = createServer();
  const socket = join(directory, "docker.sock");
  await new Promise<void>((resolve) => server.listen(socket, resolve));
  let child: ChildProcessWithoutNullStreams | undefined;
  let output = "";
  let runDirectory: string | undefined;
  let signalSent = false;
  try {
    const bin = join(directory, "bin");
    const sources = join(directory, "sources");
    await mkdir(bin);
    for (const file of ["package.json", "Dockerfile", "docs/contracts/backend/manifest.json", "scripts/verify-service-integration.sh",
      "scripts/verification-common.sh", "scripts/cleanup-service-project.sh", "scripts/backend-contract.ts", "scripts/integration-artifacts.ts"]) {
      const destination = join(fixtureRepository, file);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(join(repositoryRoot, file), destination);
    }
    for (const name of ["backend", "media", "edge"]) await mkdir(join(sources, name), { recursive: true });
    await writeFile(join(bin, "docker"), dockerMock, { mode: 0o755 });
    await writeFile(join(bin, "git"), gitMock, { mode: 0o755 });
    await writeFile(join(bin, "id"), "#!/usr/bin/env sh\nprintf '0\\n'\n", { mode: 0o755 });
    child = spawn("bash", ["scripts/verify-service-integration.sh"], {
      cwd: fixtureRepository,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, DOCKER_HOST: `unix://${socket}`, SYNC_SOURCE_ROOT: sources,
        FIXTURE_SOCKET: socket, FIXTURE_REPOSITORY: fixtureRepository, FIXTURE_MODE: mode, FIXTURE_DIRECTORY: directory },
    });
    const processUnderTest = child;
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (mode === "interrupt" && !signalSent && output.includes("Running service-readiness")) {
        signalSent = true;
        processUnderTest.kill("SIGTERM");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    const code = await new Promise<number | null>((resolve, reject) => {
      processUnderTest.on("error", reject);
      processUnderTest.on("close", resolve);
    });
    runDirectory = output.match(/Integration run directory: (.+)/)?.[1];
    assert.ok(runDirectory, output);
    const summary = JSON.parse(await readFile(join(runDirectory, "artifacts/summary.json"), "utf8")) as { exitCode: number };
    assert.equal(summary.exitCode, mode === "failure" ? 17 : mode === "interrupt" ? 143 : 0);
    assert.equal(code, summary.exitCode);
    assert.ok(!output.includes("RAW-CREDENTIAL"));
    await assert.rejects(readFile(join(runDirectory, "private/compose.env")), { code: "ENOENT" });
  } finally {
    child?.kill("SIGTERM");
    await new Promise<void>((resolve) => server.close(() => resolve()));
    runDirectory ??= output.match(/Integration run directory: (.+)/)?.[1];
    if (runDirectory && dirname(runDirectory) === join(fixtureRepository, "test-results/service-integration") && /^run\.[A-Za-z0-9]{8}$/.test(basename(runDirectory))) {
      await rm(runDirectory, { recursive: true, force: true });
    }
    await rm(directory, { recursive: true, force: true });
  }
}

for (const mode of ["success", "failure", "interrupt", "cleanup-race"]) {
  await test(`통합 스크립트 ${mode} 종료는 결과와 비밀값 정리를 유지한다`, { timeout: 10_000 }, async () => {
    await run(mode);
  });
}
