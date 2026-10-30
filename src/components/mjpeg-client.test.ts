import { afterEach, expect, test, vi } from "vitest";

import { MjpegResponseError, readMjpeg } from "./mjpeg-client";

function multipart(chunks: Uint8Array[]) {
  return new Response(new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(chunk);
    controller.close();
  } }), { headers: { "Content-Type": "multipart/x-mixed-replace; boundary=frame" } });
}

afterEach(() => vi.useRealTimers());

function frameBytes(extraHeader = "", frame = new Uint8Array([255, 216, 1, 2, 255, 217])) {
  const header = new TextEncoder().encode(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}${extraHeader}\r\n\r\n`);
  const bytes = new Uint8Array(header.length + frame.length);
  bytes.set(header);
  bytes.set(frame, header.length);
  return bytes;
}

test.each([false, true])("완전한 header도 chunk 분할 %s와 무관하게 크기 제한을 적용한다", async (fragmented) => {
  const bytes = frameBytes(`\r\nX-Padding: ${"x".repeat(4200)}`);
  const onFrame = vi.fn();
  await expect(readMjpeg({ url: "/live", signal: new AbortController().signal, onFrame,
    fetchImplementation: vi.fn(() => Promise.resolve(multipart(fragmented ? [bytes.slice(0, 4200), bytes.slice(4200)] : [bytes])))
  })).rejects.toThrow("header exceeds limit");
  expect(onFrame).not.toHaveBeenCalled();
});

test.each([4096, 4097])("header의 %s-byte 경계를 검사한다", async (size) => {
  const baseLength = frameBytes("\r\nX-Padding: ").length - 6;
  const onFrame = vi.fn();
  await expect(readMjpeg({ url: "/live", signal: new AbortController().signal, onFrame,
    fetchImplementation: vi.fn(() => Promise.resolve(multipart([frameBytes(`\r\nX-Padding: ${"x".repeat(size - baseLength)}`)])))
  })).rejects.toThrow(size === 4096 ? "stream ended" : "header exceeds limit");
  expect(onFrame).toHaveBeenCalledTimes(size === 4096 ? 1 : 0);
});

test.each([
  "--frame-other\r\nContent-Type: image/jpeg\r\nContent-Length: 6\r\n\r\n",
  "--frame\r\nContent-Type: image/png\r\nContent-Length: 6\r\n\r\n",
  "--frame\r\nContent-Type: image/jpeg\r\n\r\n",
  "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: 3\r\n\r\n",
])("잘못된 frame header를 거부한다: %s", async (header) => {
  const onFrame = vi.fn();
  await expect(readMjpeg({ url: "/live", signal: new AbortController().signal, onFrame,
    fetchImplementation: vi.fn(() => Promise.resolve(multipart([new TextEncoder().encode(header), new Uint8Array([255, 216, 1, 2, 255, 217])])))
  })).rejects.toThrow(/frame header|frame size/);
  expect(onFrame).not.toHaveBeenCalled();
});

test.each(["application/json", "multipart/x-mixed-replace", "multipart/x-mixed-replace; boundary=frame"])("잘못된 response %s를 거부한다", async (contentType) => {
  await expect(readMjpeg({ url: "/live", signal: new AbortController().signal, onFrame: vi.fn(),
    fetchImplementation: vi.fn(() => Promise.resolve(new Response(null, { headers: { "Content-Type": contentType } })))
  })).rejects.toThrow("Invalid MJPEG response");
});

test("손상된 JPEG를 frame으로 전달하지 않는다", async () => {
  const onFrame = vi.fn();
  await expect(readMjpeg({ url: "/live", signal: new AbortController().signal, onFrame,
    fetchImplementation: vi.fn(() => Promise.resolve(multipart([frameBytes("", new Uint8Array([0, 0, 1, 2, 255, 217]))])))
  })).rejects.toThrow("Invalid JPEG frame");
  expect(onFrame).not.toHaveBeenCalled();
});

test("이미 취소된 연결은 fetch를 시작하지 않는다", async () => {
  const controller = new AbortController();
  controller.abort();
  const fetchImplementation = vi.fn();
  await expect(readMjpeg({ url: "/live", signal: controller.signal, onFrame: vi.fn(), fetchImplementation })).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchImplementation).not.toHaveBeenCalled();
});

test.each([false, true])("최초 frame은 3초, 다음 frame은 2초까지 기다리고 reader를 취소한다: %s", async (receivedFrame) => {
  vi.useFakeTimers();
  const onFrame = vi.fn();
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({ start(controller) { if (receivedFrame) controller.enqueue(frameBytes()); }, cancel });
  const response = new Response(stream, { headers: { "Content-Type": "multipart/x-mixed-replace; boundary=frame" } });
  const reading = readMjpeg({ url: "/live", signal: new AbortController().signal, onFrame, fetchImplementation: vi.fn(() => Promise.resolve(response)) });
  const rejected = expect(reading).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync((receivedFrame ? 2000 : 3000) - 1);
  expect(cancel).not.toHaveBeenCalled();
  expect(onFrame).toHaveBeenCalledTimes(receivedFrame ? 1 : 0);
  await vi.advanceTimersByTimeAsync(1);
  await rejected;
  expect(cancel).toHaveBeenCalledOnce();
  expect(stream.locked).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

test("정상 frame마다 다음 frame 대기를 갱신하고 2초 이내 수신을 유지한다", async () => {
  vi.useFakeTimers();
  const onFrame = vi.fn();
  const cancel = vi.fn();
  let writer: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { writer = controller; }, cancel });
  const response = new Response(stream, { headers: { "Content-Type": "multipart/x-mixed-replace; boundary=frame" } });
  const reading = readMjpeg({ url: "/live", signal: new AbortController().signal, onFrame, fetchImplementation: vi.fn(() => Promise.resolve(response)) });
  const rejected = expect(reading).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(2999);
  writer?.enqueue(frameBytes());
  await vi.advanceTimersByTimeAsync(0);
  for (let index = 0; index < 3; index++) {
    await vi.advanceTimersByTimeAsync(1999);
    expect(cancel).not.toHaveBeenCalled();
    writer?.enqueue(frameBytes());
    await vi.advanceTimersByTimeAsync(0);
  }
  expect(onFrame).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(1999);
  expect(cancel).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await rejected;
  expect(cancel).toHaveBeenCalledOnce();
  expect(stream.locked).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

test("완성되지 않은 frame의 부분 수신만으로 최초 frame 대기를 연장하지 않는다", async () => {
  vi.useFakeTimers();
  const onFrame = vi.fn();
  const cancel = vi.fn();
  let writer: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { writer = controller; }, cancel });
  const response = new Response(stream, { headers: { "Content-Type": "multipart/x-mixed-replace; boundary=frame" } });
  const reading = readMjpeg({ url: "/live", signal: new AbortController().signal, onFrame, fetchImplementation: vi.fn(() => Promise.resolve(response)) });
  const rejected = expect(reading).rejects.toMatchObject({ name: "AbortError" });
  const bytes = frameBytes();
  await vi.advanceTimersByTimeAsync(2000);
  writer?.enqueue(bytes.slice(0, -1));
  await vi.advanceTimersByTimeAsync(999);
  expect(cancel).not.toHaveBeenCalled();
  expect(onFrame).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await rejected;
  expect(cancel).toHaveBeenCalledOnce();
  expect(stream.locked).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

test("frame callback에서 취소하면 같은 chunk의 후속 frame을 전달하지 않는다", async () => {
  const controller = new AbortController();
  const onFrame = vi.fn(() => controller.abort());
  const bytes = frameBytes();
  const combined = new Uint8Array(bytes.length * 2);
  combined.set(bytes);
  combined.set(bytes, bytes.length);
  await expect(readMjpeg({ url: "/live", signal: controller.signal, onFrame,
    fetchImplementation: vi.fn(() => Promise.resolve(multipart([combined])))
  })).rejects.toMatchObject({ name: "AbortError" });
  expect(onFrame).toHaveBeenCalledOnce();
});

test("분할된 multipart header와 JPEG를 재조립하고 여러 프레임을 전달한다", async () => {
  const header = new TextEncoder().encode("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: 6\r\n\r\n");
  const frame = new Uint8Array([255, 216, 1, 2, 255, 217]);
  const bytes = new Uint8Array(header.length * 2 + frame.length * 2 + 2);
  bytes.set(header);
  bytes.set(frame, header.length);
  bytes.set(new Uint8Array([13, 10]), header.length + frame.length);
  bytes.set(header, header.length + frame.length + 2);
  bytes.set(frame, header.length * 2 + frame.length + 2);
  const onFrame = vi.fn();
  await expect(readMjpeg({ url: "/media/cameras/camera-main/live", signal: new AbortController().signal, onFrame,
    fetchImplementation: vi.fn(() => Promise.resolve(multipart([bytes.slice(0, 12), bytes.slice(12, header.length + 3), bytes.slice(header.length + 3)])))
  })).rejects.toThrow("stream ended");
  expect(onFrame).toHaveBeenCalledTimes(2);
  expect((onFrame.mock.calls[0][0] as Blob).size).toBe(6);
});

test("session 오류의 HTTP status를 전달하고 credentials를 포함한다", async () => {
  const fetchImplementation = vi.fn(() => Promise.resolve(new Response(null, { status: 401 })));
  await expect(readMjpeg({ url: "/media/cameras/camera-main/live", signal: new AbortController().signal, onFrame: vi.fn(), fetchImplementation })).rejects.toMatchObject({ status: 401 });
  expect(fetchImplementation.mock.calls[0]).toBeDefined();
  expect(fetchImplementation).toHaveBeenCalledWith("/media/cameras/camera-main/live", expect.objectContaining({ credentials: "include", cache: "no-store" }));
  expect(new MjpegResponseError(503).status).toBe(503);
});

test("너무 큰 JPEG와 다른 origin을 거부한다", async () => {
  const oversized = new TextEncoder().encode("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: 4194305\r\n\r\n");
  const fetchImplementation = vi.fn(() => Promise.resolve(multipart([oversized])));
  await expect(readMjpeg({ url: "/media/cameras/camera-main/live", signal: new AbortController().signal, onFrame: vi.fn(), fetchImplementation })).rejects.toThrow("frame size");
  await expect(readMjpeg({ url: "https://other.example/live", signal: new AbortController().signal, onFrame: vi.fn(), fetchImplementation })).rejects.toThrow("dashboard origin");
});
