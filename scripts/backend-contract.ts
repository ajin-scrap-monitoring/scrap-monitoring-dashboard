import { isDeepStrictEqual } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };
export type ContractManifest = {
  version: number;
  sources: { directory: string; repository: string; revision: string }[];
  paths: string[];
};

export const manifestFile = new URL("../docs/contracts/backend/manifest.json", import.meta.url);
export const snapshotFile = new URL("../docs/contracts/backend/openapi.json", import.meta.url);

function object(value: Json | undefined, location: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`Expected object at ${location}`);
  return value;
}

export async function readManifest(): Promise<ContractManifest> {
  const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as ContractManifest;
  if (manifest.version !== 1 || !Array.isArray(manifest.sources) || !Array.isArray(manifest.paths)) throw new Error("Invalid contract manifest.");
  const directories = new Set<string>();
  for (const source of manifest.sources) {
    if (!["backend", "media", "edge"].includes(source.directory) || directories.has(source.directory)
      || !/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(source.repository) || !/^[a-f0-9]{40}$/.test(source.revision)) throw new Error("Invalid contract source.");
    directories.add(source.directory);
  }
  if (directories.size !== 3 || manifest.paths.some((path) => typeof path !== "string" || !path.startsWith("/api/"))
    || new Set(manifest.paths).size !== manifest.paths.length) throw new Error("Invalid contract selection.");
  return manifest;
}

export function extractBackendContract(input: Json, manifest: ContractManifest): JsonObject {
  const source = object(input, "OpenAPI");
  if (typeof source.openapi !== "string" || !/^3\.[01]\.\d+$/.test(source.openapi)) throw new Error("Unsupported OpenAPI version.");
  object(source.info, "info");
  const allPaths = object(source.paths, "paths");
  const backend = manifest.sources.find((item) => item.directory === "backend");
  if (!backend) throw new Error("Backend source is missing.");
  const paths: JsonObject = Object.fromEntries([...manifest.paths].sort().map((path) => {
    if (!Object.hasOwn(allPaths, path)) throw new Error(`Contract path missing: ${path}`);
    return [path, structuredClone(object(allPaths[path], path))];
  }));
  const components: JsonObject = {};
  const visited = new Set<string>();
  const visit = (value: Json): void => {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (typeof value.$ref === "string") {
      const reference = value.$ref;
      if (!reference.startsWith("#/components/")) throw new Error(`Unsupported contract reference: ${reference}`);
      const segments = reference.slice(2).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
      let referenced: Json | undefined = source;
      for (const part of segments) {
        const parent = object(referenced, reference);
        if (!Object.hasOwn(parent, part)) throw new Error(`Contract reference missing: ${reference}`);
        referenced = parent[part];
      }
      const category = segments[1];
      const name = segments[2];
      if (!category || !name) throw new Error(`Invalid contract reference: ${reference}`);
      const key = `${category}/${name}`;
      if (!visited.has(key)) {
        visited.add(key);
        const definition = object(object(source.components, "components")[category], category)[name];
        if (definition === undefined) throw new Error(`Contract reference missing: ${reference}`);
        const group = Object.hasOwn(components, category) ? object(components[category], category) : {};
        Object.defineProperty(group, name, { value: structuredClone(definition), enumerable: true, configurable: true });
        Object.defineProperty(components, category, { value: group, enumerable: true, configurable: true });
        visit(definition);
      }
    }
    Object.values(value).forEach(visit);
  };
  visit(paths);
  const result: JsonObject = {
    openapi: source.openapi,
    info: structuredClone(source.info),
    "x-source-repository": `https://github.com/${backend.repository}`,
    "x-source-revision": backend.revision,
    paths,
    components,
  };
  for (const key of ["servers", "tags", "security"] as const) {
    if (source[key] !== undefined) result[key] = structuredClone(source[key]);
  }
  if (source.components && Object.hasOwn(object(source.components, "components"), "securitySchemes")) {
    components.securitySchemes = structuredClone(object(source.components, "components").securitySchemes);
  }
  return result;
}

function sortJson(value: Json): Json {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortJson);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

export function serializeContract(value: Json): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

async function stdin() {
  let value = "";
  for await (const chunk of process.stdin) value += String(chunk);
  return value;
}

async function main() {
  const manifest = await readManifest();
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--sources") {
    for (const source of manifest.sources) console.log(`${source.directory}\t${source.repository}\t${source.revision}`);
    return;
  }
  let inputFile: string | undefined;
  let write = false;
  let check = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--write") write = true;
    else if (args[index] === "--check") check = true;
    else if (args[index] === "--input" && args[index + 1]) inputFile = args[++index];
    else throw new Error("Usage: backend-contract.ts [--input <OpenAPI file or ->] [--check | --write] | --sources");
  }
  if (write && check) throw new Error("Snapshot check and write modes are mutually exclusive.");
  if (write && !inputFile) throw new Error("Snapshot updates require an explicit OpenAPI input.");
  const inputText = inputFile === "-" ? await stdin() : await readFile(inputFile ?? snapshotFile, "utf8");
  const input = JSON.parse(inputText) as Json;
  const extracted = extractBackendContract(input, manifest);
  const serialized = serializeContract(extracted);
  if (write) {
    await writeFile(snapshotFile, serialized);
    console.log("Updated Backend contract snapshot.");
    return;
  }
  const snapshotText = await readFile(snapshotFile, "utf8");
  if (!isDeepStrictEqual(JSON.parse(snapshotText), extracted) || snapshotText !== serialized) throw new Error("Backend contract snapshot differs; inspect the contract and regenerate explicitly.");
  console.log("Backend contract snapshot matches the manifest and OpenAPI input.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
