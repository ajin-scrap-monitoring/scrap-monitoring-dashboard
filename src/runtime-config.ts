export type DashboardRuntimeConfig = {
  readonly schemaVersion: 1;
  readonly pitId: string;
  readonly cameraId: string;
};

export class RuntimeConfigError extends Error {
  constructor() {
    super("Dashboard runtime configuration is unavailable or invalid.");
    this.name = "RuntimeConfigError";
  }
}

export function parseRuntimeConfig(value: unknown): DashboardRuntimeConfig {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new RuntimeConfigError();
  const config = value as Record<string, unknown>;
  if (Object.keys(config).length !== 3 || config.schemaVersion !== 1
    || typeof config.pitId !== "string" || typeof config.cameraId !== "string") throw new RuntimeConfigError();
  const pitLength = Array.from(config.pitId).length;
  if (pitLength < 1 || pitLength > 50
    || config.cameraId.length < 1 || config.cameraId.length > 128
    || !/^[A-Za-z0-9]/.test(config.cameraId) || /[^A-Za-z0-9._~-]/.test(config.cameraId)) throw new RuntimeConfigError();
  return { schemaVersion: 1, pitId: config.pitId, cameraId: config.cameraId };
}

export async function loadRuntimeConfig(fetchImplementation: typeof fetch = fetch, signal?: AbortSignal): Promise<DashboardRuntimeConfig> {
  if (signal?.aborted) throw new RuntimeConfigError();
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const abort = () => { controller.abort(); void reader?.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 10_000);
  try {
    const response = await fetchImplementation("/runtime-config.json", {
      cache: "no-store", credentials: "same-origin", signal: controller.signal,
    });
    if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("Content-Type") ?? "") || !response.body) throw new RuntimeConfigError();
    const declaredLength = response.headers.get("Content-Length");
    if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > 4096)) throw new RuntimeConfigError();
    reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    let body = "";
    while (!controller.signal.aborted) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 4096) throw new RuntimeConfigError();
      body += decoder.decode(next.value, { stream: true });
    }
    body += decoder.decode();
    if (controller.signal.aborted) throw new RuntimeConfigError();
    return parseRuntimeConfig(JSON.parse(body) as unknown);
  } catch {
    throw new RuntimeConfigError();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controller.abort();
    await reader?.cancel().catch(() => undefined);
    reader?.releaseLock();
  }
}
