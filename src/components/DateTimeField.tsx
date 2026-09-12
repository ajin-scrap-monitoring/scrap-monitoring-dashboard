import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

const pad = (value: number) => String(value).padStart(2, "0");
const dateText = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
function parseDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : new Date();
}

export function DateTimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => parseDate(value));
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const selected = parseDate(value);
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const days = Array.from({ length: 42 }, (_, index) => new Date(first.getFullYear(), first.getMonth(), index - first.getDay() + 1));

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target) && !popup.current?.contains(event.target)) setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close);
    };
  }, [open]);

  useEffect(() => {
    if (open) popup.current?.querySelector<HTMLButtonElement>(`[data-date="${dateText(cursor)}"]`)?.focus();
  }, [open, cursor]);

  const closeAndFocus = () => { setOpen(false); trigger.current?.focus(); };
  const changeTime = (part: "hour" | "minute", text: string) => {
    const number = Number(text);
    if (!Number.isFinite(number)) return;
    const hour = part === "hour" ? Math.min(23, Math.max(0, number)) : selected.getHours();
    const minute = part === "minute" ? Math.min(59, Math.max(0, number)) : selected.getMinutes();
    onChange(`${dateText(selected)}T${pad(hour)}:${pad(minute)}`);
  };

  return (
    <div className="date-time-field" ref={root}>
      <label htmlFor={id}>{label}</label>
      <div className="date-time-input">
        <input id={id} type="text" value={value.replace("T", " ")} placeholder="YYYY-MM-DD HH:mm" autoComplete="off" onChange={(event) => onChange(event.target.value.replace(" ", "T"))} onKeyDown={(event) => { if (event.altKey && event.key === "ArrowDown") { event.preventDefault(); trigger.current?.click(); } }} />
        <button ref={trigger} type="button" aria-label={`${label} 선택기 열기`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? `${id}-popup` : undefined} onClick={() => {
          if (open) { setOpen(false); return; }
          const rect = root.current!.getBoundingClientRect();
          setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 328)), top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 416)) });
          setCursor(parseDate(value));
          setOpen(true);
        }}><svg width="17" height="17" viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M3 8h14M7 2v4m6-4v4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></button>
      </div>
      {open && createPortal(
        <div ref={popup} id={`${id}-popup`} className="date-time-popup" role="dialog" aria-label={`${label} 선택`} style={position} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeAndFocus(); } }}>
          <div className="calendar-heading">
            <button type="button" aria-label="이전 달" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>&lt;</button>
            <strong aria-live="polite">{cursor.getFullYear()}년 {cursor.getMonth() + 1}월</strong>
            <button type="button" aria-label="다음 달" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>&gt;</button>
          </div>
          <div className="calendar-weekdays" aria-hidden="true">{["일", "월", "화", "수", "목", "금", "토"].map((day) => <span key={day}>{day}</span>)}</div>
          <div className="calendar-days" role="group" aria-label="날짜 선택">
            {days.map((date) => <button key={dateText(date)} type="button" data-date={dateText(date)} aria-label={dateText(date)} aria-pressed={dateText(date) === value.slice(0, 10)} tabIndex={dateText(date) === dateText(cursor) ? 0 : -1} className={date.getMonth() !== cursor.getMonth() ? "outside-month" : ""} onKeyDown={(event) => {
              const shifts: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -date.getDay(), End: 6 - date.getDay() };
              if (event.key in shifts) { event.preventDefault(); setCursor(new Date(date.getFullYear(), date.getMonth(), date.getDate() + shifts[event.key])); }
              if (event.key === "PageUp" || event.key === "PageDown") { event.preventDefault(); setCursor(new Date(date.getFullYear(), date.getMonth() + (event.key === "PageUp" ? -1 : 1), 1)); }
            }} onClick={() => { onChange(`${dateText(date)}T${pad(selected.getHours())}:${pad(selected.getMinutes())}`); setCursor(date); }}>{date.getDate()}</button>)}
          </div>
          <div className="calendar-time">
            <span>시간</span>
            <input aria-label="시" type="number" min="0" max="23" value={pad(selected.getHours())} onChange={(event) => changeTime("hour", event.target.value)} />
            <span>:</span>
            <input aria-label="분" type="number" min="0" max="59" value={pad(selected.getMinutes())} onChange={(event) => changeTime("minute", event.target.value)} />
            <span className="calendar-time-hint">24시간</span>
          </div>
          <button className="calendar-confirm" type="button" onClick={closeAndFocus}>선택 완료</button>
        </div>, document.body,
      )}
    </div>
  );
}
