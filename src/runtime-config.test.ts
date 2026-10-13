import { afterEach, expect, test, vi } from "vitest";

import { loadRuntimeConfig, parseRuntimeConfig, RuntimeConfigError } from "./runtime-config";

const config = { schemaVersion: 1, pitId: "pit-example", cameraId: "camera-example" };
afterEach(() => vi.useRealTimers());

test("Backend 및 Media의 식별자 범위와 Unicode pit 길이를 보존한다", () => {
  expect(parseRuntimeConfig(config)).toEqual(config);
  expect(parseRuntimeConfig({ ...config, pitId: "한".repeat(50), cameraId: "a".repeat(128) })).toMatchObject({ pitId: "한".repeat(50) });
  expect(parseRuntimeConfig({ ...config, cameraId: "A1._~-" })).toMatchObject({ cameraId: "A1._~-" });
});

test.each([
  null, [], "json", {}, { ...config, schemaVersion: "1" }, { ...config, schemaVersion: 2 },
  { ...config, token: "not-public" }, { ...config, pitId: "" },
  { ...config, pitId: "a".repeat(51) }, { ...config, pitId: 1 },
  { ...config, cameraId: "" }, { ...config, cameraId: "a".repeat(129) },
  { ...config, cameraId: "_camera" }, { ...config, cameraId: "camera/name" },
  { ...config, cameraId: "camera%2fother" }, { ...config, cameraId: "camera\n" }, { ...config, cameraId: "한글" },
])("유효하지 않은 runtime 설정을 기본값으로 대체하지 않는다: %j", (value) => {
  expect(() => parseRuntimeConfig(value)).toThrow(RuntimeConfigError);
});

test("pit 값은 문자 제한 없이 보존하고 query parameter로 encode한다", () => {
  for (const pitId of [" ", "pit\n", "pit/name", "현장 적재 공간"]) {
    const parsed = parseRuntimeConfig({ ...config, pitId });
    const parameters = new URLSearchParams({ pit_id: parsed.pitId });
    expect(parsed.pitId).toBe(pitId);
    expect(new URLSearchParams(parameters.toString()).get("pit_id")).toBe(pitId);
  }
});

test("같은 origin에서 cache 없이 JSON 설정을 읽는다", async () => {
  const fetchImplementation = vi.fn(() => Promise.resolve(Response.json(config)));
  await expect(loadRuntimeConfig(fetchImplementation)).resolves.toEqual(config);
  expect(fetchImplementation).toHaveBeenCalledWith("/runtime-config.json", expect.objectContaining({ cache: "no-store", credentials: "same-origin" }));
});

test.each([
  new Response(null, { status: 404 }), new Response("<html></html>", { headers: { "Content-Type": "text/html" } }),
  new Response("{broken", { headers: { "Content-Type": "application/json" } }),
  new Response(" ".repeat(4097), { headers: { "Content-Type": "application/json" } }),
])("잘못된 응답과 SPA fallback을 설정으로 사용하지 않는다", async (response) => {
  await expect(loadRuntimeConfig(() => Promise.resolve(response))).rejects.toBeInstanceOf(RuntimeConfigError);
});

test("설정 timeout은 fetch를 취소하고 오류로 종료한다", async () => {
  vi.useFakeTimers();
  const fetchImplementation = vi.fn((_input: RequestInfo | URL, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  }));
  const rejected = expect(loadRuntimeConfig(fetchImplementation)).rejects.toBeInstanceOf(RuntimeConfigError);
  await vi.advanceTimersByTimeAsync(10_000);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});

test("응답 header 이후의 timeout은 stream reader도 취소한다", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel });
  const rejected = expect(loadRuntimeConfig(() => Promise.resolve(new Response(body, { headers: { "Content-Type": "application/json" } })))).rejects.toBeInstanceOf(RuntimeConfigError);
  await vi.advanceTimersByTimeAsync(10_000);
  await rejected;
  expect(cancel).toHaveBeenCalledOnce();
  expect(body.locked).toBe(false);
});

test("선언 및 stream의 4 KiB 제한과 잘못된 UTF-8을 거부한다", async () => {
  const responses = [
    new Response("{}", { headers: { "Content-Type": "application/json", "Content-Length": "4097" } }),
    new Response("한".repeat(1400), { headers: { "Content-Type": "application/json" } }),
    new Response(new Uint8Array([0xff]), { headers: { "Content-Type": "application/json" } }),
  ];
  for (const response of responses) await expect(loadRuntimeConfig(() => Promise.resolve(response))).rejects.toBeInstanceOf(RuntimeConfigError);
});

test("미리 취소한 설정 조회는 요청하지 않고 진행 중 취소의 늦은 응답을 거부한다", async () => {
  const controller = new AbortController();
  controller.abort();
  const fetchImplementation = vi.fn(() => Promise.resolve(Response.json(config)));
  await expect(loadRuntimeConfig(fetchImplementation, controller.signal)).rejects.toBeInstanceOf(RuntimeConfigError);
  expect(fetchImplementation).not.toHaveBeenCalled();
  const active = new AbortController();
  let complete: (response: Response) => void = () => undefined;
  const pending = loadRuntimeConfig(() => new Promise((resolve) => { complete = resolve; }), active.signal);
  active.abort();
  complete(Response.json(config));
  await expect(pending).rejects.toBeInstanceOf(RuntimeConfigError);
});
