import { useEffect, useRef, useState } from "react";

import { createWhepPlayback, WHEP_RECONNECT_DELAYS, WhepResponseError, type WhepSession } from "./whep-client";

export function WhepVideo({
  alt,
  fallbackImage,
  mode,
  status,
  streamId,
}: {
  alt: string;
  fallbackImage: string;
  mode: "sample" | "webrtc";
  status: "available" | "delayed" | "unavailable";
  streamId: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const connectionKey = `${mode}:${status}:${streamId}`;
  const [connection, setConnection] = useState<{ attempt: number; key: string; status: "connecting" | "connected" | "error" }>({
    attempt: 0,
    key: connectionKey,
    status: "connecting",
  });
  const currentConnection = connection.key === connectionKey
    ? connection
    : { attempt: 0, key: connectionKey, status: "connecting" as const };

  useEffect(() => {
    if (mode !== "webrtc" || status === "unavailable" || !videoRef.current) return;
    let active = true;
    let session: WhepSession | null = null;
    let reconnectTimer: number | undefined;
    const controller = new AbortController();
    const connectionFailure = (error?: unknown) => {
      if (!active || reconnectTimer !== undefined) return;
      setConnection({ attempt: currentConnection.attempt, key: connectionKey, status: "error" });
      const fallbackDelay = WHEP_RECONNECT_DELAYS[currentConnection.attempt];
      if (fallbackDelay !== undefined) reconnectTimer = window.setTimeout(() => {
        setConnection({ attempt: currentConnection.attempt + 1, key: connectionKey, status: "connecting" });
      }, error instanceof WhepResponseError && error.retryAfterMilliseconds !== undefined ? error.retryAfterMilliseconds : fallbackDelay);
    };
    void createWhepPlayback({
      onConnected: () => {
        if (active) setConnection({ attempt: currentConnection.attempt, key: connectionKey, status: "connected" });
      },
      onConnectionFailure: connectionFailure,
      signal: controller.signal,
      streamId,
      video: videoRef.current,
    })
      .then((createdSession) => {
        if (!active) {
          createdSession.close();
          return;
        }
        session = createdSession;
      })
      .catch(connectionFailure);
    return () => {
      active = false;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      controller.abort();
      session?.close();
    };
  }, [connectionKey, currentConnection.attempt, mode, status, streamId]);

  if (mode === "sample") return <img src={fallbackImage} alt={alt} />;
  return (
    <>
      <video ref={videoRef} autoPlay muted playsInline aria-label={alt} />
      {status === "unavailable" && <span className="video-connection-state" role="status">영상 사용 불가</span>}
      {status !== "unavailable" && currentConnection.status === "connecting" && <span className="video-connection-state" role="status">영상 연결 중</span>}
      {status !== "unavailable" && currentConnection.status === "error" && currentConnection.attempt >= WHEP_RECONNECT_DELAYS.length && <button className="video-retry" type="button" onClick={() => setConnection({ attempt: 0, key: connectionKey, status: "connecting" })}>영상 다시 연결</button>}
    </>
  );
}
