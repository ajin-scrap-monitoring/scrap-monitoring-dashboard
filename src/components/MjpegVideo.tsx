import { useEffect, useRef, useState } from "react";

import { MjpegResponseError, readMjpeg } from "./mjpeg-client";
import { VideoTimestamp } from "./VideoTimestamp";

const CAMERA_FRAME_HOLD_MS = 5000;
const retryDelays = [250, 500, 1000];

function redirectToLogin() {
  window.location.assign("/login");
}

function isImmediateMjpegError(error: unknown): boolean {
  if (error instanceof MjpegResponseError) {
    return error.status >= 400 && error.status < 500;
  }
  return error instanceof Error && /Invalid MJPEG|MJPEG header exceeds limit|Invalid JPEG|dashboard origin/i.test(error.message);
}

type ConnectionState = {
  key: string;
  state: "connecting" | "live" | "held";
  receivedAt?: string;
};

export function MjpegVideo({ alt, url, capturedAt, onSessionExpired = redirectToLogin }: { alt: string; url: string; capturedAt?: string | null; onSessionExpired?: () => void }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const retryRef = useRef({ key: url, index: 0 });
  const [connection, setConnection] = useState<ConnectionState>({ key: url, state: "connecting" });
  const current: ConnectionState = connection.key === url ? connection : { key: url, state: "connecting" };
  useEffect(() => {
    if (retryRef.current.key !== url) retryRef.current = { key: url, index: 0 };
    const image = imageRef.current;
    if (!image) return;
    let effectActive = true;
    let objectUrl: string | undefined;
    let pendingReceivedAt: string | undefined;
    let displayedReceivedAt: string | undefined;
    let hasDecodedFrame = false;
    let lastValidFrameAt: number | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let holdTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelAttempt: (() => void) | null = null;

    // 문서에서 빠진 img의 src를 바꾸면 Chromium이 viewport listener를 다시 등록해 img와 조상 DOM이 해제되지 않는다.
    const clearSource = () => {
      if (image.isConnected) image.removeAttribute("src");
    };
    const releaseFrame = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = undefined;
    };
    const clearHoldTimer = () => {
      if (holdTimer !== undefined) {
        clearTimeout(holdTimer);
        holdTimer = undefined;
      }
    };
    const resetDisplayedFrame = () => {
      clearHoldTimer();
      hasDecodedFrame = false;
      lastValidFrameAt = null;
      displayedReceivedAt = undefined;
      clearSource();
      releaseFrame();
      setConnection({ key: url, state: "connecting" });
    };
    const scheduleRetry = () => {
      if (!effectActive) return;
      clearTimeout(retryTimer);
      const delay = retryDelays[retryRef.current.index];
      retryRef.current.index = Math.min(retryRef.current.index + 1, retryDelays.length - 1);
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        if (effectActive) startAttempt();
      }, delay);
    };

    const startAttempt = () => {
      const controller = new AbortController();
      let attemptActive = true;
      cancelAttempt = () => {
        attemptActive = false;
        controller.abort();
      };
      const failAttempt = (error: unknown) => {
        if (!effectActive || !attemptActive) return;
        attemptActive = false;
        cancelAttempt = null;
        controller.abort();
        if (error instanceof MjpegResponseError && (error.status === 401 || error.status === 403)) {
          resetDisplayedFrame();
          onSessionExpired();
          return;
        }
        const now = performance.now();
        const canHold = !isImmediateMjpegError(error)
          && hasDecodedFrame
          && lastValidFrameAt !== null
          && now - lastValidFrameAt < CAMERA_FRAME_HOLD_MS;
        if (canHold && lastValidFrameAt !== null) {
          setConnection({ key: url, state: "held", receivedAt: displayedReceivedAt });
          if (holdTimer === undefined) {
            holdTimer = setTimeout(() => {
              holdTimer = undefined;
              if (effectActive) resetDisplayedFrame();
            }, Math.max(0, lastValidFrameAt + CAMERA_FRAME_HOLD_MS - now));
          }
        } else {
          resetDisplayedFrame();
        }
        scheduleRetry();
      };
      void readMjpeg({
        url,
        signal: controller.signal,
        onFrame: (frame) => {
          if (!effectActive || !attemptActive || !image.isConnected) return;
          const previous = objectUrl;
          pendingReceivedAt = new Date().toISOString();
          objectUrl = URL.createObjectURL(frame);
          image.src = objectUrl;
          if (previous) URL.revokeObjectURL(previous);
        },
      }).catch(failAttempt);
    };

    const displayFrame = () => {
      if (!effectActive) return;
      clearHoldTimer();
      hasDecodedFrame = true;
      lastValidFrameAt = performance.now();
      displayedReceivedAt = pendingReceivedAt;
      retryRef.current.index = 0;
      setConnection({ key: url, state: "live", receivedAt: displayedReceivedAt });
    };
    const decodeFailed = () => {
      if (!effectActive) return;
      cancelAttempt?.();
      cancelAttempt = null;
      resetDisplayedFrame();
      scheduleRetry();
    };

    image.addEventListener("load", displayFrame);
    image.addEventListener("error", decodeFailed);
    startAttempt();

    return () => {
      effectActive = false;
      clearTimeout(retryTimer);
      clearHoldTimer();
      cancelAttempt?.();
      cancelAttempt = null;
      image.removeEventListener("load", displayFrame);
      image.removeEventListener("error", decodeFailed);
      clearSource();
      releaseFrame();
    };
  }, [url, onSessionExpired]);

  const isVisible = current.state === "live" || current.state === "held";
  return <>
    <img ref={imageRef} alt={alt} style={{ visibility: isVisible ? "visible" : "hidden" }} />
    {current.state === "live"
      ? <span className="live-indicator">LIVE</span>
      : current.state === "held"
        ? <span className="live-indicator" title="마지막 정상 영상을 최대 5초 표시합니다">갱신 대기</span>
        : <span className="video-connection-state" role="status">영상 연결 중</span>}
    {isVisible && <VideoTimestamp capturedAt={capturedAt} receivedAt={current.receivedAt} />}
  </>;
}
