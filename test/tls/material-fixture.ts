import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

function openssl(directory: string, ...args: string[]) {
  const result = spawnSync("openssl", args, { cwd: directory, encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
}

export async function prepareTlsMaterialFixture(directory: string, mode: string) {
  for (const name of ["root", "intermediate", "server"]) {
    openssl(directory, "genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:P-256", "-out", `${name}.key`);
  }
  openssl(directory, "req", "-x509", "-new", "-sha256", "-days", "365", "-key", "root.key", "-subj", "/CN=Synthetic TLS Root",
    "-addext", "basicConstraints=critical,CA:TRUE,pathlen:1", "-addext", "keyUsage=critical,keyCertSign,cRLSign", "-out", "root-ca.crt");
  openssl(directory, "req", "-new", "-key", "intermediate.key", "-subj", "/CN=Synthetic TLS Intermediate", "-out", "intermediate.csr",
    "-addext", "basicConstraints=critical,CA:TRUE,pathlen:0", "-addext", "keyUsage=critical,keyCertSign,cRLSign",
    ...(mode === "client-only-chain" ? ["-addext", "extendedKeyUsage=clientAuth"] : []));
  openssl(directory, "x509", "-req", "-sha256", "-days", "365", "-in", "intermediate.csr", "-CA", "root-ca.crt", "-CAkey", "root.key",
    "-CAcreateserial", "-copy_extensions", "copy", "-out", "intermediate.crt");
  openssl(directory, "req", "-new", "-key", "server.key", "-subj", "/CN=dashboard.test", "-out", "server.csr",
    "-addext", "basicConstraints=critical,CA:FALSE", "-addext", "keyUsage=critical,digitalSignature", "-addext", "extendedKeyUsage=serverAuth",
    ...(mode === "missing-san" ? [] : ["-addext", "subjectAltName=DNS:dashboard.test"]));
  openssl(directory, "x509", "-req", "-sha256", "-days", "365", "-in", "server.csr", "-CA", "intermediate.crt", "-CAkey", "intermediate.key",
    "-CAcreateserial", "-copy_extensions", "copy", "-out", "server.crt");
  await writeFile(join(directory, "dashboard-fullchain.pem"), Buffer.concat([
    await readFile(join(directory, "server.crt")), await readFile(join(directory, "intermediate.crt")),
  ]), { mode: 0o644 });
}
