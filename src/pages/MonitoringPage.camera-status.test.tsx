import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { DashboardDataSource } from "../data/dashboard-data-source";
import type { CameraStatusV2 } from "../data/camera-status-v2";
import type { DashboardData, UserSession } from "../domain/dashboard";
import { MonitoringPage } from "./MonitoringPage";
import { buildCameraDisplay } from "./use-camera-status";

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

  test("MonitoringPage 렌더링 시 카메라 행 상태와 title이 올바르게 표시된다", async () => {
    const cameraMock = vi.fn().mockResolvedValue(
      createCameraStatus({
        state: "HEALTHY",
        connectionState: "CONNECTED",
        lastFrameReceivedAt: "2026-11-01T08:59:58Z",
      }),
    );
    const dataSource: DashboardDataSource = {
      getDashboardData: () => Promise.resolve(baseDashboardData),
      getCameraStatus: cameraMock,
    };

    render(<MonitoringPage data={baseDashboardData} dataSource={dataSource} />);

    await act(async () => {
      await Promise.resolve();
    });

    const cameraCell = screen.getByText("카메라").closest(".device")!;
    const statusText = cameraCell.querySelector(".status-text")!;
    expect(statusText).toHaveTextContent("정상");
    expect(statusText.className).toContain("ok");
    expect(statusText.getAttribute("title")).toContain("프레임 수신 기준");
    expect(statusText.getAttribute("title")).toContain("프레임 수신 시각");
    expect(statusText.getAttribute("title")).toContain("연결 상태: 연결됨");
  });
});

describe("카메라 상태 유효 시간 만료와 실패 시 확인 불가 전환", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  test("validForSeconds 만료 시 이전 정상 상태를 유지하지 않고 확인 불가로 전환된다", async () => {
    const cameraMock = vi.fn().mockResolvedValue(
      createCameraStatus({
        state: "HEALTHY",
        validForSeconds: 1.0, // 1초 유효
      }),
    );
    const dataSource: DashboardDataSource = {
      getDashboardData: () => Promise.resolve(baseDashboardData),
      getCameraStatus: cameraMock,
    };

    render(<MonitoringPage data={baseDashboardData} dataSource={dataSource} />);

    // 첫 요청 완료
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const cameraCell = screen.getByText("카메라").closest(".device")!;
    const statusText = cameraCell.querySelector(".status-text")!;
    expect(statusText).toHaveTextContent("정상");

    // 다음 폴링(2초 후) 전에 유효 시간(1초) 만료 검사(500ms 주기) 트리거
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });

    expect(statusText).toHaveTextContent("확인 불가");
    expect(statusText.getAttribute("title")).toContain("카메라 상태 확인 불가");
  });

  test("조회 실패 시 이전 정상을 유지하지 않고 확인 불가로 표시된다", async () => {
    let shouldFail = false;
    const cameraMock = vi.fn().mockImplementation(() => {
      if (shouldFail) {
        return Promise.reject(new Error("Network Error"));
      }
      return Promise.resolve(createCameraStatus({ state: "HEALTHY", validForSeconds: 5.0 }));
    });
    const dataSource: DashboardDataSource = {
      getDashboardData: () => Promise.resolve(baseDashboardData),
      getCameraStatus: cameraMock,
    };

    render(<MonitoringPage data={baseDashboardData} dataSource={dataSource} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const cameraCell = screen.getByText("카메라").closest(".device")!;
    const statusText = cameraCell.querySelector(".status-text")!;
    expect(statusText).toHaveTextContent("정상");

    // 실패 유도 후 2초 경과 (다음 폴링)
    shouldFail = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(statusText).toHaveTextContent("확인 불가");
  });

  test("validForSeconds가 null이면 즉시 만료되어 확인 불가로 표시된다", async () => {
    const cameraMock = vi.fn().mockResolvedValue(
      createCameraStatus({
        state: "HEALTHY",
        validForSeconds: null,
      }),
    );
    const dataSource: DashboardDataSource = {
      getDashboardData: () => Promise.resolve(baseDashboardData),
      getCameraStatus: cameraMock,
    };

    render(<MonitoringPage data={baseDashboardData} dataSource={dataSource} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const cameraCell = screen.getByText("카메라").closest(".device")!;
    const statusText = cameraCell.querySelector(".status-text")!;
    expect(statusText).toHaveTextContent("확인 불가");
  });
});

describe("카메라 폴링 겹침 방지와 중단", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  test("응답이 늦어도 요청이 겹치지 않고 완료 후 2초 뒤에 다음 요청이 수행된다", async () => {
    let pendingResolve: ((value: CameraStatusV2) => void) | null = null;
    const cameraMock = vi.fn().mockImplementation(() => {
      return new Promise<CameraStatusV2>((resolve) => {
        pendingResolve = resolve;
      });
    });

    const dataSource: DashboardDataSource = {
      getDashboardData: () => Promise.resolve(baseDashboardData),
      getCameraStatus: cameraMock,
    };

    render(<MonitoringPage data={baseDashboardData} dataSource={dataSource} />);

    // 첫 요청 시작
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(cameraMock).toHaveBeenCalledTimes(1);

    // 3초가 지나도 아직 첫 응답이 오지 않았으므로 중복 요청이 발생하지 않음
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(cameraMock).toHaveBeenCalledTimes(1);

    // 첫 응답 완료
    await act(async () => {
      pendingResolve!(createCameraStatus());
      await Promise.resolve();
    });

    // 완료 후 1초 경과 (아직 2초 안 됨)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(cameraMock).toHaveBeenCalledTimes(1);

    // 완료 후 총 2초 경과 -> 두 번째 요청 시작
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(cameraMock).toHaveBeenCalledTimes(2);
  });

  test("화면을 언마운트하면 폴링이 멈추고 진행 중인 요청이 abort된다", async () => {
    let capturedSignal: AbortSignal | null = null;
    const cameraMock = vi.fn().mockImplementation((signal?: AbortSignal) => {
      capturedSignal = signal ?? null;
      return new Promise<CameraStatusV2>(() => {});
    });

    const dataSource: DashboardDataSource = {
      getDashboardData: () => Promise.resolve(baseDashboardData),
      getCameraStatus: cameraMock,
    };

    const { unmount } = render(<MonitoringPage data={baseDashboardData} dataSource={dataSource} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(cameraMock).toHaveBeenCalledTimes(1);
    const signal = capturedSignal as AbortSignal | null;
    expect(signal?.aborted).toBe(false);

    // 언마운트
    unmount();
    expect(signal?.aborted).toBe(true);

    // 시간 경과 후에도 추가 요청 없음
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(cameraMock).toHaveBeenCalledTimes(1);
  });

  test("내용이 같은 새 session 객체로 다시 렌더링해도 요청이 늘지 않고 2초 간격을 유지한다", async () => {
    const cameraMock = vi.fn().mockResolvedValue(
      createCameraStatus({ state: "HEALTHY", validForSeconds: 5.0 }),
    );
    const dataSource: DashboardDataSource = {
      getDashboardData: () => Promise.resolve(baseDashboardData),
      getCameraStatus: cameraMock,
    };

    const initialSession: UserSession = {
      expiresAt: "2026-11-01T12:00:00Z",
      user: { displayName: "테스트 사용자", id: "user-test", role: "viewer" },
    };

    const view = render(
      <MonitoringPage
        data={{ ...baseDashboardData, session: initialSession }}
        dataSource={dataSource}
      />,
    );

    // 최초 1회 요청 완료
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(cameraMock).toHaveBeenCalledTimes(1);

    // 1초 경과 (2초 폴링 전)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(cameraMock).toHaveBeenCalledTimes(1);

    // 내용이 같지만 다른 객체 참조를 가진 session으로 리렌더링
    const newSessionSameContent: UserSession = {
      expiresAt: "2026-11-01T12:00:00Z",
      user: { displayName: "테스트 사용자", id: "user-test", role: "viewer" },
    };
    expect(newSessionSameContent).not.toBe(initialSession);

    view.rerender(
      <MonitoringPage
        data={{ ...baseDashboardData, session: newSessionSameContent }}
        dataSource={dataSource}
      />,
    );

    // 리렌더 직후에도 즉시 요청이 실행되지 않고 1회 유지
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(cameraMock).toHaveBeenCalledTimes(1);

    // 1초 더 경과 (첫 완료 후 총 2초 시점) -> 2초 간격에 맞춰 2번째 요청 수행
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(cameraMock).toHaveBeenCalledTimes(2);

    // 다시 1초 경과 후 또 다른 새 session 객체로 리렌더링
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(cameraMock).toHaveBeenCalledTimes(2);

    const anotherSessionSameContent: UserSession = {
      expiresAt: "2026-11-01T12:00:00Z",
      user: { displayName: "테스트 사용자", id: "user-test", role: "viewer" },
    };
    view.rerender(
      <MonitoringPage
        data={{ ...baseDashboardData, session: anotherSessionSameContent }}
        dataSource={dataSource}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(cameraMock).toHaveBeenCalledTimes(2);

    // 1초 더 경과 (2번째 완료 후 총 2초 시점) -> 3번째 요청 수행
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(cameraMock).toHaveBeenCalledTimes(3);
  });

  test("숨김 상태에서는 폴링 타이머가 멈추고 요청이 없으며, 다시 보이면 즉시 재조회한다", async () => {
    vi.useFakeTimers();
    const cameraMock = vi.fn().mockImplementation((signal?: AbortSignal) => {
      if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
      return Promise.resolve(createCameraStatus({ state: "HEALTHY", validForSeconds: 5.0 }));
    });
    const dataSource: DashboardDataSource = {
      ...baseDashboardData,
      getCameraStatus: cameraMock,
      getDashboardData: vi.fn(),
    };

    render(<MonitoringPage data={baseDashboardData} dataSource={dataSource} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(cameraMock).toHaveBeenCalledTimes(1);

    // document를 hidden으로 변경
    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // 10초 경과 동안 추가 폴링 요청이 없어야 함
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(cameraMock).toHaveBeenCalledTimes(1);

    // 다시 visible로 변경
    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // 즉시 재조회 발생
    expect(cameraMock).toHaveBeenCalledTimes(2);

    // 정리
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });
});
