import { useEffect, useState } from "react";

import type { DashboardDataSource } from "../data/dashboard-data-source";
import type { CameraConnectionState, CameraStatusV2 } from "../data/camera-status-v2";
import { seoulDisplayText } from "../display-time";

export type CameraDisplay = {
  status: "normal" | "unavailable" | "unknown";
  statusText: string;
  title: string;
};

function formatFrameTime(timeStr: string | null): string {
  if (!timeStr) return "정보 없음";
  const parsed = Date.parse(timeStr);
  if (Number.isFinite(parsed)) {
    return seoulDisplayText(parsed);
  }
  return timeStr;
}

function formatConnectionState(connectionState: CameraConnectionState): string {
  switch (connectionState) {
    case "CONNECTED":
      return "연결됨";
    case "DISCONNECTED":
      return "연결 끊김";
    case "UNKNOWN":
    default:
      return "확인 불가";
  }
}

export function buildCameraDisplay(
  cameraStatus: CameraStatusV2 | null,
  isExpiredOrFailed: boolean,
): CameraDisplay {
  const baseNotice = "프레임 수신 기준 상태 (화질이나 하드웨어 자체 진단 아님)";
  if (!cameraStatus || isExpiredOrFailed) {
    return {
      status: "unknown",
      statusText: "확인 불가",
      title: `${baseNotice}\n카메라 상태 확인 불가`,
    };
  }

  const lines = [
    baseNotice,
    `프레임 수신 시각: ${formatFrameTime(cameraStatus.lastFrameReceivedAt)}`,
    `연결 상태: ${formatConnectionState(cameraStatus.connectionState)}`,
  ];
  if (cameraStatus.reasonCodes.length > 0) {
    lines.push(`사유: ${cameraStatus.reasonCodes.join(", ")}`);
  }

  const title = lines.join("\n");

  switch (cameraStatus.state) {
    case "HEALTHY":
      return { status: "normal", statusText: "정상", title };
    case "INTERRUPTED":
      return { status: "unavailable", statusText: "수신 중단", title };
    case "UNSUPPORTED":
      return { status: "unknown", statusText: "미지원", title };
    case "UNKNOWN":
    default:
      return { status: "unknown", statusText: "확인 불가", title };
  }
}

export function useCameraStatus(
  dataSource: DashboardDataSource | undefined,
  sessionUserId: string | null,
): CameraDisplay | null {
  const [display, setDisplay] = useState<{ source: DashboardDataSource; userId: string; value: CameraDisplay } | null>(null);

  useEffect(() => {
    if (!dataSource?.subscribeCameraStatus || !sessionUserId) return;
    let active = true;
    let latest: CameraStatusV2 | null = null;
    let expiresAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      if (!active || document.visibilityState === "hidden") return;
      const remaining = expiresAt - performance.now();
      setDisplay({ source: dataSource, userId: sessionUserId, value: buildCameraDisplay(latest, remaining <= 0) });
      if (remaining > 0) timer = setTimeout(check, remaining);
    };
    const unsubscribe = dataSource.subscribeCameraStatus((status, receivedAt) => {
      if (!active) return;
      latest = status;
      expiresAt = receivedAt + Math.min(status.validForSeconds ?? 0, 5) * 1000;
      check();
    });
    document.addEventListener("visibilitychange", check);
    return () => {
      active = false;
      unsubscribe();
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [dataSource, sessionUserId]);

  if (!dataSource?.subscribeCameraStatus || !sessionUserId) return null;
  // 첫 카메라 이벤트를 받기 전에는 판정하지 않고 snapshot의 장비 표시를 유지한다.
  return display?.source === dataSource && display.userId === sessionUserId ? display.value : null;
}
