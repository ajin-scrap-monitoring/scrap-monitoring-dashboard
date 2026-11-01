import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const scriptPath = join(repositoryRoot, "scripts/verify-build-output.mjs");

async function createDistFixture(files: Record<string, number>): Promise<{ distDirectory: string; cleanup: () => Promise<void> }> {
  const distDirectory = await mkdtemp(join(tmpdir(), "dashboard-build-output-fixture."));
  const assetDirectory = join(distDirectory, "assets");
  await mkdir(assetDirectory, { recursive: true });

  await Promise.all(
    Object.entries(files).map(([fileName, sizeInBytes]) =>
      writeFile(join(assetDirectory, fileName), Buffer.alloc(sizeInBytes))
    )
  );

  return {
    distDirectory,
    cleanup: async () => {
      await rm(distDirectory, { recursive: true, force: true });
    },
  };
}

await test("빌드 자산 크기가 기준 이하이면 항목별 크기를 출력하고 경고 없이 성공한다", async () => {
  const fixture = await createDistFixture({
    "index-main.js": 200 * 1024,
    "vendor.js": 100 * 1024,
    "style.css": 40 * 1024,
    "font.woff2": 1024 * 1024,
  });

  try {
    const environment = { ...process.env };
    delete environment.GITHUB_ACTIONS;
    delete environment.GITHUB_STEP_SUMMARY;

    const result = spawnSync(process.execPath, [scriptPath, fixture.distDirectory], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: environment,
      timeout: 15_000,
    });

    assert.equal(result.status, 0, `Script failed with error: ${result.stderr}`);
    assert.match(result.stdout, /초기 JavaScript: 200\.0 KiB \/ 340\.0 KiB/);
    assert.match(result.stdout, /전체 JavaScript: 300\.0 KiB \/ 975\.0 KiB/);
    assert.match(result.stdout, /전체 CSS: 40\.0 KiB \/ 65\.0 KiB/);
    assert.match(result.stdout, /전체 웹폰트: 1\.00 MiB \/ 4\.9 MiB/);
    assert.match(result.stdout, /전체 정적 자산: 1\.33 MiB \/ 6\.4 MiB/);
    assert.doesNotMatch(result.stdout, /::warning/);
    assert.doesNotMatch(result.stderr, /경고:/);
  } finally {
    await fixture.cleanup();
  }
});

await test("GitHub Actions 환경에서 빌드 자산 크기가 기준을 초과하면 annotation과 요약 표를 기록하고 성공한다", async () => {
  const fixture = await createDistFixture({
    "index-x.js": 400 * 1024,
    "style.css": 70 * 1024,
  });
  const summaryDirectory = await mkdtemp(join(tmpdir(), "dashboard-summary."));
  const summaryFile = join(summaryDirectory, "step_summary.md");
  await writeFile(summaryFile, "");

  try {
    const result = spawnSync(process.execPath, [scriptPath, fixture.distDirectory], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_ACTIONS: "true",
        GITHUB_STEP_SUMMARY: summaryFile,
      },
      timeout: 15_000,
    });

    assert.equal(result.status, 0, `Script failed with error: ${result.stderr}`);
    assert.match(result.stdout, /::warning title=빌드 크기 기준 초과::빌드 크기가 기준을 초과했습니다: 초기 JavaScript, 전체 CSS/);

    const summaryContent = await readFile(summaryFile, "utf8");
    assert.match(summaryContent, /### 빌드 크기 점검 결과/);
    assert.match(summaryContent, /\| 초기 JavaScript \| 400\.0 KiB \| 340\.0 KiB \| 기준 초과 \(경고\) \|/);
    assert.match(summaryContent, /\| 전체 JavaScript \| 400\.0 KiB \| 975\.0 KiB \| 정상 \|/);
    assert.match(summaryContent, /\| 전체 CSS \| 70\.0 KiB \| 65\.0 KiB \| 기준 초과 \(경고\) \|/);
    assert.match(summaryContent, /\| 전체 웹폰트 \| 0\.00 MiB \| 4\.9 MiB \| 정상 \|/);
    assert.match(summaryContent, /\| 전체 정적 자산 \| 0\.46 MiB \| 6\.4 MiB \| 정상 \|/);
  } finally {
    await Promise.all([
      fixture.cleanup(),
      rm(summaryDirectory, { recursive: true, force: true }),
    ]);
  }
});

await test("로컬 환경에서 빌드 자산 크기가 기준을 초과하면 표준 에러로 경고 문구를 출력하고 annotation을 생성하지 않는다", async () => {
  const fixture = await createDistFixture({
    "index-x.js": 400 * 1024,
    "style.css": 70 * 1024,
  });

  try {
    const environment = { ...process.env };
    delete environment.GITHUB_ACTIONS;
    delete environment.GITHUB_STEP_SUMMARY;

    const result = spawnSync(process.execPath, [scriptPath, fixture.distDirectory], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: environment,
      timeout: 15_000,
    });

    assert.equal(result.status, 0, `Script failed with error: ${result.stderr}`);
    assert.match(result.stderr, /경고: 빌드 크기가 기준을 초과했습니다: 초기 JavaScript, 전체 CSS/);
    assert.doesNotMatch(result.stdout, /::warning/);
    assert.doesNotMatch(result.stderr, /::warning/);
  } finally {
    await fixture.cleanup();
  }
});
