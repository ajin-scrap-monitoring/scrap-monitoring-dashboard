import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { extractBackendContract, readManifest, serializeContract, snapshotFile, type Json } from "./backend-contract.ts";

const manifest = await readManifest();
const snapshotText = await readFile(snapshotFile, "utf8");
const snapshot = JSON.parse(snapshotText) as Json;

await test("snapshot 검사와 쓰기를 함께 요청하면 변경 없이 거부한다", async () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./backend-contract.ts", import.meta.url)),
    "--input", fileURLToPath(snapshotFile), "--check", "--write"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /mutually exclusive/);
  assert.equal(await readFile(snapshotFile, "utf8"), snapshotText);
});

await test("고정 manifest와 snapshot은 재추출해도 일치한다", () => {
  assert.deepEqual(extractBackendContract(snapshot, manifest), snapshot);
  assert.equal(serializeContract(extractBackendContract(snapshot, manifest)), serializeContract(snapshot));
});

await test("선택 경로와 순서에 무관하게 같은 출력을 생성한다", () => {
  const second = { ...manifest, paths: [...manifest.paths].reverse() };
  assert.equal(serializeContract(extractBackendContract(snapshot, manifest)), serializeContract(extractBackendContract(snapshot, second)));
});

await test("선택한 경로 누락을 거부한다", () => {
  assert.throws(() => extractBackendContract(snapshot, { ...manifest, paths: [...manifest.paths, "/missing"] }), /Contract path missing: \/missing/);
});

await test("중첩 참조와 순환 참조를 추출하고 불필요한 schema는 제외한다", () => {
  const document: Json = { openapi: "3.1.0", info: {}, paths: { "/api/example": { get: { schema: { $ref: "#/components/schemas/A" } } } }, components: { schemas: {
    A: { properties: { nested: { $ref: "#/components/schemas/B" } } },
    B: { properties: { parent: { $ref: "#/components/schemas/A" } } }, unused: {},
  } } };
  const result = extractBackendContract(document, { ...manifest, paths: ["/api/example"] });
  assert.deepEqual(result.components, { schemas: { A: { properties: { nested: { $ref: "#/components/schemas/B" } } }, B: { properties: { parent: { $ref: "#/components/schemas/A" } } } } });
});

await test("존재하지 않는 참조와 외부 참조를 거부한다", () => {
  for (const reference of ["#/components/schemas/missing", "https://other.example/schema.json"]) {
    const document: Json = { openapi: "3.1.0", info: {}, paths: { "/api/example": { $ref: reference } }, components: { schemas: {} } };
    assert.throws(() => extractBackendContract(document, { ...manifest, paths: ["/api/example"] }), /reference/);
  }
});

await test("JSON pointer로 escape한 schema 이름과 security 선언을 보존한다", () => {
  const document: Json = { openapi: "3.1.0", info: {}, paths: { "/api/example": { schema: { $ref: "#/components/schemas/A~1B~0C" } } }, security: [{ session: [] }], components: { schemas: { "A/B~C": {} }, securitySchemes: { session: { type: "apiKey", in: "cookie", name: "session" } } } };
  const result = extractBackendContract(document, { ...manifest, paths: ["/api/example"] });
  assert.deepEqual(result.components, document.components);
  assert.deepEqual(result.security, document.security);
});
