import { useCallback, useState, type FormEvent } from "react";

import { applicationVersion } from "./application-version";
import cameraFrame from "./assets/camera-frame.png";
import { ApplicationFooter, DashboardHeader, DashboardPageShell } from "./components/DashboardShell";
import { DashboardStatePage } from "./components/DashboardStatePage";
import { useDashboardData } from "./data/use-dashboard-data";
import type { DashboardDataSource } from "./data/dashboard-data-source";
import type { DashboardData, HeaderNotification, LidarProfile, RecipientSettings } from "./domain/dashboard";
import { useModalFocus } from "./use-modal-focus";
import "./App.css";

const alertsPerPage = 4;
function SectionTitle({ children }: { children: string }) {
  return <h2 className="section-title">{children}</h2>;
}

function DashboardStatusLabel({ status }: { status: DashboardData["monitoring"]["status"] }) {
  const labels = {
    normal: "정상",
    "collection-required": "수거 필요",
    "measurement-error": "측정 오류",
    disconnected: "연결 끊김",
    "no-data": "데이터 없음",
  };
  const tone = status === "normal" ? "ok" : status === "collection-required" ? "warning" : "error";
  return <span className={`status-text ${tone}`}>{labels[status]}</span>;
}

function UserIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="7" r="4" />
      <path d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg className="expand-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M21 16v5h-5" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg className="login-field-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" />
    </svg>
  );
}

function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [rememberLogin, setRememberLogin] = useState(false);

  return (
    <main className="login-page" aria-label="관리자 로그인">
      <section className="login-intro">
        <div className="login-brand" aria-label="AJIN SCRAP MONITORING"><span className="brand-mark" aria-hidden="true" /><span>AJIN SCRAP MONITORING</span></div>
        <div className="login-intro-copy">
          <span className="login-overline">AJIN INDUSTRIAL</span>
          <h1>스크랩 모니터링<br />관리자 시스템</h1>
        </div>
        <div className="login-intro-status">
          <span>Copyright 2026 AJIN INDUSTRIAL. All rights reserved.</span>
          <span>Version {applicationVersion}</span>
        </div>
      </section>
      <section className="login-form-area">
        <div className="login-form-wrap">
          <div className="login-form-heading">
            <span className="login-form-kicker">ADMINISTRATOR</span>
            <h2>로그인</h2>
            <p>관리자 계정 정보를 입력하세요.</p>
          </div>
          <form className="login-form" onSubmit={(event) => { event.preventDefault(); window.sessionStorage.setItem("scrap-monitoring-authenticated", "true"); window.location.assign("/"); }}>
            <label htmlFor="login-id">아이디</label>
            <div className="login-field">
              <UserIcon />
              <input id="login-id" name="id" autoComplete="username" placeholder="관리자 아이디" />
            </div>
            <label htmlFor="login-password">비밀번호</label>
            <div className="login-field">
              <LockIcon />
              <input id="login-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="비밀번호" />
              <button type="button" className="password-visibility" onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? "숨기기" : "표시"}</button>
            </div>
            <label className="remember-login"><input type="checkbox" checked={rememberLogin} onChange={(event) => setRememberLogin(event.target.checked)} /><span>로그인 상태 유지</span></label>
            <button className="login-submit" type="submit">로그인</button>
          </form>
          <p className="login-help">계정 또는 접근 권한 문의는 시스템 관리자에게 요청하세요.</p>
          <a className="login-dashboard-link" href="/">현황 보기</a>
        </div>
      </section>
    </main>
  );
}

function MeasurementDiagram({ lidar1Color, lidar2Color }: { lidar1Color: string; lidar2Color: string }) {
  return (
    <svg className="measurement-svg" viewBox="0 0 440 275" role="img" aria-label="LiDAR 1과 LiDAR 2 측정선 배치">
      <defs>
        <clipPath id="scrapSurface">
          <path d="M52 181 218 236 332 105 281 84 186 146 104 117Z" />
        </clipPath>
        <pattern id="scrapFrontFill" width="18" height="14" patternUnits="userSpaceOnUse">
          <rect width="18" height="14" fill="#87949e" />
          <path d="M1 4l7 2m3-4 5 3M4 11l6-2m3 3 4-2" stroke="#b9c2c8" strokeWidth="2" />
          <path d="M0 8l4 1m6-2 5 2" stroke="#667783" strokeWidth="1.5" />
        </pattern>
        <pattern id="scrapSideFill" width="16" height="14" patternUnits="userSpaceOnUse">
          <rect width="16" height="14" fill="#73828d" />
          <path d="M1 3l6 3m3-4 5 2M3 11l5-3m3 4 4-3" stroke="#aeb9c0" strokeWidth="1.8" />
          <path d="M0 7l4 2m5-2 5 3" stroke="#596b78" strokeWidth="1.4" />
        </pattern>
      </defs>
      <path d="M45 158 221 214 221 258 45 202Z" fill="#d6e1e8" stroke="#40586b" strokeWidth="2" />
      <path d="M221 214 338 82 338 126 221 258Z" fill="#c7d6df" stroke="#40586b" strokeWidth="2" />
      <path d="M338 82 281 64 281 108 338 126Z" fill="#d5e1e7" stroke="#40586b" strokeWidth="2" />
      <path d="M281 64 184 123 184 167 281 108Z" fill="#e0e8ed" stroke="#40586b" strokeWidth="2" />
      <path d="M184 123 100 96 100 140 184 167Z" fill="#cfdae2" stroke="#40586b" strokeWidth="2" />
      <path d="M100 96 45 158 45 202 100 140Z" fill="#e4ebef" stroke="#40586b" strokeWidth="2" />
      <path d="M52 181 218 236 221 258 45 202Z" fill="url(#scrapFrontFill)" stroke="#667783" strokeWidth="1.2" />
      <path d="M218 236 332 105 338 126 221 258Z" fill="url(#scrapSideFill)" stroke="#596b78" strokeWidth="1.2" />

      <g clipPath="url(#scrapSurface)" stroke="#758390" strokeWidth="0.9">
        <path d="M52 181 218 236 332 105 281 84 186 146 104 117Z" fill="#8e9ba6" />
        <path d="M52 181 104 117 126 162Z" fill="#9ca7b0" />
        <path d="M104 117 186 146 126 162Z" fill="#84929e" />
        <path d="M186 146 181 190 126 162Z" fill="#a6afb7" />
        <path d="M52 181 126 162 181 190Z" fill="#778691" />
        <path d="M52 181 181 190 218 236Z" fill="#929ea8" />
        <path d="M218 236 181 190 238 195Z" fill="#6f7f8c" />
        <path d="M181 190 186 146 222 160Z" fill="#8996a1" />
        <path d="M181 190 222 160 238 195Z" fill="#aab2b9" />
        <path d="M238 195 222 160 286 137Z" fill="#7d8b97" />
        <path d="M238 195 286 137 332 105Z" fill="#9da8b1" />
        <path d="M222 160 247 116 286 137Z" fill="#adb5bc" />
        <path d="M186 146 247 116 222 160Z" fill="#74838f" />
        <path d="M186 146 281 84 247 116Z" fill="#97a3ad" />
        <path d="M281 84 332 105 247 116Z" fill="#7b8995" />
        <path d="M247 116 332 105 286 137Z" fill="#8c99a4" />
      </g>

      <path d="M45 158 221 214 338 82 281 64 184 123 100 96Z" fill="none" stroke="#30485b" strokeWidth="3" />
      <path d="M45 202 221 258 338 126 281 108 184 167 100 140Z" fill="none" stroke="#647789" strokeWidth="1.4" />
      <path d="M45 158v44M221 214v44M338 82v44M281 64v44M184 123v44M100 96v44" stroke="#40586b" strokeWidth="2" />
      <polygon points="122,103 91,153 126,151 158,164 187,171 213,186 240,193 262,207 122,103" fill="#1677e8" fillOpacity="0.4" stroke="none" />
      <polygon points="254,80 270,109 270,131 259,150 248,169 235,191 220,218 254,80" fill="#0ba58f" fillOpacity="0.44" stroke="none" />
      <g>
        <polyline points="91,153 126,151 158,164 187,171 213,186 240,193 262,207" fill="none" stroke="#ffffff" strokeWidth="7" />
        <polyline points="91,153 126,151 158,164 187,171 213,186 240,193 262,207" fill="none" stroke="#1677e8" strokeWidth="4" />
        <polyline points="270,109 270,131 259,150 248,169 235,191 220,218" fill="none" stroke="#ffffff" strokeWidth="7" />
        <polyline points="270,109 270,131 259,150 248,169 235,191 220,218" fill="none" stroke="#0ba58f" strokeWidth="4" />
      </g>

      <path d="M158 95 202 109 270 32 226 18Z" fill="#3f5261" stroke="#304555" strokeWidth="2.5" />
      <path d="m165 87 44 14m-36-23 44 14m-36-23 44 14m-36-23 44 14m-36-23 44 14m-36-23 44 14" stroke="#9caab4" strokeWidth="4" />
      <path d="M158 95 202 109 187 126 143 112Z" fill="#f3e6d4" stroke="#c47a25" strokeWidth="2" />
      <path d="M143 112 187 126 175 145 131 131Z" fill="#edcfaa" stroke="#c47a25" strokeWidth="2" />
      <path d="M143 112 187 126" stroke="#a75f17" strokeWidth="2.4" />

      <g transform="translate(91 153)">
        <circle r="8" fill="#ffffff" stroke={lidar1Color} strokeWidth="2.2" />
        <text x="0" y="4" fill={lidar1Color} fontSize="10" fontWeight="700" textAnchor="middle">A</text>
      </g>
      <g transform="translate(262 207)">
        <circle r="8" fill="#ffffff" stroke={lidar1Color} strokeWidth="2.2" />
        <text x="0" y="4" fill={lidar1Color} fontSize="10" fontWeight="700" textAnchor="middle">B</text>
      </g>
      <g transform="translate(270 109)">
        <circle r="8" fill="#ffffff" stroke={lidar2Color} strokeWidth="2.2" />
        <text x="0" y="4" fill={lidar2Color} fontSize="10" fontWeight="700" textAnchor="middle">B</text>
      </g>
      <g transform="translate(220 218)">
        <circle r="8" fill="#ffffff" stroke={lidar2Color} strokeWidth="2.2" />
        <text x="0" y="4" fill={lidar2Color} fontSize="10" fontWeight="700" textAnchor="middle">A</text>
      </g>
      <circle cx="122" cy="103" r="7" fill="#ffffff" stroke="#40586b" strokeWidth="2" />
      <text x="58" y="82" fill="#1677e8" fontSize="15" fontWeight="700">LiDAR 1</text>
      <circle cx="254" cy="80" r="7" fill="#ffffff" stroke="#40586b" strokeWidth="2" />
      <text x="296" y="65" fill="#087c6c" fontSize="15" fontWeight="700">LiDAR 2</text>
      <path d="M288 229h24" stroke="#1677e8" strokeWidth="4" />
      <text x="319" y="233" fill="#52657a" fontSize="11">LiDAR 1 표면 측정선</text>
      <path d="M288 250h24" stroke="#0ba58f" strokeWidth="4" />
      <text x="319" y="254" fill="#52657a" fontSize="11">LiDAR 2 표면 측정선</text>
    </svg>
  );
}

function LoadChart({ samples, threshold }: { samples: DashboardData["monitoring"]["loadHistory"]; threshold: number }) {
  const xValues = samples.map((_, index) => 40 + index * (370 / (samples.length - 1)));
  const yMin = 0;
  const yMax = 100;
  const yTickValues = [100, 80, 60, 40, 20, 0];
  const chartTop = 20;
  const chartBottom = 148;
  const toY = (value: number) => chartBottom - (value - yMin) * ((chartBottom - chartTop) / (yMax - yMin));
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const pointY = samples.map((sample) => toY(sample.value));
  const xTickIndices = [0, 3, 6, 9, 12, 15, 18, 21, 23];
  const xTickPositions = xTickIndices.map((index) => xValues[index]);
  const xTickLabels = xTickIndices.map((index) => samples[index].time);

  const activeX = activeIndex === null ? 0 : xValues[activeIndex];
  const activeY = activeIndex === null ? 0 : pointY[activeIndex];
  const tooltipX = Math.max(24, Math.min(activeX - 42, 364));
  const tooltipY = Math.max(4, activeY - 42);

  return (
    <svg className="chart-svg" viewBox="0 0 430 175" preserveAspectRatio="none" role="img" aria-label="최근 24시간 대표 적재율 그래프">
      <g stroke="#e2e8ef" strokeWidth="1">
        {yTickValues.map((value) => (
          <path key={`grid-h-${value}`} d={`M40 ${toY(value).toFixed(1)}H410`} />
        ))}
        {xTickPositions.map((x) => (
          <path key={`grid-v-${x}`} d={`M${x} ${chartTop}V${chartBottom}`} />
        ))}
      </g>
      <g fill="#61708a" fontSize="10">
        {yTickValues.map((tick) => (
          <g key={`y-${tick}`}>
            <text x="30" y={toY(tick).toFixed(1)} textAnchor="end" dominantBaseline="middle">
              {tick}%
            </text>
          </g>
        ))}
      </g>
      <path d={`M40 ${toY(threshold)}H410`} stroke="#607086" strokeDasharray="5 5" strokeOpacity="0.58" strokeWidth="1.5" />
      <text x="408" y="39" transform="translate(408 0) scale(0.69 1) translate(-408 0)" fill="#526278" fontSize="10" fontWeight="600" textAnchor="end">수거 임계율 {threshold}%</text>
      <path d={`M${xValues[0]} ${pointY[0]} ${xValues.slice(1).map((x, index) => `L${x} ${pointY[index + 1]}`).join(" ")} V${chartBottom} H${xValues[0]} Z`} fill="#f58a07" fillOpacity="0.1" />
      <polyline points={`${xValues.map((x, index) => `${x},${pointY[index]}`).join(" ")}`} fill="none" stroke="#f58a07" strokeWidth="4" />
      <g fill="#f58a07">
        {xValues.map((cx, index) => <circle key={cx} cx={cx} cy={pointY[index]} r="4" />)}
      </g>
      {xValues.map((cx, index) => (
        <circle
          key={`target-${cx}`}
          className="chart-point-target"
          cx={cx}
          cy={pointY[index]}
          r="11"
          tabIndex={0}
          aria-label={`${samples[index].time} 대표 적재율 ${samples[index].value}%`}
          onPointerEnter={() => setActiveIndex(index)}
          onPointerLeave={() => setActiveIndex(null)}
          onFocus={() => setActiveIndex(index)}
          onBlur={() => setActiveIndex(null)}
        />
      ))}
      {activeIndex !== null && (
        <g className="chart-tooltip" transform={`translate(${tooltipX} ${tooltipY})`} pointerEvents="none">
          <rect width="84" height="34" rx="4" />
          <text x="8" y="14">{samples[activeIndex].time}</text>
          <text x="8" y="27">대표 적재율 {samples[activeIndex].value}%</text>
        </g>
      )}
      <g fill="#61708a" fontSize="11">
        {xTickPositions.map((x, idx) => (
          <text key={`x-${x}`} x={x} y="166" textAnchor="middle">
            {xTickLabels[idx]}
          </text>
        ))}
      </g>
    </svg>
  );
}

function ProfileChart({ average, color, label, maximum, minimum, values }: LidarProfile) {
  const stroke = color === "blue" ? "#1677e8" : "#0ba58f";
  const axisTextColor = color === "blue" ? "#0b3f8d" : "#066f5e";
  const yMin = 0;
  const yMax = 10;
  const yStep = 2;
  const chart = { left: 40, right: 410, top: 20, bottom: 148 };
  const gridYValues = Array.from({ length: yMax / yStep + 1 }, (_, index) => index * yStep);
  const gridXValues = [
    { index: 0, value: "A" },
    { index: values.length - 1, value: "B" },
  ];
  const toY = (value: number) => chart.bottom - (value - yMin) * ((chart.bottom - chart.top) / (yMax - yMin));
  const toX = (index: number) => chart.left + ((chart.right - chart.left) / (values.length - 1)) * index;
  const profilePath = values.map((value, index) => `${index === 0 ? "M" : "L"}${toX(index)} ${toY(value)}`).join(" ");
  const fillPath = `${profilePath}V${chart.bottom}H${chart.left}Z`;

  return (
    <section className="card chart-card span-4">
      <div className="chart-title-row">
        <SectionTitle>{label}</SectionTitle>
        <div className={`profile-stat ${color}`}>
          <span className="average"><span className="average-label">평균</span>{average}</span>
          <span className="range">최소 {minimum} / 최대 {maximum}</span>
        </div>
      </div>
      <svg className="chart-svg" viewBox="0 0 430 175" preserveAspectRatio="none" role="img" aria-label={label}>
        <g stroke="#e2e8ef" strokeWidth="1">
          {gridYValues.map((value) => (
            <path key={`grid-h-${value}`} d={`M${chart.left} ${toY(value).toFixed(1)}H${chart.right}`} />
          ))}
          <path d={`M${chart.left} ${chart.top}V${chart.bottom}M${chart.left + (chart.right - chart.left) / 2} ${chart.top}V${chart.bottom}M${chart.right} ${chart.top}V${chart.bottom}`} />
        </g>
        <g fill="#61708a" fontSize="10">
          {gridYValues.map((value) => (
            <g key={`profile-y-${value}`}>
              <text x="30" y={toY(value).toFixed(1)} textAnchor="end" dominantBaseline="middle">
                {value}m
              </text>
            </g>
          ))}
          {gridXValues.map((tick) => (
            <text
              key={`profile-x-${tick.value}`}
              x={toX(tick.index).toFixed(1)}
              y="166"
              fill={axisTextColor}
              textAnchor="middle"
              fontSize="12"
              fontWeight="700"
            >
              {tick.value}
            </text>
          ))}
        </g>
        <path d={fillPath} fill={stroke} fillOpacity="0.08" />
        <path d={profilePath} fill="none" stroke={stroke} strokeWidth="4" />
      </svg>
    </section>
  );
}

const historyEventsPerPage = 8;

function HistoryLoadChart({ chartEvents, loadSamples: samples }: DashboardData["history"]) {
  const [activeEvent, setActiveEvent] = useState<number | null>(null);
  const left = 58;
  const right = 1900;
  const top = 62;
  const bottom = 192;
  const toX = (hour: number) => left + (right - left) * (hour / 168);
  const toY = (value: number) => bottom - value * ((bottom - top) / 100);
  const path = samples.map((sample, index) => `${index === 0 ? "M" : "L"}${toX(sample.hour)} ${toY(sample.value)}`).join(" ");
  const fillPath = `${path}V${bottom}H${left}Z`;
  const eventAnnotations = chartEvents.map((event) => {
    const sample = samples.find((item) => item.hour === event.hour);
    if (!sample) return null;
    const x = toX(sample.hour);
    const direction = x > right - 120 ? -1 : event.label === "수거 필요" ? -1 : 1;
    const row = event.label === "수거 필요" ? 0 : event.label === "수거 완료" ? 1 : 2;
    const elbowY = top - 8;
    const labelY = 17 + row * 17;
    const labelX = x + direction * 38;
    return { ...event, direction, elbowY, labelX, labelY, sample, x };
  }).filter((event): event is NonNullable<typeof event> => event !== null);
  const selectedEvent = activeEvent === null ? null : eventAnnotations[activeEvent];
  const selectedSample = selectedEvent?.sample ?? null;
  const tooltipX = selectedSample === null ? 0 : Math.max(left + 8, Math.min(toX(selectedSample.hour) - 96, right - 200));
  const tooltipY = selectedSample === null ? 0 : 132;
  return (
    <svg className="history-chart" viewBox="0 0 1960 230" role="img" aria-label="최근 1주일 대표 적재율 변화 그래프">
      <g stroke="#e2e8ef" strokeWidth="1">
        {[0, 20, 40, 60, 80, 100].map((value) => <path key={value} d={`M${left} ${toY(value)}H${right}`} />)}
      </g>
      <g fill="#61708a" fontSize="12">
        {[100, 80, 60, 40, 20, 0].map((value) => <text key={value} x="48" y={toY(value)} textAnchor="end" dominantBaseline="middle">{value}%</text>)}
        {Array.from({ length: 7 }, (_, day) => <text key={day} x={toX(day * 24)} y="218" textAnchor={day === 0 ? "start" : "middle"}>09.{String(day + 3).padStart(2, "0")}</text>)}
      </g>
      <path d={`M${left} ${toY(80)}H${right}`} stroke="#607086" strokeDasharray="6 6" strokeWidth="1.5" />
      <path d={fillPath} fill="#f58a07" fillOpacity="0.1" />
      <path d={path} fill="none" stroke="#f58a07" strokeWidth="4" />
      <g stroke="#8b9aad" strokeWidth="1.2">
        {Array.from({ length: 7 }, (_, day) => <path key={day} d={`M${toX(day * 24)} ${bottom}V${bottom + 6}`} />)}
      </g>
      <g className="history-event-annotations">
        {eventAnnotations.map((event, index) => {
          const targetLeft = event.direction === -1 ? event.labelX - 78 : event.labelX - 4;
          const targetWidth = 82;
          return (
            <g key={`${event.label}-${event.time}`}>
              <path d={`M${event.x} ${toY(event.sample.value)}V${event.elbowY}L${event.labelX} ${event.labelY + 4}`} fill="none" stroke={event.color} strokeOpacity="0.72" strokeWidth="1.5" />
              <text x={event.labelX + event.direction * 5} y={event.labelY} fill={event.color} fontSize="11" fontWeight="700" textAnchor={event.direction === -1 ? "end" : "start"}>{event.label}</text>
              <rect
                className="history-event-target"
                x={targetLeft}
                y={event.labelY - 14}
                width={targetWidth}
                height="20"
                fill="transparent"
                tabIndex={0}
                aria-label={`${event.time} ${event.label} ${event.detail}`}
                onPointerEnter={() => setActiveEvent(index)}
                onPointerLeave={() => setActiveEvent(null)}
                onFocus={() => setActiveEvent(index)}
                onBlur={() => setActiveEvent(null)}
              />
            </g>
          );
        })}
      </g>
      {selectedEvent !== null && (
        <g className="history-chart-tooltip" transform={`translate(${tooltipX} ${tooltipY})`} pointerEvents="none">
          <rect width="200" height="48" rx="5" />
          <text x="10" y="18">{selectedEvent.time} {selectedEvent.label}</text>
          <text x="10" y="36">{selectedEvent.detail}</text>
        </g>
      )}
    </svg>
  );
}

const recordingsPerPage = 6;

function RecordingsPage({ recordings, headerNotifications, status }: { recordings: DashboardData["recordings"]; headerNotifications: HeaderNotification[]; status: DashboardData["monitoring"]["status"] }) {
  const [recordType, setRecordType] = useState("전체");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [recordingOpen, setRecordingOpen] = useState(false);
  const [recordingPage, setRecordingPage] = useState(0);
  const [downloadState, setDownloadState] = useState<"idle" | "processing" | "complete">("idle");
  const closeRecording = useCallback(() => setRecordingOpen(false), []);
  const recordingModalRef = useModalFocus<HTMLDivElement>(recordingOpen, closeRecording);
  const visibleRecordings = recordType === "전체" ? recordings : recordings.filter((recording) => recording.type === recordType);
  const totalRecordingPages = Math.max(1, Math.ceil(visibleRecordings.length / recordingsPerPage));
  const pageStart = recordingPage * recordingsPerPage;
  const pagedRecordings = visibleRecordings.slice(pageStart, pageStart + recordingsPerPage);
  const selectedRecording = visibleRecordings[selectedIndex] ?? visibleRecordings[0];
  const requestDownload = () => {
    setDownloadState("processing");
    window.setTimeout(() => setDownloadState("complete"), 400);
  };

  return (
    <DashboardPageShell activePage="recordings" headerNotifications={headerNotifications}>
      <main className="recordings-page" aria-label="스크랩 모니터링 녹화 영상">
        <div className="page-heading"><h1>녹화 영상</h1><div className="page-meta"><DashboardStatusLabel status={status} /><span className="meta-divider" aria-hidden="true" /><span>마지막 측정 10:24:18</span></div></div>
        <div className="recordings-content">
          <section className="card recordings-query"><SectionTitle>검색 조건</SectionTitle><div className="recordings-query-controls"><label>시작 시각<input type="datetime-local" defaultValue="2026-09-02T00:00" /></label><label>종료 시각<input type="datetime-local" defaultValue="2026-09-09T23:59" /></label><div className="query-type"><span>녹화 유형</span><div>{["전체", "수거", "알림", "오류"].map((type) => <button key={type} className={recordType === type ? "selected" : ""} type="button" onClick={() => { setRecordType(type); setSelectedIndex(0); setRecordingPage(0); }}>{type}</button>)}</div></div><button className="primary-button" type="button">조회</button></div></section>
          <div className="recordings-main">
            <section className="card recordings-list"><div className="recordings-card-head"><SectionTitle>녹화 목록</SectionTitle><span>{visibleRecordings.length}건</span></div><div className="recordings-list-items">{pagedRecordings.map((recording, index) => <button key={recording.date} className={`recording-item ${selectedRecording.date === recording.date ? "selected" : ""}`} type="button" onClick={() => { setSelectedIndex(pageStart + index); setIsPlaying(false); }}><img src={cameraFrame} alt="" /><span className="recording-item-main"><strong>{recording.date}</strong><span>{recording.time}</span><span className="status-text ok">정상</span></span><span className="recording-item-side"><span className={`recording-type ${recording.tone}`}>{recording.type}</span><span>{recording.duration}</span></span></button>)}</div><div className="recordings-pagination"><button type="button" aria-label="이전 녹화 목록 페이지" disabled={recordingPage === 0} onClick={() => { const page = recordingPage - 1; setRecordingPage(page); setSelectedIndex(page * recordingsPerPage); }}>&lt;</button><span>{recordingPage + 1} / {totalRecordingPages}</span><button type="button" aria-label="다음 녹화 목록 페이지" disabled={recordingPage === totalRecordingPages - 1} onClick={() => { const page = recordingPage + 1; setRecordingPage(page); setSelectedIndex(page * recordingsPerPage); }}>&gt;</button></div></section>
            <section className="card recording-player"><SectionTitle>녹화 영상</SectionTitle><div className="recording-player-center"><div className="recording-stage"><div className="recording-frame"><img src={cameraFrame} alt={`${selectedRecording.date} 녹화 영상`} /><span className="recorded-time">{selectedRecording.date} 00:12:36</span><button className="recording-expand" type="button" aria-label="녹화 영상 크게 보기" onClick={() => setRecordingOpen(true)}><ExpandIcon /></button></div></div><div className="recording-controls"><button type="button" aria-label={isPlaying ? "일시 정지" : "재생"} onClick={() => setIsPlaying((playing) => !playing)}>{isPlaying ? "||" : ">"}</button><div className="recording-timeline" aria-label="재생 위치"><span /></div><time>00:12:36</time></div></div></section>
            <aside className="recordings-side"><section className="card recording-info"><SectionTitle>녹화 정보</SectionTitle><dl><div><dt>시작 시각</dt><dd>{selectedRecording.date} 00:00:00</dd></div><div><dt>종료 시각</dt><dd>{selectedRecording.end}</dd></div><div><dt>기간</dt><dd>{selectedRecording.duration}</dd></div><div><dt>발생 유형</dt><dd><span className={`recording-type ${selectedRecording.tone}`}>{selectedRecording.type}</span></dd></div><div><dt>파일 형식</dt><dd>MP4</dd></div><div><dt>비디오 코덱</dt><dd>H.264</dd></div><div><dt>해상도</dt><dd>640 x 480</dd></div><div><dt>화면 비율</dt><dd>4:3</dd></div><div><dt>프레임 속도</dt><dd>30 fps</dd></div><div><dt>파일 용량</dt><dd>1.8 GB</dd></div><div><dt>재생 상태</dt><dd><span className="status-text ok">정상</span></dd></div></dl></section><section className="card recording-download"><SectionTitle>녹화 파일</SectionTitle><p>선택한 녹화 영상의 다운로드 요청을 확인합니다.</p><button type="button" disabled={downloadState === "processing"} onClick={requestDownload}>{downloadState === "processing" ? "다운로드 요청 확인 중" : "녹화 영상 다운로드"}</button>{downloadState === "complete" && <p role="status">다운로드는 서버 연동 후 시작됩니다.</p>}</section></aside>
          </div>
        </div>
      </main>
      {recordingOpen && <div ref={recordingModalRef} className="video-modal" role="dialog" aria-modal="true" aria-label="녹화 영상 크게 보기" onClick={closeRecording}><div className="video-modal-panel" onClick={(event) => event.stopPropagation()}><button className="video-modal-close" type="button" aria-label="녹화 영상 닫기" onClick={closeRecording}>닫기</button><div className="video-modal-frame"><img src={cameraFrame} alt={`${selectedRecording.date} 녹화 영상 확대`} /><span className="recorded-time">{selectedRecording.date} 00:12:36</span></div></div></div>}
    </DashboardPageShell>
  );
}

const recipientsPerPage = 10;
function AdminPage({ admin, headerNotifications }: { admin: DashboardData["admin"]; headerNotifications: HeaderNotification[] }) {
  const [recipients, setRecipients] = useState(admin.recipients);
  const [threshold, setThreshold] = useState("85");
  const [currentThreshold, setCurrentThreshold] = useState("80");
  const [preAlertThreshold, setPreAlertThreshold] = useState("70");
  const [preAlertEnabled, setPreAlertEnabled] = useState(true);
  const [savedPreAlertThreshold, setSavedPreAlertThreshold] = useState("70");
  const [savedPreAlertEnabled, setSavedPreAlertEnabled] = useState(true);
  const [policyEvents, setPolicyEvents] = useState({ collection: true, device: true, error: true });
  const [recoveryNotice, setRecoveryNotice] = useState(true);
  const [testChannels, setTestChannels] = useState({ email: true, sms: true });
  const [testAlertState, setTestAlertState] = useState<"idle" | "processing" | "complete" | "invalid">("idle");
  const [recipientPage, setRecipientPage] = useState(0);
  const [recipientSettings, setRecipientSettings] = useState(admin.recipientSettings);
  const [selectedRecipientEmail, setSelectedRecipientEmail] = useState<string | null>(null);
  const [addRecipientOpen, setAddRecipientOpen] = useState(false);
  const [addRecipientError, setAddRecipientError] = useState("");
  const [newRecipient, setNewRecipient] = useState({ name: "", team: "", email: "", phone: "", emailChannel: true, smsChannel: false, enabled: true, useGlobal: true, collection: true, error: true, device: true });
  const recipientPages = Math.ceil(recipients.length / recipientsPerPage);
  const visibleRecipients = recipients.slice(recipientPage * recipientsPerPage, (recipientPage + 1) * recipientsPerPage);
  const selectedRecipient = recipients.find((recipient) => recipient.email === selectedRecipientEmail);
  const selectedRecipientSettings = selectedRecipientEmail ? recipientSettings[selectedRecipientEmail] : undefined;
  const requestTestAlert = () => {
    if (!testChannels.email && !testChannels.sms) {
      setTestAlertState("invalid");
      return;
    }
    setTestAlertState("processing");
    window.setTimeout(() => setTestAlertState("complete"), 400);
  };

  const togglePolicyEvent = (key: keyof typeof policyEvents) => {
    setPolicyEvents((events) => ({ ...events, [key]: !events[key] }));
  };

  const updateRecipientSetting = (key: keyof RecipientSettings, value: boolean) => {
    if (!selectedRecipientEmail) return;
    setRecipientSettings((settings) => ({ ...settings, [selectedRecipientEmail]: { ...settings[selectedRecipientEmail], [key]: value } }));
  };

  const recipientEventSummary = (settings: RecipientSettings) => {
    if (settings.useGlobal) return "공통 정책";
    const events = [settings.collection ? "수거" : "", settings.error ? "오류" : "", settings.device ? "장비" : ""].filter(Boolean);
    return events.length ? events.join(", ") : "수신 안 함";
  };

  const closeRecipientPanel = useCallback(() => setSelectedRecipientEmail(null), []);
  const closeAddRecipient = useCallback(() => {
    setAddRecipientOpen(false);
    setAddRecipientError("");
  }, []);
  useModalFocus<HTMLElement>(selectedRecipient !== undefined && selectedRecipientSettings !== undefined, closeRecipientPanel, ".recipient-panel");
  useModalFocus<HTMLElement>(addRecipientOpen, closeAddRecipient, ".recipient-add-modal");

  const addRecipient = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newRecipient.name.trim() || !newRecipient.team.trim() || !newRecipient.email.trim()) {
      setAddRecipientError("이름, 소속, 이메일을 입력하세요.");
      return;
    }
    if (recipients.some((recipient) => recipient.email === newRecipient.email.trim())) {
      setAddRecipientError("이미 등록된 이메일입니다.");
      return;
    }
    const email = newRecipient.email.trim();
    setRecipients((items) => [...items, { name: newRecipient.name.trim(), team: newRecipient.team.trim(), email, phone: newRecipient.phone.trim() || "-", channel: newRecipient.emailChannel && newRecipient.smsChannel ? "이메일, 문자" : newRecipient.emailChannel ? "이메일" : newRecipient.smsChannel ? "문자" : "-", enabled: newRecipient.enabled }]);
    setRecipientSettings((settings) => ({ ...settings, [email]: { collection: newRecipient.collection, device: newRecipient.device, email: newRecipient.emailChannel, enabled: newRecipient.enabled, error: newRecipient.error, sms: newRecipient.smsChannel, useGlobal: newRecipient.useGlobal } }));
    setRecipientPage(Math.floor(recipients.length / recipientsPerPage));
    setNewRecipient({ name: "", team: "", email: "", phone: "", emailChannel: true, smsChannel: false, enabled: true, useGlobal: true, collection: true, error: true, device: true });
    closeAddRecipient();
  };

  return (
    <DashboardPageShell activePage="admin" headerNotifications={headerNotifications}>
      <main className="admin-page" aria-label="관리자 설정">
        <div className="page-heading"><h1>관리자 설정</h1></div>
        <div className="admin-content">
          <div className="admin-top">
            <section className="card threshold-card">
              <SectionTitle>수거 임계율</SectionTitle>
              <div className="threshold-editor">
                <div className="threshold-change"><label htmlFor="threshold-input" className="admin-label">변경값</label><div className="threshold-input"><input id="threshold-input" type="number" min="1" max="100" value={threshold} onChange={(event) => setThreshold(event.target.value)} /><span>%</span></div><p>허용 범위는 서버 설정을 따릅니다.</p><button className="admin-primary" type="button" onClick={() => { setCurrentThreshold(threshold); setSavedPreAlertThreshold(preAlertThreshold); setSavedPreAlertEnabled(preAlertEnabled); }}>수거 설정 저장</button></div>
                <div className="threshold-applied"><span>현재 적용값</span><strong>{currentThreshold}<small>%</small></strong></div>
              </div>
              <section className="threshold-alert-settings"><div className="threshold-alert-head"><div><h3>사전 수거 알림</h3><p>현재 대표 적재율이 지정한 기준에 도달하면 운영자에게 알림을 보냅니다.</p></div><label className="admin-toggle threshold-alert-toggle"><input type="checkbox" checked={preAlertEnabled} onChange={(event) => setPreAlertEnabled(event.target.checked)} /><i aria-hidden="true" /><b>{preAlertEnabled ? "사용" : "중지"}</b></label></div><label className="pre-alert-timing"><span>알림 기준 적재율</span><div className="pre-alert-setting-row"><div className="compact-percent-input"><input type="number" min="1" max="99" value={preAlertThreshold} disabled={!preAlertEnabled} onChange={(event) => setPreAlertThreshold(event.target.value)} /><b>%</b></div><small>현재 적용 {savedPreAlertEnabled ? `${savedPreAlertThreshold}%` : "중지"}</small></div></label></section>
            </section>
            <section className="card recipients-card">
              <div className="admin-card-head"><SectionTitle>알림 대상 관리</SectionTitle><div className="recipients-tools"><span>총 {recipients.length}명</span><button className="admin-primary compact" type="button" onClick={() => setAddRecipientOpen(true)}>알림 대상 추가</button></div></div>
              <div className="recipients-table-wrap"><table><thead><tr><th>이름</th><th>소속</th><th>이메일</th><th>전화번호</th><th>수신 채널</th><th>수신 이벤트</th><th>상태</th><th>관리</th></tr></thead><tbody>{visibleRecipients.map((recipient) => { const settings = recipientSettings[recipient.email]; return <tr key={recipient.email}><td>{recipient.name}</td><td>{recipient.team}</td><td>{recipient.email}</td><td>{recipient.phone}</td><td>{settings.email && settings.sms ? "이메일, 문자" : settings.email ? "이메일" : settings.sms ? "문자" : "-"}</td><td>{recipientEventSummary(settings)}</td><td><span className={`status-text ${settings.enabled ? "ok" : "muted"}`}>{settings.enabled ? "사용" : "중지"}</span></td><td><button type="button" className="admin-small-button recipient-settings-button" onClick={() => setSelectedRecipientEmail(recipient.email)}>수신 설정</button></td></tr>; })}</tbody></table></div><div className="recipients-pagination"><button type="button" aria-label="이전 알림 대상 페이지" disabled={recipientPage === 0} onClick={() => setRecipientPage((page) => page - 1)}>&lt;</button><span>{recipientPage + 1} / {recipientPages}</span><button type="button" aria-label="다음 알림 대상 페이지" disabled={recipientPage === recipientPages - 1} onClick={() => setRecipientPage((page) => page + 1)}>&gt;</button></div>
            </section>
          </div>
          <div className="admin-bottom">
            <section className="card policy-card">
              <SectionTitle>알림 정책</SectionTitle>
              <div className="policy-body">
                <div className="policy-column"><h3>전역 기본 이벤트</h3><p>공통 정책 사용으로 설정한 알림 대상에게 적용합니다.</p><div className="admin-check-list"><label className="admin-check"><input type="checkbox" checked={policyEvents.collection} onChange={() => togglePolicyEvent("collection")} /><span aria-hidden="true" /><b>수거 필요</b></label><label className="admin-check"><input type="checkbox" checked={policyEvents.error} onChange={() => togglePolicyEvent("error")} /><span aria-hidden="true" /><b>측정 오류</b></label><label className="admin-check"><input type="checkbox" checked={policyEvents.device} onChange={() => togglePolicyEvent("device")} /><span aria-hidden="true" /><b>장비 장애</b></label></div></div>
                <div className="policy-column policy-rules"><h3>발송 규칙</h3><p>발송 시점과 반복 알림을 설정합니다.</p><label className="admin-rule"><span>발송 시점</span><select defaultValue="즉시"><option>즉시</option><option>5분 후</option></select></label><label className="admin-rule"><span>반복 알림</span><select defaultValue="30분마다"><option>반복 안 함</option><option>30분마다</option><option>1시간마다</option></select></label><label className="admin-toggle"><span>오류 및 장애 해소 알림</span><input type="checkbox" checked={recoveryNotice} onChange={(event) => setRecoveryNotice(event.target.checked)} /><i aria-hidden="true" /><b>{recoveryNotice ? "사용" : "중지"}</b></label></div>
              </div>
              <div className="repeat-limit"><div><h3>반복 알림 제한</h3><p>최대 횟수에 도달하거나 이벤트가 해제되면 반복 발송을 종료합니다.</p></div><label><span>최대 반복 횟수</span><select defaultValue="3회"><option>1회</option><option>3회</option><option>5회</option></select></label></div>
              <div className="policy-actions"><button className="admin-secondary" type="button">취소</button><button className="admin-primary compact" type="button">정책 저장</button></div>
            </section>
            <section className="card test-alert-card">
              <SectionTitle>테스트 알림</SectionTitle><p className="test-alert-intro">선택한 대상과 채널로 고정 테스트 메시지를 발송합니다.</p><label className="admin-field"><span>등록 대상</span><select defaultValue="김현수"><option>김현수</option><option>박영진</option><option>이정민</option></select></label><div className="admin-field"><span>채널 선택</span><div className="test-channels"><label className="admin-check"><input type="checkbox" checked={testChannels.email} onChange={(event) => setTestChannels((channels) => ({ ...channels, email: event.target.checked }))} /><span aria-hidden="true" /><b>이메일</b></label><label className="admin-check"><input type="checkbox" checked={testChannels.sms} onChange={(event) => setTestChannels((channels) => ({ ...channels, sms: event.target.checked }))} /><span aria-hidden="true" /><b>문자</b></label></div></div><div className="test-message"><strong>발송 내용</strong><span>스크랩 모니터링 테스트 알림입니다. 이 메시지를 받았다면 알림 수신 설정이 정상입니다.</span></div><button className="admin-outline-button" type="button" disabled={testAlertState === "processing"} onClick={requestTestAlert}>{testAlertState === "processing" ? "테스트 알림 확인 중" : "테스트 알림 보내기"}</button>{testAlertState === "invalid" && <p role="alert">테스트 알림을 보낼 채널을 하나 이상 선택하세요.</p>}{testAlertState === "complete" && <p role="status">테스트 알림은 서버 연동 후 실제 발송됩니다.</p>}
            </section>
          </div>
        </div>
      </main>
      {selectedRecipient && selectedRecipientSettings && <div className="recipient-panel-backdrop" role="presentation" onClick={() => setSelectedRecipientEmail(null)}><aside className="recipient-panel" role="dialog" aria-modal="true" aria-label={`${selectedRecipient.name} 수신 설정`} onClick={(event) => event.stopPropagation()}><div className="recipient-panel-head"><div><span>개별 수신 설정</span><h2>{selectedRecipient.name}</h2><p>{selectedRecipient.team} | {selectedRecipient.email}</p></div><button type="button" aria-label="수신 설정 닫기" onClick={() => setSelectedRecipientEmail(null)}>닫기</button></div><div className="recipient-panel-body"><label className="admin-toggle recipient-toggle"><span>수신 상태</span><input type="checkbox" checked={selectedRecipientSettings.enabled} onChange={(event) => updateRecipientSetting("enabled", event.target.checked)} /><i aria-hidden="true" /><b>{selectedRecipientSettings.enabled ? "사용" : "중지"}</b></label><section><h3>수신 채널</h3><div className="panel-check-row"><label className="admin-check"><input type="checkbox" checked={selectedRecipientSettings.email} onChange={(event) => updateRecipientSetting("email", event.target.checked)} /><span aria-hidden="true" /><b>이메일</b></label><label className="admin-check"><input type="checkbox" checked={selectedRecipientSettings.sms} onChange={(event) => updateRecipientSetting("sms", event.target.checked)} /><span aria-hidden="true" /><b>문자</b></label></div></section><section><div className="recipient-events-head"><div><h3>수신 이벤트</h3><p>공통 정책을 사용하면 전역 알림 정책의 이벤트를 적용합니다.</p></div><label className="admin-toggle recipient-global-toggle"><span>공통 정책 사용</span><input type="checkbox" checked={selectedRecipientSettings.useGlobal} onChange={(event) => updateRecipientSetting("useGlobal", event.target.checked)} /><i aria-hidden="true" /><b>{selectedRecipientSettings.useGlobal ? "사용" : "해제"}</b></label></div><div className={`recipient-events ${selectedRecipientSettings.useGlobal ? "disabled" : ""}`}><label className="admin-check"><input type="checkbox" disabled={selectedRecipientSettings.useGlobal} checked={selectedRecipientSettings.collection} onChange={(event) => updateRecipientSetting("collection", event.target.checked)} /><span aria-hidden="true" /><b>수거 필요</b></label><label className="admin-check"><input type="checkbox" disabled={selectedRecipientSettings.useGlobal} checked={selectedRecipientSettings.error} onChange={(event) => updateRecipientSetting("error", event.target.checked)} /><span aria-hidden="true" /><b>측정 오류</b></label><label className="admin-check"><input type="checkbox" disabled={selectedRecipientSettings.useGlobal} checked={selectedRecipientSettings.device} onChange={(event) => updateRecipientSetting("device", event.target.checked)} /><span aria-hidden="true" /><b>장비 장애</b></label></div></section></div><div className="recipient-panel-actions"><button className="admin-secondary" type="button" onClick={() => setSelectedRecipientEmail(null)}>취소</button><button className="admin-primary compact" type="button" onClick={() => setSelectedRecipientEmail(null)}>수신 설정 저장</button></div></aside></div>}
      {addRecipientOpen && <div className="recipient-add-backdrop" role="presentation" onClick={closeAddRecipient}><form className="recipient-add-modal" aria-label="알림 대상 추가" onSubmit={addRecipient} onClick={(event) => event.stopPropagation()}><div className="recipient-add-head"><div><span>ALERT RECIPIENT</span><h2>알림 대상 추가</h2><p>대상 정보와 수신 정책을 설정합니다.</p></div><button type="button" aria-label="알림 대상 추가 닫기" onClick={closeAddRecipient}>닫기</button></div><div className="recipient-add-body"><div className="recipient-add-fields"><label><span>이름</span><input autoFocus value={newRecipient.name} onChange={(event) => setNewRecipient((item) => ({ ...item, name: event.target.value }))} /></label><label><span>소속</span><input value={newRecipient.team} onChange={(event) => setNewRecipient((item) => ({ ...item, team: event.target.value }))} /></label><label><span>이메일</span><input type="email" value={newRecipient.email} onChange={(event) => setNewRecipient((item) => ({ ...item, email: event.target.value }))} /></label><label><span>전화번호</span><input type="tel" placeholder="010-0000-0000" value={newRecipient.phone} onChange={(event) => setNewRecipient((item) => ({ ...item, phone: event.target.value }))} /></label></div><section className="recipient-add-section"><div className="recipient-add-section-head"><h3>수신 상태</h3><label className="admin-toggle recipient-global-toggle"><span>수신 사용</span><input type="checkbox" checked={newRecipient.enabled} onChange={(event) => setNewRecipient((item) => ({ ...item, enabled: event.target.checked }))} /><i aria-hidden="true" /><b>{newRecipient.enabled ? "사용" : "중지"}</b></label></div><div className="panel-check-row"><label className="admin-check"><input type="checkbox" checked={newRecipient.emailChannel} onChange={(event) => setNewRecipient((item) => ({ ...item, emailChannel: event.target.checked }))} /><span aria-hidden="true" /><b>이메일</b></label><label className="admin-check"><input type="checkbox" checked={newRecipient.smsChannel} onChange={(event) => setNewRecipient((item) => ({ ...item, smsChannel: event.target.checked }))} /><span aria-hidden="true" /><b>문자</b></label></div></section><section className="recipient-add-section"><h3>수신 이벤트 적용</h3><p>전역 정책을 사용하면 알림 정책 카드의 기본 이벤트를 적용합니다.</p><div className="policy-mode-options"><label><input type="radio" name="recipient-policy" checked={newRecipient.useGlobal} onChange={() => setNewRecipient((item) => ({ ...item, useGlobal: true }))} /><span><b>전역 정책 사용</b><small>공통 이벤트와 발송 규칙 적용</small></span></label><label><input type="radio" name="recipient-policy" checked={!newRecipient.useGlobal} onChange={() => setNewRecipient((item) => ({ ...item, useGlobal: false }))} /><span><b>개별 이벤트 설정</b><small>이 대상에게만 별도 이벤트 적용</small></span></label></div><div className={`recipient-events add-recipient-events ${newRecipient.useGlobal ? "disabled" : ""}`}><label className="admin-check"><input type="checkbox" disabled={newRecipient.useGlobal} checked={newRecipient.collection} onChange={(event) => setNewRecipient((item) => ({ ...item, collection: event.target.checked }))} /><span aria-hidden="true" /><b>수거 필요</b></label><label className="admin-check"><input type="checkbox" disabled={newRecipient.useGlobal} checked={newRecipient.error} onChange={(event) => setNewRecipient((item) => ({ ...item, error: event.target.checked }))} /><span aria-hidden="true" /><b>측정 오류</b></label><label className="admin-check"><input type="checkbox" disabled={newRecipient.useGlobal} checked={newRecipient.device} onChange={(event) => setNewRecipient((item) => ({ ...item, device: event.target.checked }))} /><span aria-hidden="true" /><b>장비 장애</b></label></div></section>{addRecipientError && <p className="recipient-add-error" role="alert">{addRecipientError}</p>}</div><div className="recipient-add-actions"><button className="admin-secondary" type="button" onClick={closeAddRecipient}>취소</button><button className="admin-primary compact" type="submit">알림 대상 추가</button></div></form></div>}
    </DashboardPageShell>
  );
}

function HistoryPage({ history, headerNotifications, status }: { history: DashboardData["history"]; headerNotifications: HeaderNotification[]; status: DashboardData["monitoring"]["status"] }) {
  const [eventType, setEventType] = useState("전체");
  const [eventPage, setEventPage] = useState(0);
  const filteredEvents = eventType === "전체" ? history.events : history.events.filter((event) => event.type === eventType);
  const totalEventPages = Math.max(1, Math.ceil(filteredEvents.length / historyEventsPerPage));
  const visibleEvents = filteredEvents.slice(eventPage * historyEventsPerPage, (eventPage + 1) * historyEventsPerPage);
  return (
    <DashboardPageShell activePage="history" headerNotifications={headerNotifications}>
      <main className="history-page" aria-label="스크랩 모니터링 이력">
        <div className="page-heading"><h1>이력</h1><div className="page-meta"><DashboardStatusLabel status={status} /><span className="meta-divider" aria-hidden="true" /><span>마지막 측정 10:24:18</span></div></div>
        <div className="history-content">
          <section className="card history-query"><SectionTitle>조회 조건</SectionTitle><div className="query-controls"><label>시작 시각<input type="datetime-local" defaultValue="2026-09-03T00:00" /></label><label>종료 시각<input type="datetime-local" defaultValue="2026-09-09T23:59" /></label><div className="query-type"><span>이벤트 유형</span><div>{["전체", "수거", "알림", "오류"].map((type) => <button key={type} className={eventType === type ? "selected" : ""} type="button" onClick={() => { setEventType(type); setEventPage(0); }}>{type}</button>)}</div></div><button className="primary-button" type="button">조회</button></div></section>
          <section className="card history-load"><div className="history-card-head"><SectionTitle>적재율 이력</SectionTitle><div className="history-legend" aria-label="그래프 범례"><span><i className="history-legend-line" />수거 임계율</span><span><i className="history-legend-leader need" />수거 필요</span><span><i className="history-legend-leader complete" />수거 완료</span><span><i className="history-legend-leader error" />오류</span></div></div><HistoryLoadChart {...history} /></section>
          <section className="card history-events"><div className="history-card-head"><SectionTitle>이벤트 이력</SectionTitle><span>총 {filteredEvents.length}건</span></div><div className="history-table-wrap"><table><thead><tr><th>시각</th><th>유형</th><th>상태</th><th>내용</th><th>관련 녹화</th></tr></thead><tbody>{visibleEvents.map((event) => <tr key={event.time}><td>{event.time}</td><td>{event.type}</td><td><span className={`event-dot ${event.tone}`} />{event.content}</td><td>{event.detail}</td><td><a href="/recordings">영상 보기</a></td></tr>)}</tbody></table></div><div className="history-pagination"><button type="button" aria-label="이전 이벤트 페이지" disabled={eventPage === 0} onClick={() => setEventPage((page) => page - 1)}>&lt;</button><span>{eventPage + 1} / {totalEventPages}</span><button type="button" aria-label="다음 이벤트 페이지" disabled={eventPage === totalEventPages - 1} onClick={() => setEventPage((page) => page + 1)}>&gt;</button></div></section>
        </div>
      </main>
    </DashboardPageShell>
  );
}

export function App({ dataSource }: { dataSource: DashboardDataSource }) {
  const [alertPage, setAlertPage] = useState(0);
  const [videoOpen, setVideoOpen] = useState(false);
  const closeVideo = useCallback(() => setVideoOpen(false), []);
  const videoModalRef = useModalFocus<HTMLDivElement>(videoOpen, closeVideo);
  const { data: dashboardData, error: dashboardError, reload } = useDashboardData(dataSource);

  const isAuthenticated = window.sessionStorage.getItem("scrap-monitoring-authenticated") === "true";
  if (window.location.pathname === "/login") return <LoginPage />;
  if (window.location.pathname === "/admin" && !isAuthenticated) {
    window.history.replaceState(null, "", "/login");
    return <LoginPage />;
  }
  const statePageFooter = <ApplicationFooter />;
  const statePageHeader = <DashboardHeader activePage="monitoring" initialNotifications={[]} />;
  if (dashboardError) return <DashboardStatePage title="데이터를 불러올 수 없습니다." description="데이터 연결 상태를 확인한 뒤 다시 시도하세요." onRetry={reload} header={statePageHeader} footer={statePageFooter} />;
  if (dashboardData === null) return <DashboardStatePage title="데이터를 불러오는 중입니다." description="최신 모니터링 데이터를 준비하고 있습니다." header={statePageHeader} footer={statePageFooter} />;

  const { admin, history, lastMeasuredAt, monitoring, recordings } = dashboardData;
  const totalAlertPages = Math.max(1, Math.ceil(monitoring.alerts.length / alertsPerPage));
  const pageStart = alertPage * alertsPerPage;
  const visibleAlerts = monitoring.alerts.slice(pageStart, pageStart + alertsPerPage);

  if (monitoring.status === "no-data") return <DashboardStatePage title="표시할 모니터링 데이터가 없습니다." description="조회 조건 또는 장비 데이터 수신 상태를 확인하세요." header={statePageHeader} footer={statePageFooter} />;
  if (window.location.pathname === "/recordings") return <RecordingsPage recordings={recordings} headerNotifications={monitoring.headerNotifications} status={monitoring.status} />;
  if (window.location.pathname === "/history") return <HistoryPage history={history} headerNotifications={monitoring.headerNotifications} status={monitoring.status} />;
  if (window.location.pathname === "/admin") return <AdminPage admin={admin} headerNotifications={monitoring.headerNotifications} />;

  return (
    <DashboardPageShell activePage="monitoring" headerNotifications={monitoring.headerNotifications}>
      <main className="monitoring-page" aria-label="스크랩 모니터링 대시보드">
        <div className="page-heading">
          <h1>스크랩 모니터링</h1>
          <div className="page-meta">
            <DashboardStatusLabel status={monitoring.status} />
            <span className="meta-divider" aria-hidden="true" />
            <span>마지막 측정 {lastMeasuredAt}</span>
          </div>
        </div>
        <div className="content">
          <div className="monitoring-grid">
            <section className="card top-card span-4 kpi-card">
              <SectionTitle>현재 상태</SectionTitle>
              <div className="kpi-content">
                <p className="kpi-label">대표 적재율</p>
                <div className="kpi-value">{monitoring.summary.loadPercent}<span>%</span></div>
                <div className="progress" aria-label={`대표 적재율 ${monitoring.summary.loadPercent}%`}>
                  <div style={{ width: `${monitoring.summary.loadPercent}%` }} />
                </div>
                <div className="mini-stats">
                  <div className="mini-stat">
                    <span className="label">수거 임계율</span>
                    <strong>{monitoring.summary.collectionThreshold}%</strong>
                  </div>
                  <div className="mini-stat">
                    <span className="label">운영 상태</span>
                    <strong className="status-text ok">적재중</strong>
                  </div>
                  <div className="mini-stat">
                    <span className="label">예상 도달</span>
                    <strong>{monitoring.summary.expectedArrivalAt}</strong>
                    <span className="remaining-time">남은 시간 4시간 6분</span>
                  </div>
                </div>
                <div className="status-details">
                  <div><span className="label">최근 1시간 변화량</span><strong className="status-text ok">{monitoring.summary.recentChange}</strong></div>
                  <div><span className="label">최근 수거 후 경과</span><strong>{monitoring.summary.timeSinceCollection}</strong></div>
                  <div><span className="label">평균 수거 주기</span><strong>{monitoring.summary.averageCollectionCycle}</strong></div>
                </div>
              </div>
            </section>
            <section className="card top-card span-4 video-card">
              <div className="live-frame">
                <img src={cameraFrame} alt="스크랩 적재 공간 합성 영상 예시" />
                <span className="live-indicator">LIVE</span>
                <span className="live-time">{monitoring.videoTimestamp}</span>
                <button className="fullscreen" type="button" aria-label="실시간 영상 크게 보기" onClick={() => setVideoOpen(true)}><ExpandIcon /></button>
              </div>
            </section>
            <section className="card top-card span-4 measurement-card">
              <SectionTitle>측정 영역</SectionTitle>
              <MeasurementDiagram lidar1Color="#1677e8" lidar2Color="#0ba58f" />
            </section>
            <section className="card chart-card span-4">
            <div className="chart-title-row"><SectionTitle>최근 24시간 적재율</SectionTitle></div>
              <LoadChart samples={monitoring.loadHistory} threshold={monitoring.summary.collectionThreshold} />
            </section>
            {monitoring.lidarProfiles.map((profile) => <ProfileChart key={profile.label} {...profile} />)}
            <section className="card alerts-card span-4">
              <div className="card-head">
                <SectionTitle>활성 알림</SectionTitle>
                <span className="alert-count">{monitoring.alerts.length}건</span>
              </div>
              <div className="active-alert-list">
                {visibleAlerts.map((alert) => (
                  <div className="active-alert" key={`${alert.title}-${alert.time}`}>
                    <div><strong className={alert.level === "warning" ? "alert-warning" : "alert-error"}>{alert.title}</strong><span>{alert.detail}</span></div>
                    <time>{alert.time}</time>
                  </div>
                ))}
              </div>
              <div className="alert-pagination" aria-label="활성 알림 페이지">
                <button
                  type="button"
                  aria-label="이전 알림 페이지"
                  disabled={alertPage === 0}
                  onClick={() => setAlertPage((page) => page - 1)}
                >&lt;</button>
                <span>{alertPage + 1} / {totalAlertPages}</span>
                <button
                  type="button"
                  aria-label="다음 알림 페이지"
                  disabled={alertPage === totalAlertPages - 1}
                  onClick={() => setAlertPage((page) => page + 1)}
                >&gt;</button>
              </div>
            </section>
            <section className="card devices-card span-8">
              <SectionTitle>장비 상태</SectionTitle>
              <div className="device-grid">
                {monitoring.devices.map((device) => (
                  <div className="device" key={device.label}>
                    <div>
                      <span className="device-name">{device.label}</span>
                      <span className={`status-text ${device.status === "normal" ? "ok" : "error"}`}>{device.status === "normal" ? "정상" : "수신 없음"}</span>
                      <span className="device-meta">최근 수신 {device.received}</span>
                      <span className="device-meta">지연 {device.latency}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </main>
      {videoOpen && (
        <div ref={videoModalRef} className="video-modal" role="dialog" aria-modal="true" aria-label="실시간 영상 크게 보기" onClick={closeVideo}>
          <div className="video-modal-panel" onClick={(event) => event.stopPropagation()}>
            <button className="video-modal-close" type="button" aria-label="영상 닫기" onClick={closeVideo}>닫기</button>
            <div className="video-modal-frame">
              <img src={cameraFrame} alt="스크랩 적재 공간 실시간 영상 확대" />
              <span className="live-indicator">LIVE</span>
              <span className="live-time">{monitoring.videoTimestamp}</span>
            </div>
          </div>
        </div>
      )}
    </DashboardPageShell>
  );
}
