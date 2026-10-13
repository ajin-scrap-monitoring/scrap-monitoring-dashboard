import { Config, loadConfig } from "@redocly/openapi-core";
import openapiTS, { astToString, COMMENT_HEADER, type OpenAPITSOptions } from "openapi-typescript";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ContractTarget = { name: string; input: URL; output: URL; options: OpenAPITSOptions };
const configFile = new URL("../redocly.yaml", import.meta.url);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

function localPath(value: string, prefix: string) {
  const path = new URL(value, configFile);
  if (path.protocol !== "file:") throw new Error("Contract paths must be local files.");
  const location = relative(repositoryRoot, fileURLToPath(path));
  if (isAbsolute(location) || !location.startsWith(`${prefix}/`)) throw new Error("Contract path is outside its repository boundary.");
  return path;
}

async function targets(): Promise<ContractTarget[]> {
  const config = await loadConfig({ configPath: fileURLToPath(configFile) });
  if (Object.keys(config.apis).sort().join(",") !== "backend,proposal") throw new Error("Both API contracts must be configured.");
  return Object.entries(config.apis).map(([name, api]) => {
    const options = (api as typeof api & { "x-openapi-ts"?: { output?: unknown; defaultNonNullable?: unknown; emptyObjectsUnknown?: unknown } })["x-openapi-ts"];
    if (typeof api.root !== "string" || typeof options?.output !== "string") throw new Error("Contract input and output are required.");
    for (const value of [options.defaultNonNullable, options.emptyObjectsUnknown]) {
      if (value !== undefined && typeof value !== "boolean") throw new Error("Contract generation options must be booleans.");
    }
    return {
      name, input: localPath(api.root, "docs/contracts"), output: localPath(options.output, "src/generated"),
      options: { immutable: true, defaultNonNullable: options.defaultNonNullable as boolean | undefined,
        emptyObjectsUnknown: options.emptyObjectsUnknown as boolean | undefined,
        redocly: new Config({ ...config.rawConfig, ...api, apis: config.apis }, config.configFile) },
    };
  });
}

export async function generateContracts(entries: ContractTarget[], write = false) {
  if (!entries.length) throw new Error("No API contracts configured.");
  const generated = await Promise.all(entries.map(async (entry) => ({ ...entry,
    content: `${COMMENT_HEADER}${astToString(await openapiTS(entry.input, entry.options))}`,
  })));
  if (write) {
    for (const entry of generated) await writeFile(entry.output, entry.content);
  } else {
    const changed: string[] = [];
    for (const entry of generated) if (await readFile(entry.output, "utf8") !== entry.content) changed.push(entry.name);
    if (changed.length) throw new Error(`Generated API types differ: ${changed.join(", ")}. Regenerate explicitly.`);
  }
  return generated.map((entry) => entry.name);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--check" && args[0] !== "--write")) throw new Error("Usage: generate-api-contracts.ts [--check | --write]");
  const names = await generateContracts(await targets(), args[0] === "--write");
  console.log(`API types ${args[0] === "--write" ? "generated" : "checked"}: ${names.join(", ")}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
