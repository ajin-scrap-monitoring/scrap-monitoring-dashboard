const MAX_FRAME_BYTES = 4 * 1024 * 1024;
const MAX_HEADER_BYTES = 4096;

export class MjpegResponseError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`MJPEG request failed with ${status}`);
    this.status = status;
  }
}

function headerEnd(bytes: Uint8Array) {
  for (let index = 0; index <= bytes.length - 4; index += 1) {
    if (bytes[index] === 13 && bytes[index + 1] === 10 && bytes[index + 2] === 13 && bytes[index + 3] === 10) return index;
  }
  return -1;
}

export async function readMjpeg({
  url,
  signal,
  onFrame,
  fetchImplementation = fetch,
}: {
  url: string;
  signal: AbortSignal;
  onFrame: (frame: Blob) => void;
  fetchImplementation?: typeof fetch;
}) {
  const resource = new URL(url, window.location.origin);
  if (!url.startsWith("/") || resource.origin !== window.location.origin) throw new Error("MJPEG must use the dashboard origin.");
  if (signal.aborted) throw new DOMException("MJPEG connection aborted.", "AbortError");
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const abort = () => {
    controller.abort();
    void reader?.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const waitForFrame = () => {
    clearTimeout(timeout);
    timeout = setTimeout(abort, 10_000);
  };
  try {
    waitForFrame();
    const response = await fetchImplementation(url, { credentials: "include", cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new MjpegResponseError(response.status);
    const contentType = response.headers.get("Content-Type") ?? "";
    const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
    if (!/^multipart\/x-mixed-replace\b/i.test(contentType) || !boundary || !response.body) throw new Error("Invalid MJPEG response.");
    const marker = `--${boundary[1] ?? boundary[2]}`;
    reader = response.body.getReader();
    let pending: Uint8Array<ArrayBuffer> = new Uint8Array();
    let frameLength: number | undefined;
    const decoder = new TextDecoder();
    while (!controller.signal.aborted) {
      const { done, value } = await reader.read();
      if (controller.signal.aborted) break;
      if (done) throw new Error("MJPEG stream ended.");
      const combined = new Uint8Array(pending.length + value.length);
      combined.set(pending);
      combined.set(value, pending.length);
      pending = combined;
      while (pending.length > 0 && !controller.signal.aborted) {
        if (frameLength === undefined) {
          const end = headerEnd(pending);
          if ((end < 0 ? pending.length : end + 4) > MAX_HEADER_BYTES) throw new Error("MJPEG header exceeds limit.");
          if (end < 0) {
            break;
          }
          const header = decoder.decode(pending.subarray(0, end));
          const length = header.match(/\r\nContent-Length:\s*(\d+)\s*(?:\r\n|$)/i);
          if (header.trimStart().split("\r\n", 1)[0] !== marker || !/\r\nContent-Type:\s*image\/jpeg\s*(?:\r\n|$)/i.test(header) || !length) throw new Error("Invalid MJPEG frame header.");
          frameLength = Number(length[1]);
          if (!Number.isSafeInteger(frameLength) || frameLength < 4 || frameLength > MAX_FRAME_BYTES) throw new Error("Invalid MJPEG frame size.");
          pending = pending.slice(end + 4);
        }
        if (pending.length < frameLength) break;
        const frame = pending.slice(0, frameLength);
        if (frame[0] !== 255 || frame[1] !== 216 || frame.at(-2) !== 255 || frame.at(-1) !== 217) throw new Error("Invalid JPEG frame.");
        onFrame(new Blob([frame], { type: "image/jpeg" }));
        pending = pending.slice(frameLength);
        frameLength = undefined;
        waitForFrame();
      }
    }
    throw new DOMException("MJPEG connection aborted.", "AbortError");
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
    controller.abort();
    await reader?.cancel().catch(() => undefined);
    reader?.releaseLock();
  }
}
