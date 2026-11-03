import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { DashboardDataSource } from "../data/dashboard-data-source";
import type { CameraStatusV2 } from "../data/camera-status-v2";
import type { DashboardData, UserSession } from "../domain/dashboard";
import { MonitoringPage } from "./MonitoringPage";
import { buildCameraDisplay, useCameraStatus } from "./use-camera-status";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const session: UserSession = {
  expiresAt: "2026-11-01T12:00:00Z",
  user: { displayName: "테스트 사용자", id: "user-test", role: "viewer" },
};

const baseDashboardData: DashboardData = {
  reception: { status: "connected", lastReceivedAt: "2026-11-01T09:00:00Z" },
  lastMeasuredAt: "09:00:00",
  session,
  monitoring: {
    alarmState: "NORMAL",
    status: "normal",
    videoMode: "sample",
    videoStatus: "available",
    videoStreamId: "cam-main",
    videoCapturedAt: null,
    summary: {
      loadPercent: 50,
      collectionThreshold: 80,
      expectedArrivalAt: "12:00",
      operationState: "accumulating",
      preCollectionAlert: { enabled: true, threshold: 70 },
      loadOneHourAgo: null,
      remainingTime: "3시간",
      timeSinceCollection: "1시간",
      averageCollectionCycle: "24시간",
    },
    devices: [
      { label: "LiDAR 1", latency: "100ms", received: "09:00", status: "normal" },
      { label: "LiDAR 2", latency: "100ms", received: "09:00", status: "normal" },
      { label: "카메라", latency: "100ms", received: "09:00", status: "normal" },
      { label: "엣지 장비", latency: "50ms", received: "09:00", status: "normal" },
    ],
    alerts: [],
    headerNotifications: [],
    unreadNotificationCount: 0,
    lidarProfiles: [],
    loadHistory: [],
  },
  history: {
    startsAt: "09:00",
    endsAt: "09:00",
    chartEvents: [],
    loadSamples: [],
    thresholds: [],
    events: [],
  },
  recordings: [],
  admin: {
    recipients: [],
    recipientSettings: {},
    preCollectionAlert: { enabled: true, threshold: 70 },
    alertSettings: {
      collectionThreshold: 80,
      enabledEventTypes: ["collection_required", "measurement_error", "device_error"],
      maximumRepeatCount: 3,
      preCollectionAlert: { enabled: true, threshold: 70 },
      recoveryNotificationEnabled: true,
      repeatIntervalMinutes: 30,
      sendDelayMinutes: 0,
      version: '"settings-v1"',
    },
  },
};

function createCameraStatus(overrides: Partial<CameraStatusV2> = {}): CameraStatusV2 {
  return {
    pitId: "pit-01",
    cameraId: "cam-main",
    state: "HEALTHY",
    connectionState: "CONNECTED",
    statusBasis: "ACCEPTED_JPEG_RECEIPT",
    computedAt: "2026-11-01T09:00:00Z",
    assessedAt: "2026-11-01T08:59:59Z",
    validUntilAt: "2026-11-01T09:00:05Z",
    validForSeconds: 5.0,
    lastFrameReceivedAt: "2026-11-01T08:59:58Z",
    reasonCodes: [],
    ...overrides,
  };
}

describe("카메라 상태 행 표시 및 헬퍼 함수", () => {
  test("buildCameraDisplay: 상태별 텍스트 및 톤 확인", () => {
    const healthy = buildCameraDisplay(createCameraStatus({ state: "HEALTHY" }), false);
    expect(healthy.status).toBe("normal");
    expect(healthy.statusText).toBe("정상");
    expect(healthy.title).toContain("프레임 수신 기준 상태");
    expect(healthy.title).toContain("프레임 수신 시각");
    expect(healthy.title).toContain("연결 상태: 연결됨");

    const interrupted = buildCameraDisplay(createCameraStatus({ state: "INTERRUPTED", connectionState: "DISCONNECTED", reasonCodes: ["CAMERA_STATUS_TIMEOUT"] }), false);
    expect(interrupted.status).toBe("unavailable");
    expect(interrupted.statusText).toBe("수신 중단");
    expect(interrupted.title).toContain("연결 상태: 연결 끊김");
    expect(interrupted.title).toContain("사유: CAMERA_STATUS_TIMEOUT");

    const unknown = buildCameraDisplay(createCameraStatus({ state: "UNKNOWN", connectionState: "UNKNOWN" }), false);
    expect(unknown.status).toBe("unknown");
    expect(unknown.statusText).toBe("확인 불가");
    expect(unknown.title).toContain("연결 상태: 확인 불가");

    const unsupported = buildCameraDisplay(createCameraStatus({ state: "UNSUPPORTED" }), false);
    expect(unsupported.status).toBe("unknown");
    expect(unsupported.statusText).toBe("미지원");

    const expired = buildCameraDisplay(createCameraStatus({ state: "HEALTHY" }), true);
    expect(expired.status).toBe("unknown");
    expect(expired.statusText).toBe("확인 불가");
    expect(expired.title).toContain("카메라 상태 확인 불가");
  });

  test("MonitoringPage는 SSE 카메라 상태의 프레임 수신 시각을 표시한다", () => {
    const stream = cameraSource();
    stream.emit(createCameraStatus());
    render(<MonitoringPage data={baseDashboardData} dataSource={stream.source} />);
    const status = screen.getByText("카메라").closest(".device")!.querySelector(".status-text")!;
    expect(status).toHaveTextContent("정상");
    expect(status.getAttribute("title")).toContain("프레임 수신 시각");
  });
});

function cameraSource() {
  let cached: { status: CameraStatusV2; receivedAt: number } | null = null;
  const listeners = new Set<(status: CameraStatusV2, receivedAt: number) => void>();
  const release = vi.fn();
  const subscribe = vi.fn((listener: (status: CameraStatusV2, receivedAt: number) => void) => {
    listeners.add(listener);
    if (cached) listener(cached.status, cached.receivedAt);
    return () => { listeners.delete(listener); release(); };
  });
  const source: DashboardDataSource = { getDashboardData: () => Promise.resolve(baseDashboardData), subscribeCameraStatus: subscribe };
  return { source, subscribe, release, emit(status: CameraStatusV2) {
    cached = { status, receivedAt: performance.now() };
    listeners.forEach(listener => listener(status, cached!.receivedAt));
  } };
}

describe("카메라 SSE 수신 기한과 구독 수명", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockImplementation(() => Date.now());
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  test("이벤트로 갱신하고 같은 상태의 새 이벤트도 수신 기한을 연장한다", async () => {
    const stream = cameraSource();
    const { result } = renderHook(() => useCameraStatus(stream.source, "user"));
    // 첫 이벤트 전에는 판정하지 않는다(snapshot의 장비 표시 유지).
    expect(result.current).toBeNull();
    act(() => stream.emit(createCameraStatus()));
    expect(result.current?.statusText).toBe("정상");
    await act(() => vi.advanceTimersByTimeAsync(4000));
    act(() => stream.emit(createCameraStatus()));
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(result.current?.statusText).toBe("정상");
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(result.current?.statusText).toBe("확인 불가");
  });

  test.each([null, 0])("validForSeconds=%s이면 즉시 확인 불가다", (validForSeconds) => {
    const stream = cameraSource();
    stream.emit(createCameraStatus({ validForSeconds }));
    const { result } = renderHook(() => useCameraStatus(stream.source, "user"));
    expect(result.current?.statusText).toBe("확인 불가");
  });

  test("SSE 이벤트가 끊기면 마지막 수신의 기한에 만료된다", async () => {
    const stream = cameraSource();
    const { result } = renderHook(() => useCameraStatus(stream.source, "user"));
    act(() => stream.emit(createCameraStatus({ validForSeconds: 1 })));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(result.current?.statusText).toBe("확인 불가");
    expect(stream.subscribe).toHaveBeenCalledTimes(1);
  });

  test("화면 재진입은 보관한 수신 시각을 사용하고 구독을 해제한다", async () => {
    const stream = cameraSource();
    stream.emit(createCameraStatus());
    const first = renderHook(() => useCameraStatus(stream.source, "user"));
    expect(first.result.current?.statusText).toBe("정상");
    first.unmount();
    expect(stream.release).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(4000));
    const second = renderHook(() => useCameraStatus(stream.source, "user"));
    expect(second.result.current?.statusText).toBe("정상");
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(second.result.current?.statusText).toBe("확인 불가");
    second.unmount();
    expect(stream.release).toHaveBeenCalledTimes(2);
  });

  test("같은 사용자 session 객체의 재생성은 구독을 늘리지 않고 로그아웃은 구독을 해제한다", () => {
    const stream = cameraSource();
    const initialProps: { user: string | null } = { user: "user" };
    const view = renderHook(({ user }) => useCameraStatus(stream.source, user), { initialProps });
    view.rerender({ user: "user" });
    expect(stream.subscribe).toHaveBeenCalledTimes(1);
    view.rerender({ user: null });
    expect(stream.release).toHaveBeenCalledTimes(1);
    expect(view.result.current).toBeNull();
  });

  test("숨김 탭은 기한 timer를 멈추고 다시 보일 때 즉시 만료를 판정한다", async () => {
    const stream = cameraSource();
    stream.emit(createCameraStatus());
    const { result } = renderHook(() => useCameraStatus(stream.source, "user"));
    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(vi.getTimerCount()).toBe(0);
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(result.current?.statusText).toBe("정상");
    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current?.statusText).toBe("확인 불가");
  });
});
