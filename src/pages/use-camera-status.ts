import { useEffect, useRef, useState } from "react";

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
  const [currentStatus, setCurrentStatus] = useState<CameraStatusV2 | null>(null);
  const [isExpiredOrFailed, setIsExpiredOrFailed] = useState(false);
  const [isUnsupported, setIsUnsupported] = useState(false);
  const expiresAtRef = useRef<number>(0);
  const inFlightRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    if (!dataSource?.getCameraStatus || !sessionUserId) {
      return () => { active = false; };
    }

    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let checkTimer: ReturnType<typeof setInterval> | undefined;

    const stopPolling = () => {
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = undefined;
      }
      if (checkTimer) {
        clearInterval(checkTimer);
        checkTimer = undefined;
      }
      controllerRef.current?.abort();
      controllerRef.current = null;
      inFlightRef.current = false;
    };

    const startCheckTimer = () => {
      if (checkTimer) clearInterval(checkTimer);
      checkTimer = setInterval(() => {
        if (!active) return;
        if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
        if (expiresAtRef.current > 0 && Date.now() >= expiresAtRef.current) {
          expiresAtRef.current = 0;
          setIsExpiredOrFailed(true);
        }
      }, 500);
    };

    const poll = async () => {
      if (!active || inFlightRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      inFlightRef.current = true;
      const controller = new AbortController();
      controllerRef.current = controller;

      try {
        const result = await dataSource.getCameraStatus!(controller.signal);
        if (!active) return;
        setIsUnsupported(false);
        const now = Date.now();
        const validSeconds =
          result.validForSeconds != null
            ? Math.min(Math.max(0, result.validForSeconds), 5)
            : 0;

        if (validSeconds > 0) {
          expiresAtRef.current = now + validSeconds * 1000;
          setCurrentStatus(result);
          setIsExpiredOrFailed(false);
        } else {
          // validForSeconds가 없거나 0이면 즉시 만료
          expiresAtRef.current = 0;
          setCurrentStatus(result);
          setIsExpiredOrFailed(true);
        }
      } catch (error) {
        if (!active) return;
        if (controller.signal.aborted) return;
        const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
        if (status === 501) {
          setIsUnsupported(true);
          setCurrentStatus(null);
          return;
        }
        expiresAtRef.current = 0;
        setIsExpiredOrFailed(true);
      } finally {
        inFlightRef.current = false;
        controllerRef.current = null;
        if (active && (typeof document === "undefined" || document.visibilityState !== "hidden")) {
          pollTimer = setTimeout(() => {
            void poll();
          }, 2000);
        }
      }
    };

    const handleVisibilityChange = () => {
      if (!active) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        stopPolling();
      } else {
        stopPolling();
        setCurrentStatus(null);
        setIsExpiredOrFailed(false);
        setIsUnsupported(false);
        expiresAtRef.current = 0;
        startCheckTimer();
        void poll();
      }
    };

    if (typeof document === "undefined" || document.visibilityState !== "hidden") {
      void poll();
      startCheckTimer();
    }

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      active = false;
      stopPolling();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }, [dataSource, sessionUserId]);

  if (!dataSource?.getCameraStatus || !sessionUserId || isUnsupported) return null;
  if (currentStatus === null && !isExpiredOrFailed) return null;
  return buildCameraDisplay(currentStatus, isExpiredOrFailed);
}
