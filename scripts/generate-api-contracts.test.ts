import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { generateContracts, type ContractTarget } from "./generate-api-contracts.ts";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "dashboard-codegen."));
  const schema = { openapi: "3.1.0", info: { title: "Synthetic contract", version: "1.0.0" }, paths: {}, components: { schemas: {
    Input: { type: "object", required: ["username"], properties: { username: { type: "string" }, persistent: { type: "boolean", default: false } } },
    Context: { type: "object" },
  } } };
  const input = pathToFileURL(join(directory, "openapi.json"));
  await writeFile(input, JSON.stringify(schema));
  const entries: ContractTarget[] = ["proposal", "backend"].map((name) => ({ name, input, output: pathToFileURL(join(directory, `${name}.ts`)),
    options: { immutable: true, defaultNonNullable: false, emptyObjectsUnknown: true },
  }));
  return { directory, entries };
}

await test("두 계약을 생성하고 읽기 전용으로 모두 검사한다", async () => {
  const { directory, entries } = await fixture();
  try {
    assert.deepEqual(await generateContracts(entries, true), ["proposal", "backend"]);
    const before = await Promise.all(entries.map((entry) => readFile(entry.output, "utf8")));
    assert.deepEqual(await generateContracts(entries), ["proposal", "backend"]);
    assert.deepEqual(await Promise.all(entries.map((entry) => readFile(entry.output, "utf8"))), before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

await test("첫 계약이 일치해도 두 번째 계약의 변경을 검사하고 파일은 수정하지 않는다", async () => {
  const { directory, entries } = await fixture();
  try {
    await generateContracts(entries, true);
    const changed = `${await readFile(entries[1].output, "utf8")}// synthetic drift\n`;
    await writeFile(entries[1].output, changed);
    await assert.rejects(generateContracts(entries), /Generated API types differ: backend/);
    assert.equal(await readFile(entries[1].output, "utf8"), changed);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

await test("optional default 입력과 임의 object 속성의 생성 설정을 적용한다", async () => {
  const { directory, entries } = await fixture();
  try {
    await generateContracts(entries, true);
    const output = await readFile(entries[1].output, "utf8");
    assert.match(output, /readonly persistent\?: boolean/);
    assert.match(output, /Context: Record<string, unknown>/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

await test("생성 검사와 쓰기를 동시에 요청하면 거부한다", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./generate-api-contracts.ts", import.meta.url)), "--write", "--check"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage:/);
});
