export function VideoTimestamp({ capturedAt, receivedAt }: { capturedAt?: string | null; receivedAt?: string }) {
  const captured = new Date(capturedAt ?? "");
  const hasCapture = Number.isFinite(captured.getTime());
  const time = hasCapture ? captured : new Date(receivedAt ?? "");
  if (!Number.isFinite(time.getTime())) return null;
  const label = hasCapture ? "촬영" : "영상 수신";
  return <time className="live-time" dateTime={time.toISOString()} title={`${label} ${time.toString()}`}>{label} {time.toTimeString().slice(0, 8)}</time>;
}
