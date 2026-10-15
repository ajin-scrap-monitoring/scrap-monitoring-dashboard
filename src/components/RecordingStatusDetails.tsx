import { useEffect, useId, useRef, useState } from "react";

import type { Recording } from "../domain/dashboard";
import { recordingErrorCode, recordingStatus, recordingStatusReason } from "../recording-status";

export function RecordingStatusDetails({ recording, error, pending = false }: { recording: Recording; error?: string; pending?: boolean }) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<"closed" | "hover" | "pinned">("closed");
  const open = mode !== "closed";
  const exportFailed = recording.daily?.exportState === "failed" && !["failed", "expired", "deleted"].includes(recording.daily.status);
  const label = error ? "확인 실패" : pending ? "확인 중" : exportFailed ? "MP4 준비 실패" : recordingStatus(recording);
  const errorCode = recording.errorCode ?? recording.daily?.error?.code;
  const code = recordingErrorCode(errorCode);
  const failed = Boolean(error || exportFailed || recording.mediaStatus === "failed" || recording.mediaStatus === "blocked" || errorCode);
  const reason = error ?? (pending ? "최신 녹화 정보를 확인하고 있습니다." : recordingStatusReason(recording));
  const close = () => { setMode("closed"); trigger.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setMode("closed");
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMode("closed");
      if (root.current?.contains(document.activeElement)) trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return <div className="recording-status-details" ref={root}
    onMouseEnter={() => setMode(value => value === "closed" ? "hover" : value)}
    onMouseLeave={() => setMode(value => value === "hover" ? "closed" : value)}
    onBlur={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setMode("closed"); }}>
    <button ref={trigger} className={`recording-status-trigger ${failed ? "error" : recording.status === "available" ? "ok" : "muted"}`}
      type="button" aria-label={`${label} 상세`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setMode(value => value === "pinned" ? "closed" : "pinned")}>{label}</button>
    {open && <div className="recording-status-popover" id={id} role="dialog" aria-label="녹화 상태 상세">
      <div className="recording-status-popover-heading"><h3>녹화 상태 상세</h3><button type="button" aria-label="녹화 상태 상세 닫기" onClick={close}>닫기</button></div>
      <dl>
        <div><dt>상태</dt><dd>{label}</dd></div>
        <div><dt>{failed ? "실패 사유" : "안내"}</dt><dd role={failed ? "alert" : undefined}>{reason}</dd></div>
        {failed && <div><dt>오류 코드</dt><dd>{code ?? (errorCode ? "확인 불가" : "제공되지 않음")}</dd></div>}
        {recording.coverage && <div><dt>녹화 범위</dt><dd>{recording.coverage === "partial" ? "부분 저장" : recording.coverage === "complete" ? "전체 구간" : recording.coverage === "none" ? "영상 없음" : "확인 불가"}</dd></div>}
        {Boolean(recording.gaps?.length) && <div><dt>누락 구간</dt><dd>{recording.gaps?.length}개</dd></div>}
      </dl>
      {failed && <p>상세 처리 로그는 Backend와 Media Service 서버 로그에서 확인하세요.</p>}
    </div>}
  </div>;
}
