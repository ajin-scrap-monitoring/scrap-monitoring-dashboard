import { useEffect, useRef, useState } from "react";

import { MjpegResponseError, readMjpeg } from "./mjpeg-client";
import { VideoTimestamp } from "./VideoTimestamp";

const retryDelays = [250, 500, 1000];

function redirectToLogin() {
  window.location.assign("/login");
}

export function MjpegVideo({ alt, url, capturedAt, onSessionExpired = redirectToLogin }: { alt: string; url: string; capturedAt?: string | null; onSessionExpired?: () => void }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const retryRef = useRef({ key: url, index: 0 });
  const [connection, setConnection] = useState<{ key: string; attempt: number; connected: boolean; receivedAt?: string }>({ key: url, attempt: 0, connected: false });
  const current = connection.key === url ? connection : { key: url, attempt: 0, connected: false };
  useEffect(() => {
    if (retryRef.current.key !== url) retryRef.current = { key: url, index: 0 };
    const image = imageRef.current;
    const controller = new AbortController();
    let active = true;
    let failed = false;
    let objectUrl: string | undefined;
    let receivedAt: string | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    if (!image) return;
    const releaseFrame = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = undefined;
    };
    const fail = (error: unknown) => {
      if (!active || failed) return;
      failed = true;
      controller.abort();
      image.removeAttribute("src");
      releaseFrame();
      setConnection({ key: url, attempt: current.attempt, connected: false });
      if (error instanceof MjpegResponseError && (error.status === 401 || error.status === 403)) {
        onSessionExpired();
        return;
      }
      const delay = retryDelays[retryRef.current.index];
      retryRef.current.index = Math.min(retryRef.current.index + 1, retryDelays.length - 1);
      retryTimer = setTimeout(() => setConnection({ key: url, attempt: current.attempt + 1, connected: false }), delay);
    };
    const displayFrame = () => {
      if (active && !failed) {
        retryRef.current.index = 0;
        setConnection({ key: url, attempt: current.attempt, connected: true, receivedAt });
      }
    };
    const decodeFailed = () => fail(new Error("Invalid JPEG image."));
    image.addEventListener("load", displayFrame);
    image.addEventListener("error", decodeFailed);
    void readMjpeg({ url, signal: controller.signal, onFrame: (frame) => {
      if (!active || failed) return;
      const previous = objectUrl;
      receivedAt = new Date().toISOString();
      objectUrl = URL.createObjectURL(frame);
      image.src = objectUrl;
      if (previous) URL.revokeObjectURL(previous);
    } }).catch(fail);
    return () => {
      active = false;
      clearTimeout(retryTimer);
      controller.abort();
      image.removeEventListener("load", displayFrame);
      image.removeEventListener("error", decodeFailed);
      image.removeAttribute("src");
      releaseFrame();
    };
  }, [url, current.attempt, onSessionExpired]);

  return <>
    <img ref={imageRef} alt={alt} style={{ visibility: current.connected ? "visible" : "hidden" }} />
    {current.connected
      ? <span className="live-indicator">LIVE</span>
      : <span className="video-connection-state" role="status">영상 연결 중</span>}
    {current.connected && <VideoTimestamp capturedAt={capturedAt} receivedAt={current.receivedAt} />}
  </>;
}
