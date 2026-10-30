import { useEffect, useEffectEvent, type RefObject } from "react";
import type Hls from "hls.js";

import { dailyHlsRequest, validDailyPlaylistPath } from "./daily-hls-request";
import { loadDailyHls } from "./daily-hls-player";

export function DailyRecordingVideo({ videoRef, path, label, poster, initialTime = 0, controls = true, autoPlay = false, onEnded, onError, onTimeUpdate }: {
  videoRef: RefObject<HTMLVideoElement | null>;
  path: string;
  label: string;
  poster?: string;
  initialTime?: number;
  controls?: boolean;
  autoPlay?: boolean;
  onEnded?: () => void;
  onError: () => void;
  onTimeUpdate: (seconds: number) => void;
}) {
  const reportError = useEffectEvent(onError);
  const initialPosition = useEffectEvent(() => Number.isFinite(initialTime) && initialTime >= 0 ? initialTime : 0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let active = true;
    let failed = false;
    let initialTimeApplied = false;
    let player: Hls | undefined;
    const initializePosition = () => {
      if (!active || failed || initialTimeApplied) return;
      initialTimeApplied = true;
      video.currentTime = initialPosition();
    };
    const release = () => {
      player?.destroy();
      player = undefined;
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
    const fail = () => {
      if (!active || failed) return;
      failed = true;
      release();
      reportError();
    };
    video.addEventListener("error", fail);
    if (!validDailyPlaylistPath(path)) {
      fail();
    } else {
      void loadDailyHls().then(({ default: HlsPlayer, FetchLoader }) => {
        if (!active || failed) return;
        if (!HlsPlayer.isSupported()) {
          if (video.canPlayType("application/vnd.apple.mpegurl")) {
            video.addEventListener("loadedmetadata", initializePosition);
            video.src = path;
          }
          else fail();
          return;
        }
        const retry = { maxNumRetry: 1, retryDelayMs: 1000, maxRetryDelayMs: 1000 };
        const policy = { default: { maxTimeToFirstByteMs: 10_000, maxLoadTimeMs: 20_000, timeoutRetry: retry, errorRetry: retry } };
        player = new HlsPlayer({
          enableWorker: false,
          startPosition: initialPosition(),
          loader: FetchLoader,
          fetchSetup: (context, init) => dailyHlsRequest(path, context.url, init as RequestInit, window.location.origin),
          manifestLoadPolicy: policy,
          playlistLoadPolicy: policy,
          fragLoadPolicy: policy,
          keyLoadPolicy: policy,
        });
        player.on(HlsPlayer.Events.ERROR, (_event, data) => {
          if (data.fatal) fail();
        });
        player.loadSource(new URL(path, window.location.origin).href);
        player.attachMedia(video);
      }).catch(fail);
    }
    return () => {
      active = false;
      video.removeEventListener("error", fail);
      video.removeEventListener("loadedmetadata", initializePosition);
      release();
    };
  }, [path, videoRef]);

  return <video ref={videoRef} className="recording-daily-video" controls={controls} autoPlay={autoPlay} playsInline preload="metadata" poster={poster} aria-label={label}
    onEnded={onEnded}
    onTimeUpdate={event => onTimeUpdate(event.currentTarget.currentTime)} />;
}

export default DailyRecordingVideo;
