import { lazy, Suspense, useCallback, useState } from "react";

import cameraFrame from "../assets/camera-frame.png";
import { DashboardPageShell } from "../components/DashboardShell";
import { DashboardStatusLabel, ExpandIcon, SectionTitle } from "../components/DashboardPrimitives";
import { LiveVideo } from "../components/LiveVideo";
import { LoadChart, MeasurementDiagram, ProfileChart, UnsupportedChart } from "../components/MonitoringVisuals";
import { Pagination } from "../components/Pagination";
import { DetailDialog } from "../components/DetailDialog";
import type { DashboardDataSource } from "../data/dashboard-data-source";
import type { AlarmState, DashboardData } from "../domain/dashboard";
import { v1MonitoringEnabled, v2MonitoringEnabled } from "../build-features";
import { useModalFocus } from "../use-modal-focus";

const alertsPerPage = 4;
const missingValue = "정보 없음";
const alarmPresentation: Record<AlarmState, [string, string]> = { NORMAL: ["경고 기준 미만", "ok"], WARNING: ["경고", "warning"], CRITICAL: ["위험", "error"], UNKNOWN: ["확인 불가", "muted"], ERROR: ["판정 불가", "error"] };
const deviceLabels = { normal: "정상", delayed: "지연", unavailable: "수신 없음", unknown: missingValue };
const deviceTones = { normal: "ok", delayed: "warning", unavailable: "error", unknown: "" };
const MonitoringDetails = import.meta.env.DEV || import.meta.env.VITE_ENABLE_MOCK_DATA === "true" || (import.meta.env.VITE_MONITORING_API_VERSION ?? "v2") === "v2"
  ? lazy(() => import("../components/MonitoringDetails")) : null;

export function MonitoringPage({ data, dataSource }: { data: DashboardData; dataSource: DashboardDataSource }) {
  const { monitoring, session } = data;
  const state = monitoring.v2;
  const [alertPage, setAlertPage] = useState(0);
  const [dialog, setDialog] = useState<"video" | "details" | null>(null);
  const closeDialog = useCallback(() => setDialog(null), []);
  const videoOpen = dialog === "video";
  const modalRef = useModalFocus<HTMLDivElement>(videoOpen, closeDialog);
  const totalAlertPages = Math.max(1, Math.ceil(monitoring.alerts.length / alertsPerPage));
  const currentAlertPage = Math.min(alertPage, totalAlertPages - 1);
  const visibleAlerts = monitoring.alerts.slice(currentAlertPage * alertsPerPage, (currentAlertPage + 1) * alertsPerPage);
  const alarmState = state?.streamState === "reconnecting" && monitoring.alarmState ? "UNKNOWN" : monitoring.alarmState;
  const [alarmLabel, alarmTone] = alarmState ? alarmPresentation[alarmState] : ["경보 평가 미제공", "muted"];
  const valueLength = String(monitoring.summary.loadPercent ?? "").length;

  return <DashboardPageShell activePage="monitoring" dataSource={dataSource} headerNotifications={monitoring.headerNotifications} headerUnreadCount={monitoring.unreadNotificationCount} notificationState={monitoring.notificationState} session={session}>
    <main className="monitoring-page" aria-label="스크랩 모니터링 대시보드">
      <div className="page-heading">
        <h1>스크랩 모니터링</h1>
        <div className="page-meta">
          <DashboardStatusLabel status={monitoring.status} />
          <span className="meta-divider" aria-hidden="true" />
          <span>마지막 측정 {state ? state.measuredAt ?? "정보 없음" : data.lastMeasuredAt}</span>
        </div>
      </div>
      <div className="content">
        <div className="monitoring-grid">
          <section className="card top-card span-4 kpi-card">
            <div className="monitoring-card-title"><SectionTitle>현재 상태</SectionTitle>{v2MonitoringEnabled && state && <button className="monitoring-detail-button" type="button" onClick={() => setDialog("details")}>상태 상세</button>}</div>
            <div className="kpi-content">
              <p className="kpi-label">대표 적재율</p>
              <div className={`kpi-value${monitoring.summary.loadPercent === null ? " unavailable-value" : valueLength > 5 ? " precise-value" : ""}`} style={valueLength > 5 ? { fontSize: Math.min(76, 500 / valueLength) } : undefined}>{monitoring.summary.loadPercent === null ? "판단 불가" : <>{monitoring.summary.loadPercent}<span>%</span></>}</div>
              {monitoring.summary.loadPercent === null
                ? <div className="progress-unavailable">{state?.streamState === "reconnecting" ? <span role="status">실시간 연결 재연결 중</span> : <span>유효한 적재율 정보 없음</span>}</div>
                : <div className="progress" aria-label={`대표 적재율 ${monitoring.summary.loadPercent}%`}><div style={{ width: `${monitoring.summary.loadPercent}%` }} /></div>}
              <div className="mini-stats">
                <div className="mini-stat">
                  <span className="label">수거 임계율</span>
                  <strong>{monitoring.summary.collectionThreshold}%</strong>
                  <span className="pre-alert-summary">{state ? `경고 기준 ${state.warningThreshold}%` : monitoring.summary.preCollectionAlert.enabled ? `사전 알림 기준 ${monitoring.summary.preCollectionAlert.threshold}%` : "사전 알림 꺼짐"}</span>
                </div>
                <div className="mini-stat">
                  <span className="label">적재율 경보</span>
                  <strong className={`alarm-status status-text ${alarmTone}`}>{alarmLabel}</strong>
                </div>
                <div className="mini-stat">
                  <span className="label">예상 도달</span>
                  <strong>{state ? "미지원" : monitoring.summary.expectedArrivalAt}</strong>
                  <span className="remaining-time">남은 시간 {state ? "미지원" : monitoring.summary.remainingTime}</span>
                </div>
              </div>
              <div className="status-details">
                <div><span className="label">최근 1시간 변화량</span><strong className={state ? undefined : "status-text ok"}>{state ? "미지원" : monitoring.summary.recentChange}</strong></div>
                <div><span className="label">최근 수거 후 경과</span><strong>{monitoring.summary.timeSinceCollection}</strong></div>
                <div><span className="label">평균 수거 주기</span><strong>{state ? "미지원" : monitoring.summary.averageCollectionCycle}</strong></div>
              </div>
            </div>
          </section>
          <section className="card top-card span-4 video-card" aria-label="실시간 영상">
            <div className="live-frame">
              {videoOpen && monitoring.videoMode !== "sample"
                ? <img src={cameraFrame} alt="" />
                : <LiveVideo alt="스크랩 적재 공간 실시간 영상" fallbackImage={cameraFrame} monitoring={monitoring} />}
              {monitoring.videoMode !== "mjpeg" && <span className="live-indicator">LIVE</span>}
              <span className="live-time">{monitoring.videoTimestamp}</span>
              <button className="fullscreen" type="button" aria-label="실시간 영상 크게 보기" onClick={() => setDialog("video")}><ExpandIcon /></button>
            </div>
          </section>
          <section className="card top-card span-4 measurement-card">
            <div className="monitoring-card-title"><SectionTitle>측정 영역</SectionTitle>{state && <span className="measurement-note">참고도 / 실측 배치 미제공</span>}</div>
            <MeasurementDiagram lidar1Color="#1677e8" lidar2Color="#0ba58f" />
          </section>
          <section className="card chart-card span-4">
            <div className="chart-title-row"><SectionTitle>최근 24시간 적재율</SectionTitle></div>
            <LoadChart samples={monitoring.loadHistory} threshold={monitoring.summary.collectionThreshold} state={monitoring.loadHistoryState} thresholdKind={state ? "current" : undefined} />
          </section>
          {v1MonitoringEnabled && !state
            ? monitoring.lidarProfiles.map((profile) => <ProfileChart key={profile.label} {...profile} />)
            : ["LiDAR 1", "LiDAR 2"].map((label) => <UnsupportedChart key={label} label={label} reason="API에서 LiDAR profile을 제공하지 않습니다." />)}
          <section className="card alerts-card span-4">
            <div className="card-head"><SectionTitle>활성 알림</SectionTitle><span className="alert-count">{state ? "정보 없음" : `${monitoring.alerts.length}건`}</span></div>
            <div className="active-alert-list">
              {state ? <p className="collection-empty">활성 여부를 확인할 수 있는 알림 정보가 없습니다.</p> : visibleAlerts.length > 0 ? visibleAlerts.map((alert) => <div className="active-alert" key={alert.id}>
                <div><strong className={`alert-${alert.level}`}>{alert.title}</strong><span>{alert.detail}</span></div><time>{alert.time}</time>
              </div>) : <p className="collection-empty">활성 알림이 없습니다.</p>}
            </div>
            <Pagination ariaLabel="활성 알림 페이지" currentPage={state ? 0 : currentAlertPage} itemLabel="알림" onPageChange={setAlertPage} totalPages={state ? 1 : totalAlertPages} />
          </section>
          <section className="card devices-card span-8">
            <SectionTitle>장비 상태</SectionTitle>
            <div className="device-grid">
              {monitoring.devices.length ? monitoring.devices.map((device, index) => <div className="device" key={`${index}-${device.label}`}><div>
                <span className="device-name" title={device.label}>{device.label}</span>
                <span className={`status-text ${deviceTones[device.status]}`}>{device.statusLabel ?? deviceLabels[device.status]}</span>
                <span className="device-meta">{device.receivedLabel ?? "최근 수신"} {device.received}</span>
                <span className="device-meta">지연 {device.latency}</span>
              </div></div>) : <p className="collection-empty">등록된 장비 상태가 없습니다.</p>}
            </div>
          </section>
        </div>
      </div>
    </main>
    {videoOpen && <div ref={modalRef} className="video-modal" role="dialog" aria-modal="true" aria-label="실시간 영상 크게 보기" onClick={closeDialog}>
      <div className="video-modal-panel" onClick={(event) => event.stopPropagation()}>
        <button className="video-modal-close" type="button" aria-label="영상 닫기" onClick={closeDialog}>닫기</button>
        <div className="video-modal-frame">
          <LiveVideo alt="스크랩 적재 공간 실시간 영상 확대" fallbackImage={cameraFrame} monitoring={monitoring} />
          {monitoring.videoMode !== "mjpeg" && <span className="live-indicator">LIVE</span>}
          <span className="live-time">{monitoring.videoTimestamp}</span>
        </div>
      </div>
    </div>}
    {v2MonitoringEnabled && dialog === "details" && state && MonitoringDetails && <DetailDialog id="monitoring-details-title" title="모니터링 상태 상세" onClose={closeDialog}>
      <Suspense fallback={<p role="status">상태 상세 확인 중</p>}><MonitoringDetails state={state} dataSource={dataSource} /></Suspense>
    </DetailDialog>}
  </DashboardPageShell>;
}
