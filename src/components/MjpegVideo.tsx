import { useEffect, useRef, useState } from "react";

import { MjpegResponseError, readMjpeg } from "./mjpeg-client";
import { VideoTimestamp } from "./VideoTimestamp";

const retryDelays = [1000, 2000, 3000];

function redirectToLogin() {
  window.location.assign("/login");
}

export function MjpegVideo({ alt, url, capturedAt, onSessionExpired = redirectToLogin }: { alt: string; url: string; capturedAt?: string | null; onSessionExpired?: () => void }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [connection, setConnection] = useState<{ key: string; attempt: number; connected: boolean; exhausted: boolean; receivedAt?: string }>({ key: url, attempt: 0, connected: false, exhausted: false });
  const current = connection.key === url ? connection : { key: url, attempt: 0, connected: false, exhausted: false };
  useEffect(() => {
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
      setConnection({ key: url, attempt: current.attempt, connected: false, exhausted: current.attempt >= retryDelays.length });
      if (error instanceof MjpegResponseError && (error.status === 401 || error.status === 403)) {
        onSessionExpired();
        return;
      }
      const delay = retryDelays[current.attempt];
      if (delay !== undefined) retryTimer = setTimeout(() => setConnection({ key: url, attempt: current.attempt + 1, connected: false, exhausted: false }), delay);
    };
    const displayFrame = () => {
      if (active && !failed) setConnection({ key: url, attempt: current.attempt, connected: true, exhausted: false, receivedAt });
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
      : <span className="video-connection-state" role="status">{current.exhausted ? "영상 연결 불가" : "영상 연결 중"}</span>}
    {current.connected && <VideoTimestamp capturedAt={capturedAt} receivedAt={current.receivedAt} />}
    {!current.connected && current.exhausted && <button className="video-retry" type="button" onClick={() => setConnection({ key: url, attempt: 0, connected: false, exhausted: false })}>영상 다시 연결</button>}
  </>;
}
