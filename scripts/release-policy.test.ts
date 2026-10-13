import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const verifyScript = join(repositoryRoot, "scripts/verify-release-tag.sh");

for (const mode of ["head", "ancestor", "outside-main", "mismatch", "invalid-tag", "missing-main"]) {
  await test(`Release tag 검사는 ${mode} 커밋과 원격 main 이력을 확인한다`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "dashboard-release-policy."));
    const git = (...args: string[]) => {
      const result = spawnSync("git", args, { cwd: directory, encoding: "utf8", timeout: 10_000 });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    try {
      git("init", "--initial-branch=main");
      git("config", "user.name", "Release Fixture");
      git("config", "user.email", "release@example.invalid");
      git("commit", "--allow-empty", "-m", "root");
      const ancestor = git("rev-parse", "HEAD");
      git("commit", "--allow-empty", "-m", "main");
      const head = git("rev-parse", "HEAD");
      if (mode !== "missing-main") git("update-ref", "refs/remotes/origin/main", head);
      git("switch", "--orphan", "outside");
      git("commit", "--allow-empty", "-m", "outside");
      const outside = git("rev-parse", "HEAD");
      const revision = mode === "ancestor" ? ancestor : mode === "outside-main" ? outside : head;
      const tag = mode === "invalid-tag" ? "v0.2.0-extra" : "v0.2.0";
      git("tag", "--annotate", tag, revision, "--message", "Release fixture");
      const result = spawnSync("bash", [verifyScript, tag, mode === "mismatch" ? ancestor : revision], {
        cwd: directory, encoding: "utf8", timeout: 10_000,
      });
      assert.notEqual(result.status, null, result.stderr);
      if (mode === "head" || mode === "ancestor") assert.equal(result.status, 0, result.stderr);
      else assert.notEqual(result.status, 0, `Invalid ${mode} release was accepted.`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

await test("Release 배포 파일은 공개 설정, digest와 검증 가능한 checksum만 포함한다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dashboard-release-assets."));
  const image = `ghcr.io/ajin-scrap-monitoring/scrap-monitoring-dashboard@sha256:${"a".repeat(64)}`;
  try {
    const result = spawnSync("bash", ["scripts/prepare-release-assets.sh", directory, image], { cwd: repositoryRoot, encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual((await readdir(directory)).sort(), ["SHA256SUMS", "image-reference.txt", "nginx-config.tar.gz", "runtime-config.example.json", "runtime-config.schema.json"]);
    assert.equal(await readFile(join(directory, "image-reference.txt"), "utf8"), `${image}\n`);
    for (const [asset, source] of [["runtime-config.example.json", "runtime-config.example.json"], ["runtime-config.schema.json", "docs/contracts/runtime-config.schema.json"]]) {
      assert.equal(await readFile(join(directory, asset), "utf8"), await readFile(join(repositoryRoot, source), "utf8"));
    }
    const checksums = spawnSync("sha256sum", ["--check", "SHA256SUMS"], { cwd: directory, encoding: "utf8" });
    assert.equal(checksums.status, 0, checksums.stderr);
    const archive = spawnSync("tar", ["--list", "--gzip", "--file", join(directory, "nginx-config.tar.gz")], { encoding: "utf8" });
    assert.equal(archive.status, 0, archive.stderr);
    const expected = spawnSync("git", ["ls-files", "nginx"], { cwd: repositoryRoot, encoding: "utf8" });
    assert.equal(expected.status, 0, expected.stderr);
    assert.equal(archive.stdout, expected.stdout);
    assert.match(archive.stdout, /nginx\/includes\/runtime-config\.conf/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await test("Release asset 생성은 mutable tag와 기존 파일 덮어쓰기를 거부한다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dashboard-release-assets."));
  try {
    const invalid = spawnSync("bash", ["scripts/prepare-release-assets.sh", directory, "ghcr.io/example/dashboard:latest"], { cwd: repositoryRoot, encoding: "utf8" });
    assert.notEqual(invalid.status, 0);
    assert.deepEqual(await readdir(directory), []);
    await writeFile(join(directory, "existing.txt"), "Preserve fixture.\n");
    const result = spawnSync("bash", ["scripts/prepare-release-assets.sh", directory, `ghcr.io/example/dashboard@sha256:${"b".repeat(64)}`], { cwd: repositoryRoot, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.equal(await readFile(join(directory, "existing.txt"), "utf8"), "Preserve fixture.\n");
    assert.deepEqual(await readdir(directory), ["existing.txt"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
