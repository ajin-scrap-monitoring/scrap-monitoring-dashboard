import { useEffect, useState } from "react";

import type { DashboardDataSource } from "../data/dashboard-data-source";
import type { CameraConnectionState, CameraStatusV2 } from "../data/camera-status-v2";
import { seoulDateTime, seoulDisplayText } from "../display-time";
import { formatMonitoringReasonDetails, formatMonitoringReasonSummary } from "./monitoring-presentation";

export type CameraDisplay = {
  status: "normal" | "unavailable" | "unknown";
  statusText: string;
  connectionText: string;
  frameReceivedText: string;
  frameReceivedTitle?: string;
  reasonText: string;
  reasonTitle?: string;
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

function formatCompactFrameTime(timeStr: string | null): string {
  if (!timeStr) return "정보 없음";
  const parsed = Date.parse(timeStr);
  if (!Number.isFinite(parsed)) return timeStr;
  const kst = seoulDateTime(parsed);
  return `${kst.slice(5, 7)}.${kst.slice(8, 10)} ${kst.slice(11, 19)}`;
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
    const reasonSummary = cameraStatus ? formatMonitoringReasonSummary(cameraStatus.reasonCodes) : null;
    const reasonDetails = cameraStatus ? formatMonitoringReasonDetails(cameraStatus.reasonCodes) : [];
    return {
      status: "unknown",
      statusText: "확인 불가",
      connectionText: "확인 불가",
      frameReceivedText: cameraStatus ? formatCompactFrameTime(cameraStatus.lastFrameReceivedAt) : "정보 없음",
      frameReceivedTitle: cameraStatus?.lastFrameReceivedAt ? formatFrameTime(cameraStatus.lastFrameReceivedAt) : undefined,
      reasonText: reasonSummary ?? "정보 없음",
      reasonTitle: reasonDetails.length > 0 ? reasonDetails.join("\n") : undefined,
      title: `${baseNotice}\n카메라 상태 확인 불가`,
    };
  }

  const connectionText = formatConnectionState(cameraStatus.connectionState);
  const fullFrameTime = formatFrameTime(cameraStatus.lastFrameReceivedAt);
  const reasonDetails = formatMonitoringReasonDetails(cameraStatus.reasonCodes);
  const lines = [
    baseNotice,
    `프레임 수신 시각: ${fullFrameTime}`,
    `연결 상태: ${connectionText}`,
  ];
  if (cameraStatus.reasonCodes.length > 0) {
    lines.push(`사유: ${cameraStatus.reasonCodes.join(", ")}`);
  }

  const title = lines.join("\n");
  const reasonSummary = formatMonitoringReasonSummary(cameraStatus.reasonCodes);
  const common = {
    connectionText,
    frameReceivedText: formatCompactFrameTime(cameraStatus.lastFrameReceivedAt),
    frameReceivedTitle: cameraStatus.lastFrameReceivedAt ? fullFrameTime : undefined,
    reasonText: reasonSummary ?? (cameraStatus.state === "HEALTHY" ? "정상" : "정보 없음"),
    reasonTitle: reasonDetails.length > 0 ? reasonDetails.join("\n") : undefined,
    title,
  };

  switch (cameraStatus.state) {
    case "HEALTHY":
      return { ...common, status: "normal", statusText: "정상" };
    case "INTERRUPTED":
      return { ...common, status: "unavailable", statusText: "수신 중단" };
    case "UNSUPPORTED":
      return { ...common, status: "unknown", statusText: "미지원" };
    case "UNKNOWN":
    default:
      return { ...common, status: "unknown", statusText: "확인 불가" };
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
