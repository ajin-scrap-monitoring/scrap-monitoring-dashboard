import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { prepareTlsMaterialFixture } from "../test/tls/material-fixture.ts";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

for (const mode of ["valid", "missing-san", "client-only-chain"]) {
  await test(`TLS material은 ${mode} 인증서의 DNS SAN과 전체 chain 서버 인증을 검사한다`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "dashboard-tls-material."));
    try {
      await prepareTlsMaterialFixture(directory, mode);
      const result = spawnSync("bash", ["scripts/verify-tls-material.sh"], {
        cwd: repositoryRoot, encoding: "utf8", timeout: 10_000,
        env: { ...process.env, DASHBOARD_TLS_CERTIFICATE_FILE: join(directory, "dashboard-fullchain.pem"),
          DASHBOARD_TLS_PRIVATE_KEY_FILE: join(directory, "server.key"), DASHBOARD_ROOT_CA_FILE: join(directory, "root-ca.crt") },
      });
      assert.notEqual(result.status, null, result.stderr);
      if (mode === "valid") assert.equal(result.status, 0, result.stderr);
      else assert.notEqual(result.status, 0, `Invalid ${mode} certificate was accepted.`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
