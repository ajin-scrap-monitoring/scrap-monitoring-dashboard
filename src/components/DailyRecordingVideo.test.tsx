import { createRef, StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { HlsConfig, ErrorData } from "hls.js";

import { DailyRecordingVideo } from "./DailyRecordingVideo";
import { dailyHlsRequest, validDailyPlaylistPath } from "./daily-hls-request";

const { instances, supported, fakeFetchLoader } = vi.hoisted(() => ({
  instances: [] as { config: Partial<HlsConfig>; loadSource: ReturnType<typeof vi.fn>; attachMedia: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; error?: (_event: string, data: Pick<ErrorData, "fatal">) => void }[],
  supported: vi.fn(() => true),
  fakeFetchLoader: vi.fn(),
}));

vi.mock("hls.js/light", () => ({
  default: class {
    static isSupported = supported;
    static Events = { ERROR: "hlsError" };
    config: Partial<HlsConfig>;
    loadSource = vi.fn();
    attachMedia = vi.fn();
    destroy = vi.fn();
    error?: (_event: string, data: Pick<ErrorData, "fatal">) => void;
    constructor(config: Partial<HlsConfig>) { this.config = config; instances.push(this); }
    on(_event: string, callback: (_event: string, data: Pick<ErrorData, "fatal">) => void) { this.error = callback; }
  },
  FetchLoader: fakeFetchLoader,
}));

const path = "/media/daily-recordings/550e8400-e29b-41d4-a716-446655440000/hls/index.m3u8";
const origin = "https://dashboard.example.test";
const pause = vi.fn();
let nativeHls = false;

beforeEach(() => {
  instances.length = 0;
  nativeHls = false;
  pause.mockClear();
  supported.mockReset().mockReturnValue(true);
  vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockImplementation(() => nativeHls ? "probably" : "");
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function player(overrides: Partial<Parameters<typeof DailyRecordingVideo>[0]> = {}) {
  const props = { videoRef: createRef<HTMLVideoElement>(), path, label: "날짜 녹화 재생", onError: vi.fn(), onTimeUpdate: vi.fn(), ...overrides };
  return { props, view: render(<DailyRecordingVideo {...props} />) };
}

test("MSE 미지원이며 native HLS 지원 시 같은 origin의 playlist를 연결한다", async () => {
  nativeHls = true;
  supported.mockReturnValue(false);
  const { props, view } = player();
  const video = screen.getByLabelText("날짜 녹화 재생");
  await waitFor(() => expect(video).toHaveAttribute("src", path));
  expect(video).toHaveAttribute("controls");
  expect(video).toHaveAttribute("preload", "metadata");
  expect(video).not.toHaveAttribute("autoplay");
  expect(instances).toHaveLength(0);
  Object.defineProperty(video, "currentTime", { value: 18 });
  fireEvent.timeUpdate(video);
  expect(props.onTimeUpdate).toHaveBeenCalledWith(18);
  view.unmount();
  expect(video).not.toHaveAttribute("src");
  expect(pause).toHaveBeenCalled();
});

test("MSE player는 필요할 때 로드하고 FetchLoader와 요청 범위 및 retry를 제한한다", async () => {
  nativeHls = true;
  const { props, view } = player();
  await waitFor(() => expect(instances).toHaveLength(1));
  const instance = instances[0];
  expect(instance.config).toMatchObject({ enableWorker: false, loader: fakeFetchLoader, fragLoadPolicy: { default: { errorRetry: { maxNumRetry: 1 }, timeoutRetry: { maxNumRetry: 1 } } } });
  expect(instance.loadSource).toHaveBeenCalledWith(new URL(path, window.location.origin).href);
  expect(instance.attachMedia).toHaveBeenCalledWith(props.videoRef.current);
  view.unmount();
  expect(instance.destroy).toHaveBeenCalledOnce();
});

test("확대 player의 초기 재생 위치는 metadata 이후 한 번만 적용하고 자동 재생하지 않는다", async () => {
  const { props } = player({ initialTime: 31 });
  await waitFor(() => expect(instances).toHaveLength(1));
  const video = props.videoRef.current!;
  expect(video.currentTime).toBe(0);
  fireEvent.loadedMetadata(video);
  expect(video.currentTime).toBe(31);
  video.currentTime = 40;
  fireEvent.loadedMetadata(video);
  expect(video.currentTime).toBe(40);
  expect(video).not.toHaveAttribute("autoplay");
});

test("fatal 오류만 사용자용 실패로 전달하고 player를 종료하며 추가 retry를 시작하지 않는다", async () => {
  const { props } = player();
  await waitFor(() => expect(instances).toHaveLength(1));
  act(() => instances[0].error?.("hlsError", { fatal: false }));
  expect(props.onError).not.toHaveBeenCalled();
  act(() => instances[0].error?.("hlsError", { fatal: true }));
  act(() => instances[0].error?.("hlsError", { fatal: true }));
  fireEvent.error(screen.getByLabelText("날짜 녹화 재생"));
  expect(props.onError).toHaveBeenCalledOnce();
  expect(instances[0].destroy).toHaveBeenCalledOnce();
  expect(instances).toHaveLength(1);
});

test("callback 변경은 연결을 유지하고 URL 변경은 기존 player를 정리한다", async () => {
  const { props, view } = player();
  await waitFor(() => expect(instances).toHaveLength(1));
  const onError = vi.fn();
  view.rerender(<DailyRecordingVideo {...props} onError={onError} />);
  expect(instances).toHaveLength(1);
  act(() => instances[0].error?.("hlsError", { fatal: true }));
  expect(onError).toHaveBeenCalledOnce();
  expect(props.onError).not.toHaveBeenCalled();
  const another = path.replace("550e8400-e29b-41d4-a716-446655440000", "550e8400-e29b-41d4-a716-446655440001");
  view.rerender(<DailyRecordingVideo {...props} path={another} />);
  await waitFor(() => expect(instances).toHaveLength(2));
  expect(instances[0].destroy).toHaveBeenCalledOnce();
  expect(instances[1].loadSource).toHaveBeenCalledWith(new URL(another, window.location.origin).href);
});

test("MSE와 native HLS 미지원은 자동 재생 없이 실패로 전달한다", async () => {
  supported.mockReturnValue(false);
  const { props } = player();
  await waitFor(() => expect(props.onError).toHaveBeenCalledOnce());
  expect(instances).toHaveLength(0);
});

test("lazy import 전에 media 오류가 나면 늦게 완료된 player를 시작하지 않는다", async () => {
  const { props } = player();
  fireEvent.error(screen.getByLabelText("날짜 녹화 재생"));
  await act(async () => { await vi.dynamicImportSettled(); });
  expect(props.onError).toHaveBeenCalledOnce();
  expect(instances).toHaveLength(0);
});

test("종료 직후 완료되는 lazy import와 StrictMode cleanup은 이전 연결을 시작하지 않는다", async () => {
  const first = player();
  first.view.unmount();
  await act(async () => { await vi.dynamicImportSettled(); });
  expect(instances).toHaveLength(0);
  const videoRef = createRef<HTMLVideoElement>();
  const onError = vi.fn();
  const view = render(<StrictMode><DailyRecordingVideo videoRef={videoRef} path={path} label="StrictMode 영상" onError={onError} onTimeUpdate={vi.fn()} /></StrictMode>);
  await waitFor(() => expect({ instances: instances.length, supported: supported.mock.calls.length, error: onError.mock.calls.length }).toEqual({ instances: 1, supported: 1, error: 0 }));
  view.unmount();
  expect(instances[0].destroy).toHaveBeenCalledOnce();
});

test.each(["https://media.example.test/internal.m3u8", "//media.example.test/internal.m3u8", "/api/v2/daily-recordings/id/hls/index.m3u8", `${path}?token=secret`, `${path}#fragment`])("다른 공개 경로를 영상에 연결하지 않는다: %s", async invalid => {
  const { props } = player({ path: invalid });
  expect(props.onError).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("날짜 녹화 재생")).not.toHaveAttribute("src");
  await act(async () => { await Promise.resolve(); });
  expect(instances).toHaveLength(0);
});

test("같은 녹화의 playlist와 segment에 session을 전달하되 redirect를 차단한다", () => {
  const playlist = dailyHlsRequest(path, path, { method: "GET", credentials: "include", redirect: "follow" }, origin);
  const segment = dailyHlsRequest(path, path.replace("/hls/index.m3u8", "/media/segment-01.ts"), {}, origin);
  expect(validDailyPlaylistPath(path)).toBe(true);
  expect(playlist.url).toBe(origin + path);
  expect(playlist.credentials).toBe("same-origin");
  expect(playlist.redirect).toBe("error");
  expect(segment.url).toContain("/media/segment-01.ts");
});

test.each([
  "https://external.example.test" + path,
  path.replace("550e8400-e29b-41d4-a716-446655440000", "another-recording"),
  path.replace("/hls/index.m3u8", "/content"),
  path.replace("/hls/index.m3u8", "/media/segment%2F01.ts"),
  path.replace("/hls/index.m3u8", "/media/segment.ts?token=secret"),
  path.replace("/hls/index.m3u8", "/media/segment.ts#fragment"),
  `https://user:password@dashboard.example.test${path}`,
])("다른 origin과 녹화 식별자 및 미허용 요청을 차단한다: %s", requestedUrl => {
  expect(() => dailyHlsRequest(path, requestedUrl, {}, origin)).toThrow("Unexpected daily recording media path.");
});
