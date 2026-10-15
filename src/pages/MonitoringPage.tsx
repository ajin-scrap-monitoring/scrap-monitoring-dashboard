import { useCallback, useState } from "react";

import cameraFrame from "../assets/camera-frame.png";
import { DashboardPageShell } from "../components/DashboardShell";
import { ExpandIcon, SectionTitle } from "../components/DashboardPrimitives";
import { DataReceptionMeta } from "../components/DataReceptionMeta";
import { LiveVideo } from "../components/LiveVideo";
import { LoadChart, MeasurementDiagram, ProfileChart, UnsupportedChart } from "../components/MonitoringVisuals";
import { Pagination } from "../components/Pagination";
import type { DashboardDataSource } from "../data/dashboard-data-source";
import type { AlarmState, DashboardData } from "../domain/dashboard";
import { v1MonitoringEnabled } from "../build-features";
import { useModalFocus } from "../use-modal-focus";

const alertsPerPage = 4;
const missingValue = "정보 없음";
const alarmPresentation: Record<AlarmState, string> = { NORMAL: "경고 기준 미만", WARNING: "경고", CRITICAL: "위험", UNKNOWN: "확인 불가", ERROR: "판정 불가" };
const deviceLabels = { normal: "정상", delayed: "지연", unavailable: "수신 없음", unknown: missingValue };
const deviceTones = { normal: "ok", delayed: "warning", unavailable: "error", unknown: "" };
const deviceStateLabels: Record<string, string> = {
  FRESH: "정상", STALE: "갱신 지연", RECOVERING: "복구 중", UNAVAILABLE: "사용 불가", UNKNOWN: "확인 불가",
  HEALTHY: "정상", DEGRADED: "일부 기능 제한", MEASUREMENT_UNAVAILABLE: "측정 불가", CONFIG_ERROR: "설정 오류",
  STARTING: "시작 중", RETRYING: "재연결 중", FATAL: "사용 불가",
};

function deviceLabel(value: string) {
  return Object.hasOwn(deviceStateLabels, value) ? deviceStateLabels[value] : value;
}

export function MonitoringPage({ data, dataSource }: { data: DashboardData; dataSource: DashboardDataSource }) {
  const { monitoring, session } = data;
  const state = monitoring.v2;
  const [alertPage, setAlertPage] = useState(0);
  const [videoOpen, setVideoOpen] = useState(false);
  const closeDialog = useCallback(() => setVideoOpen(false), []);
  const modalRef = useModalFocus<HTMLDivElement>(videoOpen, closeDialog);
  const totalAlertPages = Math.max(1, Math.ceil(monitoring.alerts.length / alertsPerPage));
  const currentAlertPage = Math.min(alertPage, totalAlertPages - 1);
  const visibleAlerts = monitoring.alerts.slice(currentAlertPage * alertsPerPage, (currentAlertPage + 1) * alertsPerPage);
  const alarmState = state?.streamState === "reconnecting" && monitoring.alarmState ? "UNKNOWN" : monitoring.alarmState;
  const alarmLabel = alarmState ? alarmPresentation[alarmState] : "미지원";
  const valueLength = String(monitoring.summary.loadPercent ?? "").length;
  const pastLoad = monitoring.summary.loadOneHourAgo;
  const pastLoadTitle = pastLoad
    ? `관측 시각: ${new Date(pastLoad.observedAt).toLocaleString()}. ${pastLoad.dataState === "LIMITED" ? "제한된 데이터. " : ""}1시간 전 기준 시각 이전 1분 이내의 서버 이력입니다.`
    : undefined;

  return <DashboardPageShell activePage="monitoring" dataSource={dataSource} headerNotifications={monitoring.headerNotifications} headerUnreadCount={monitoring.unreadNotificationCount} notificationState={monitoring.notificationState} session={session}>
    <main className="monitoring-page" aria-label="스크랩 모니터링 대시보드">
      <div className="page-heading">
        <h1>스크랩 모니터링</h1>
        <DataReceptionMeta reception={data.reception} />
      </div>
      <div className="content">
        <div className="monitoring-grid">
          <section className="card top-card span-4 kpi-card">
            <div className="monitoring-card-title"><SectionTitle>현재 상태</SectionTitle></div>
            <div className="kpi-content">
              <p className="kpi-label">추정 적재율</p>
              <div className={`kpi-value${monitoring.summary.loadPercent === null ? " unavailable-value" : valueLength > 5 ? " precise-value" : ""}`} style={valueLength > 5 ? { fontSize: Math.min(76, 500 / valueLength) } : undefined}>{monitoring.summary.loadPercent === null ? "판단 불가" : <>{monitoring.summary.loadPercent}<span>%</span></>}</div>
              {monitoring.summary.loadPercent === null
                ? <div className="progress-unavailable">{state?.streamState === "reconnecting" && <span role="status">실시간 연결 재연결 중</span>}</div>
                : <div className="progress" aria-label={`추정 적재율 ${monitoring.summary.loadPercent}%`}><div style={{ width: `${monitoring.summary.loadPercent}%` }} /></div>}
              <div className="mini-stats">
                <div className="mini-stat">
                  <span className="label">수거 임계율</span>
                  <strong>{monitoring.summary.collectionThreshold}%</strong>
                  <span className="pre-alert-summary">{state ? `경고 기준 ${state.warningThreshold}%` : monitoring.summary.preCollectionAlert.enabled ? `사전 알림 기준 ${monitoring.summary.preCollectionAlert.threshold}%` : "사전 알림 꺼짐"}</span>
                </div>
                <div className="mini-stat">
                  <span className="label">적재율 경보</span>
                  <strong className="alarm-status">{alarmLabel}</strong>
                </div>
                <div className="mini-stat">
                  <span className="label">예상 도달</span>
                  <strong>{state ? "미지원" : monitoring.summary.expectedArrivalAt}</strong>
                  <span className="remaining-time">남은 시간 {state ? "미지원" : monitoring.summary.remainingTime}</span>
                </div>
              </div>
              <div className="status-details">
                <div className="mini-stat"><span className="label">1시간 전 적재율</span><strong title={pastLoadTitle}>{pastLoad ? `${pastLoad.value}%` : "정보 없음"}</strong></div>
                <div className="mini-stat"><span className="label">최근 수거 후 경과</span><strong>{monitoring.summary.timeSinceCollection}</strong></div>
                <div className="mini-stat"><span className="label">평균 수거 주기</span><strong>{state ? "미지원" : monitoring.summary.averageCollectionCycle}</strong></div>
              </div>
            </div>
          </section>
          <section className="card top-card span-4 video-card" aria-label="실시간 영상">
            <div className="live-frame">
              {videoOpen && monitoring.videoMode !== "sample"
                ? <img src={cameraFrame} alt="" />
                : <LiveVideo alt="스크랩 적재 공간 실시간 영상" fallbackImage={cameraFrame} monitoring={monitoring} />}
              {monitoring.videoMode !== "mjpeg" && <span className="live-indicator">LIVE</span>}
              <button className="fullscreen" type="button" aria-label="실시간 영상 크게 보기" onClick={() => setVideoOpen(true)}><ExpandIcon /></button>
            </div>
          </section>
          <section className="card top-card span-4 measurement-card">
            <div className="monitoring-card-title"><SectionTitle>측정 영역</SectionTitle></div>
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
                <span className={`status-text ${deviceTones[device.status]}`} title={device.statusLabel}>{device.statusLabel ? deviceLabel(device.statusLabel) : deviceLabels[device.status]}</span>
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
        </div>
      </div>
    </div>}
  </DashboardPageShell>;
}
