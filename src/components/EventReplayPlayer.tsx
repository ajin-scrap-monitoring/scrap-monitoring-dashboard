import { useCallback, useRef, useState } from "react";

import type { EventReplay } from "../domain/dashboard";
import { replayClock } from "../data/event-recordings";
import DailyRecordingVideo from "./DailyRecordingVideo";

type Position = { index: number; offset: number };

function locate(replay: EventReplay, seconds: number): Position {
  const last = replay.parts.length - 1;
  const clamped = Math.min(Math.max(0, seconds), replay.playbackSeconds);
  let index = replay.parts.findIndex((part) => clamped < part.relativeEndSeconds);
  if (index < 0) index = last;
  const part = replay.parts[index];
  return { index, offset: Math.min(part.endSeconds, part.startSeconds + (clamped - part.relativeStartSeconds)) };
}

export function EventReplayPlayer({ replay, label, initialSeconds = 0, onError, onPosition }: {
  replay: EventReplay;
  label: string;
  initialSeconds?: number;
  onError: () => void;
  onPosition: (seconds: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [position, setPosition] = useState(() => locate(replay, initialSeconds));
  const [revision, setRevision] = useState(0);
  const [relative, setRelative] = useState(Math.min(initialSeconds, replay.playbackSeconds));
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const part = replay.parts[position.index];

  const report = useCallback((seconds: number) => { setRelative(seconds); onPosition(seconds); }, [onPosition]);
  const seek = (seconds: number) => {
    const target = locate(replay, seconds);
    setEnded(false);
    report(Math.min(Math.max(0, seconds), replay.playbackSeconds));
    if (target.index === position.index) {
      if (videoRef.current && videoRef.current.readyState >= 1) videoRef.current.currentTime = target.offset;
    } else {
      setPosition(target);
      setRevision((value) => value + 1);
    }
  };
  const advance = () => {
    if (position.index + 1 < replay.parts.length) {
      const next = replay.parts[position.index + 1];
      setPosition({ index: position.index + 1, offset: next.startSeconds });
      setRevision((value) => value + 1);
      report(next.relativeStartSeconds);
    } else {
      videoRef.current?.pause();
      setPlaying(false);
      setEnded(true);
      report(replay.playbackSeconds);
    }
  };
  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (ended) { seek(0); setPlaying(true); return; }
    if (video.paused) { void video.play().catch(() => undefined); setPlaying(true); }
    else { video.pause(); setPlaying(false); }
  };

  return <div className="event-replay">
    <DailyRecordingVideo key={`${position.index}-${revision}`} videoRef={videoRef} path={part.playbackPath} label={label}
      initialTime={position.offset} controls={false} autoPlay={playing && !ended} onError={onError} onEnded={advance}
      onTimeUpdate={(seconds) => {
        if (seconds >= part.endSeconds) { advance(); return; }
        report(Math.min(replay.playbackSeconds, part.relativeStartSeconds + Math.max(0, seconds - part.startSeconds)));
      }} />
    <div className="recording-controls event-replay-controls">
      <button type="button" aria-label={playing && !ended ? "일시 정지" : "재생"} onClick={toggle}>{playing && !ended ? "||" : ">"}</button>
      <div className="event-replay-track">
        <input type="range" min={0} max={replay.playbackSeconds} step={1} value={Math.min(relative, replay.playbackSeconds)}
          aria-label="재생 위치" aria-valuetext={`${replayClock(relative)} / ${replayClock(replay.playbackSeconds)}`}
          onChange={(event) => seek(Number(event.currentTarget.value))} />
        {replay.parts.slice(1).map((next) => <i key={`${next.recordingId}-${next.relativeStartSeconds}`} className="event-replay-break" aria-hidden="true"
          style={{ left: `${(next.relativeStartSeconds / replay.playbackSeconds) * 100}%` }} />)}
      </div>
      <time>{replayClock(relative)} / {replayClock(replay.playbackSeconds)}</time>
    </div>
  </div>;
}

export default EventReplayPlayer;
