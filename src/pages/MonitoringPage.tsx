import { useCallback, useState } from "react";

import cameraFrame from "../assets/camera-frame.png";
import { DashboardPageShell } from "../components/DashboardShell";
import { DetailDialog } from "../components/DetailDialog";
import { ExpandIcon, PageTitle, SectionTitle } from "../components/DashboardPrimitives";
import { DataReceptionMeta } from "../components/DataReceptionMeta";
import { LiveVideo } from "../components/LiveVideo";
import { LoadChart, MeasurementDiagram, ProfileChart, UnsupportedChart } from "../components/MonitoringVisuals";
import { Pagination } from "../components/Pagination";
import type { DashboardDataSource } from "../data/dashboard-data-source";
import type { ActiveAlert, ActiveAlertCoverage, AlarmState, DashboardData, MeasurementLayoutStatus, MonitoringFilterState } from "../domain/dashboard";
import { v1MonitoringEnabled } from "../build-features";
import { seoulDateTime, seoulDisplayText } from "../display-time";
import { useModalFocus } from "../use-modal-focus";
import { useCameraStatus } from "./use-camera-status";
import {
  componentKindLabel,
  deviceStatusTitle,
  evidenceSourceLabel,
  formatLoadPercent,
  formatMonitoringReasonDetails,
  formatMonitoringReasonSummary,
} from "./monitoring-presentation";

const alertsPerPage = 4;
const missingValue = "정보 없음";
const alarmPresentation: Record<AlarmState, string> = { NORMAL: "정상", WARNING: "경고", CRITICAL: "경고", UNKNOWN: "확인 불가", ERROR: "판정 불가" };

function alarmStateLabel(state: string | null | undefined): string {
  if (!state) return "정보 없음";
  return Object.hasOwn(alarmPresentation, state) ? alarmPresentation[state as AlarmState] : state;
}
const deviceLabels = { normal: "정상", delayed: "지연", unavailable: "수신 없음", unknown: missingValue };
const deviceTones = { normal: "ok", delayed: "warning", unavailable: "error", unknown: "" };
const deviceStateLabels: Record<string, string> = {
  FRESH: "정상", STALE: "갱신 지연", RECOVERING: "복구 중", UNAVAILABLE: "사용 불가", UNKNOWN: "확인 불가",
  HEALTHY: "정상", DEGRADED: "일부 기능 제한", MEASUREMENT_UNAVAILABLE: "측정 불가", CONFIG_ERROR: "설정 오류",
  STARTING: "시작 중", RETRYING: "재연결 중", FATAL: "사용 불가",
};

type AlertNotice = { id: string; title: string; detail: string; hint: string; reasonCodes: string[] };
type AlertRow = { alert: ActiveAlert } | { notice: AlertNotice };
const coverageReasonLabels: Record<string, string> = { CAMERA_HEALTH_SOURCE_NOT_CONFIGURED: "상태 입력 계약 없음" };

function formatKpiLabel(filterState?: MonitoringFilterState | null, loadHeld?: boolean) {
  const parts: string[] = [];
  if (loadHeld) parts.push("갱신 대기");
  else if (filterState === "WARMING") parts.push("안정화 준비 중");
  else if (filterState === "UNAVAILABLE") parts.push("안정화 불가");
  if (parts.length === 0) return "추정 적재율";
  return `추정 적재율 (${parts.join(", ")})`;
}

function coverageDetail(entry: ActiveAlertCoverage) {
  const reason = entry.reasonCodes.map((code) => coverageReasonLabels[code]).find(Boolean);
  return entry.state === "UNSUPPORTED" ? `확인 불가, ${reason ?? "상태 입력 계약 없음"}` : "확인 불가, 현재 상태를 확인하지 못함";
}

const sensorNames: Record<string, string> = { "lidar-a": "LiDAR 1", "lidar-b": "LiDAR 2" };

function layoutPresentation(layout: MeasurementLayoutStatus | null | undefined) {
  if (layout === undefined) return null;
  if (layout === null) return { label: "배치 정보 없음", hint: undefined };
  if (layout.bindingState === "MATCHED" && layout.state === "SIMULATION") return null;
  const label = layout.bindingState !== "MATCHED" || layout.state === "UNAVAILABLE" ? "배치 정보 확인 불가"
    : layout.state === "PARTIAL" ? "일부 배치 정보 없음" : "배치 미검증";
  const hint = [
    layout.reasonCodes.length > 0 ? `사유 ${layout.reasonCodes.join(", ")}` : "",
    ...layout.sensors.map((sensor) => `${sensorNames[sensor.sensorId] ?? sensor.sensorId} ${sensor.calibrationState}${sensor.reasonCodes.length > 0 ? ` (${sensor.reasonCodes.join(", ")})` : ""}`),
  ].filter(Boolean).join(" / ");
  return { label, hint: hint || undefined };
}

function alertDetail(alert: ActiveAlert) {
  const base = alert.health
    ? `${alert.health.componentName} ${deviceLabel(alert.health.state)}`
    : alert.detail;
  const reasonSummary = alert.health ? formatMonitoringReasonSummary(alert.health.reasonCodes) : null;
  const summary = reasonSummary ? `${base} (${reasonSummary})` : base;
  if (alert.startedAt === undefined) return summary;
  return `${summary}, ${alert.startedAt === null ? "시작 정보 없음" : `서버 최초 확인 ${alert.startedAt.slice(5)}`}`;
}

function alertHint(alert: ActiveAlert) {
  if (!alert.health) return undefined;
  const reasons = formatMonitoringReasonDetails(alert.health.reasonCodes);
  return [
    `${componentKindLabel(alert.health.componentKind)} (${alert.health.componentId})`,
    `상태 ${deviceLabel(alert.health.state)} (${alert.health.state})`,
    `근거 ${evidenceSourceLabel(alert.health.evidenceSource)} (${alert.health.evidenceSource})`,
    reasons.length > 0 ? `사유 ${reasons.join(", ")}` : "",
  ].filter(Boolean).join(" / ");
}

function formatOptionalTimestamp(value: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? seoulDisplayText(parsed) : value;
}

function renderDetailReasons(codes: readonly string[], emptyText: string) {
  if (codes.length === 0) return emptyText;
  const items = formatMonitoringReasonDetails(codes);
  if (items.length === 1) return items[0];
  return <ul className="monitoring-detail-reasons">{items.map((item) => <li key={item}>{item}</li>)}</ul>;
}

function deviceLabel(value: string) {
  return Object.hasOwn(deviceStateLabels, value) ? deviceStateLabels[value] : value;
}

function formatDeviceTimestamp(value: string): string {
  if (!value || value === missingValue) return missingValue;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  const kst = seoulDateTime(parsed);
  return `${kst.slice(5, 7)}.${kst.slice(8, 10)} ${kst.slice(11, 19)}`;
}

function formatDeviceTimestampTitle(value: string): string | undefined {
  if (!value || value === missingValue) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? seoulDisplayText(parsed) : value;
}

export function MonitoringPage({ data, dataSource }: { data: DashboardData; dataSource: DashboardDataSource }) {
  const { monitoring, session } = data;
  const state = monitoring.v2;
  const [alertPage, setAlertPage] = useState(0);
  const [videoOpen, setVideoOpen] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState<AlertRow | null>(null);
  const cameraDisplay = useCameraStatus(dataSource, session?.user.id ?? null);
  const closeDialog = useCallback(() => setVideoOpen(false), []);
  const closeAlertDetail = useCallback(() => setSelectedAlert(null), []);
  const modalRef = useModalFocus<HTMLDivElement>(videoOpen, closeDialog);
  const alarmState = state?.streamState === "reconnecting" && monitoring.alarmState ? "UNKNOWN" : monitoring.alarmState;
  const alarmLabel = alarmState ? alarmPresentation[alarmState] : "미지원";
  const alertsState = state?.streamState === "reconnecting" ? null : monitoring.activeAlertsState ?? null;
  const alertsKnown = !state || alertsState !== null;
  const alertsUndetermined = alertsState?.evaluationState === "UNKNOWN" || alertsState?.evaluationState === "ERROR";
  const unconfirmed = (alertsKnown ? alertsState?.coverage ?? [] : []).filter((entry) => entry.state !== "CHECKED");
  // 확인 불가 안내 행은 활성 알림 뒤에 같은 페이지 방식으로 이어 붙이며 카드 크기를 바꾸지 않는다.
  const rows: AlertRow[] = [
    ...(alertsKnown ? monitoring.alerts : []).map((alert) => ({ alert })),
    ...(state && alertsState && alertsUndetermined ? [{
      notice: {
        id: "fill-undetermined",
        title: "적재율 경보",
        detail: alertsState.basis?.lastKnownState ? `적재율 판정 불가 (마지막 판정 ${alarmStateLabel(alertsState.basis.lastKnownState)})` : "적재율 판정 불가",
        hint: formatMonitoringReasonDetails(alertsState.reasonCodes).join(", "),
        reasonCodes: alertsState.reasonCodes,
      },
    }] : []),
    ...unconfirmed.map((entry) => ({
      notice: {
        id: `coverage-${entry.componentKind}-${entry.componentId ?? ""}`,
        title: entry.componentName,
        detail: coverageDetail(entry),
        hint: formatMonitoringReasonDetails(entry.reasonCodes).join(", "),
        reasonCodes: entry.reasonCodes,
      },
    })),
  ];
  const totalAlertPages = Math.max(1, Math.ceil(rows.length / alertsPerPage));
  const currentAlertPage = Math.min(alertPage, totalAlertPages - 1);
  const visibleRows = rows.slice(currentAlertPage * alertsPerPage, (currentAlertPage + 1) * alertsPerPage);
  const activeCount = alertsKnown ? monitoring.alerts.length : 0;
  const alertsReconnecting = state?.streamState === "reconnecting";
  const alertsLoading = !alertsReconnecting && monitoring.activeAlertsAreaState?.status === "loading";
  const alertCount = !state ? `${monitoring.alerts.length}건` : !alertsState ? alertsLoading ? "확인 중" : "확인 불가"
    : `${activeCount}건${unconfirmed.length > 0 ? ` / 확인 불가 ${unconfirmed.length}` : ""}`;
  const alertEmptyMessage = !state ? "활성 알림이 없습니다."
    : !alertsState ? alertsReconnecting ? "실시간 연결이 복구되면 활성 알림을 다시 표시합니다."
      : alertsLoading ? "활성 알림을 확인하고 있습니다." : "활성 알림을 불러오지 못했습니다."
    : alertsState.evaluationState === "WARNING" ? "사전 경보가 꺼져 있어 표시할 항목이 없습니다."
    : "현재 활성 알림이 없습니다.";
  const layoutState = state ? layoutPresentation(monitoring.measurementLayout) : null;
  const formattedLoadPercent = monitoring.summary.loadPercent === null ? null : formatLoadPercent(monitoring.summary.loadPercent);
  const valueLength = formattedLoadPercent?.length ?? 0;
  const isLoadHistoryLoading = monitoring.loadHistoryState?.status === "loading";
  const pastLoad = monitoring.summary.loadOneHourAgo;
  const pastLoadTitle = !isLoadHistoryLoading && pastLoad
    ? `관측 시각: ${seoulDisplayText(Date.parse(pastLoad.observedAt))}. ${pastLoad.dataState === "LIMITED" ? "제한된 데이터. " : ""}1시간 전 기준 시각 이전 1분 이내의 서버 이력입니다.`
    : undefined;
  const mismatch = alertsState?.mismatch;
  const mismatchTitle = mismatch
    ? [`현재 판정 ${alarmStateLabel(mismatch.snapshotState)}, 활성 알림 ${alarmStateLabel(mismatch.alertState)}`,
      mismatch.measuredAt ? `측정 시각: ${seoulDisplayText(Date.parse(mismatch.measuredAt))}` : "측정 시각 없음",
      mismatch.lastEvaluatedAt ? `평가 시각: ${seoulDisplayText(Date.parse(mismatch.lastEvaluatedAt))}` : "평가 시각 없음",
      mismatch.reasonCodes.length > 0 ? `사유: ${mismatch.reasonCodes.join(", ")}` : ""].filter(Boolean).join(" / ")
    : undefined;
  const basisTitle = alertsState?.basis?.measuredAt
    ? `적재율 판정 근거 측정 시각: ${seoulDisplayText(Date.parse(alertsState.basis.measuredAt))}`
    : undefined;

  return <DashboardPageShell activePage="monitoring" dataSource={dataSource} headerNotifications={monitoring.headerNotifications} headerUnreadCount={monitoring.unreadNotificationCount} notificationState={monitoring.notificationState} session={session}>
    <main className="monitoring-page" aria-label="스크랩 모니터링 대시보드">
      <div className="page-heading">
        <PageTitle>스크랩 모니터링</PageTitle>
        <DataReceptionMeta reception={data.reception} />
      </div>
      <div className="content">
        <div className="monitoring-grid">
          <section className="card top-card span-4 kpi-card">
            <div className="monitoring-card-title"><SectionTitle>현재 상태</SectionTitle></div>
            <div className="kpi-content">
              <p className="kpi-label" title={monitoring.summary.loadHold ? `마지막 정상 관측 ${seoulDisplayText(Date.parse(monitoring.summary.loadHold.observedAt))}을 최대 10초 표시합니다` : state?.filterState === "WARMING" ? "시간 필터가 준비되는 동안의 값" : undefined}>{formatKpiLabel(state?.filterState, Boolean(monitoring.summary.loadHold))}</p>
              <div className={`kpi-value${formattedLoadPercent === null ? " unavailable-value" : valueLength > 5 ? " precise-value" : ""}`} style={valueLength > 5 ? { fontSize: Math.min(76, 500 / valueLength) } : undefined}>{formattedLoadPercent === null ? "판단 불가" : <>{formattedLoadPercent}<span>%</span></>}</div>
              {formattedLoadPercent === null
                ? <div className="progress-unavailable">{state?.streamState === "reconnecting" && <span role="status">실시간 연결 재연결 중</span>}</div>
                : <div className="progress" aria-label={`추정 적재율 ${formattedLoadPercent}%`}><div style={{ width: `${monitoring.summary.loadPercent}%` }} /></div>}
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
                  <strong>{state?.streamState === "reconnecting" ? "정보 없음" : monitoring.summary.expectedArrivalAt}</strong>
                  <span className="remaining-time">남은 시간 {state?.streamState === "reconnecting" ? "정보 없음" : monitoring.summary.remainingTime}</span>
                </div>
              </div>
              <div className="status-details">
                <div className="mini-stat"><span className="label">1시간 전 적재율</span><strong title={pastLoadTitle}>{isLoadHistoryLoading ? "확인 중" : pastLoad ? `${pastLoad.value}%` : "정보 없음"}</strong></div>
                <div className="mini-stat"><span className="label">최근 수거 후 경과</span><strong>{monitoring.summary.timeSinceCollection}</strong></div>
                <div className="mini-stat"><span className="label">평균 수거 주기</span><strong>{monitoring.summary.averageCollectionCycle}</strong></div>
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
            <div className="monitoring-card-title"><SectionTitle>측정 영역</SectionTitle>{layoutState && <span className="measurement-layout-state" title={layoutState.hint}>{layoutState.label}</span>}</div>
            <MeasurementDiagram lidar1Color="#1677e8" lidar2Color="#0ba58f" />
          </section>
          <section className="card chart-card span-4">
            <div className="chart-title-row">
              <SectionTitle>최근 24시간 적재율</SectionTitle>
              <div className="chart-legend" aria-label="최근 24시간 적재율 범례">
                <span><i className="history-legend-line" />{state ? "현재 임계율" : "수거 임계율"} {monitoring.summary.collectionThreshold}%</span>
              </div>
            </div>
            <LoadChart samples={monitoring.loadHistory} threshold={monitoring.summary.collectionThreshold} state={monitoring.loadHistoryState} thresholdKind={state ? "current" : undefined} />
          </section>
          {(v1MonitoringEnabled || state) && monitoring.lidarProfiles.length > 0 && state?.streamState !== "reconnecting"
            ? monitoring.lidarProfiles.map((profile) => <ProfileChart key={profile.label} {...profile} />)
            : ["LiDAR 1", "LiDAR 2"].map((label) => state
              ? <UnsupportedChart key={label} label={label} statusLabel="정보 없음" reason="현재 높이 곡선을 확인할 수 없습니다." />
              : <UnsupportedChart key={label} label={label} reason="API에서 LiDAR profile을 제공하지 않습니다." />)}
          <section className="card alerts-card span-4" title={basisTitle}>
            <div className="card-head">
              <div className="monitoring-card-title">
                <SectionTitle>활성 알림</SectionTitle>
                {mismatch && <span className="measurement-layout-state" title={mismatchTitle}>현재 판정과 활성 알림 판정이 다름</span>}
              </div>
              <span className="alert-count" title={basisTitle}>{alertCount}</span>
            </div>
            <div className="active-alert-list">
              {visibleRows.length > 0 ? visibleRows.map((row) => "alert" in row
                ? <div className="active-alert" key={row.alert.id} title={alertHint(row.alert)}>
                  <button className="detail-trigger active-alert-trigger" type="button" aria-haspopup="dialog" onClick={() => setSelectedAlert(row)}>
                    <strong className={`alert-${row.alert.level}`}>{row.alert.title}</strong><span>{alertDetail(row.alert)}</span>
                  </button><time>{row.alert.time}</time>
                </div>
                : <div className="active-alert" key={row.notice.id} title={row.notice.hint || undefined}>
                  <button className="detail-trigger active-alert-trigger" type="button" aria-haspopup="dialog" onClick={() => setSelectedAlert(row)}>
                    <strong className="alert-unconfirmed">{row.notice.title}</strong><span>{row.notice.detail}</span>
                  </button>
                </div>) : <p className="collection-empty">{alertEmptyMessage}</p>}
            </div>
            <Pagination ariaLabel="활성 알림 페이지" currentPage={currentAlertPage} itemLabel="알림" onPageChange={setAlertPage} totalPages={totalAlertPages} />
          </section>
          <section className="card devices-card span-8">
            <SectionTitle>장비 상태</SectionTitle>
            <div className="device-grid">
              {monitoring.devices.length ? monitoring.devices.map((device, index) => {
                const isCamera = device.label === "카메라" && cameraDisplay;
                const status = isCamera ? cameraDisplay.status : device.status;
                const statusText = isCamera
                  ? cameraDisplay.statusText
                  : device.statusLabel ? deviceLabel(device.statusLabel) : deviceLabels[device.status];
                const title = isCamera ? cameraDisplay.title : deviceStatusTitle(device.statusLabel, device.reasonCodes);
                const reasonSummary = formatMonitoringReasonSummary(device.reasonCodes ?? []);
                const reasonDetails = formatMonitoringReasonDetails(device.reasonCodes ?? []);
                const reasonRow = {
                  label: "상태",
                  value: reasonSummary ?? (status === "normal" ? "정상" : "정보 없음"),
                  title: reasonDetails.length > 0 ? reasonDetails.join("\n") : undefined,
                };
                const deviceRows: Array<{ label: string; value: string; title?: string }> = isCamera
                  ? [
                    { label: "연결 상태", value: cameraDisplay.connectionText },
                    { label: "프레임 수신", value: cameraDisplay.frameReceivedText, title: cameraDisplay.frameReceivedTitle },
                    { label: "상태", value: cameraDisplay.reasonText, title: cameraDisplay.reasonTitle },
                  ]
                  : device.label === "카메라"
                    ? [
                      { label: "연결 상태", value: state ? "확인 중" : (device.status === "normal" ? "연결됨" : "확인 불가") },
                      { label: "프레임 수신", value: formatDeviceTimestamp(device.received), title: formatDeviceTimestampTitle(device.received) },
                      reasonRow,
                    ]
                    : device.label === "엣지 장비"
                      ? [
                        { label: "연결 상태", value: state ? (state.connectionState === "REPORTING" ? "보고 중" : "확인 불가") : (device.status === "normal" ? "연결됨" : "확인 불가") },
                        { label: "최근 보고", value: formatDeviceTimestamp(device.received), title: formatDeviceTimestampTitle(device.received) },
                        reasonRow,
                      ]
                      : [
                        { label: "최근 스캔", value: formatDeviceTimestamp(device.received), title: formatDeviceTimestampTitle(device.received) },
                        reasonRow,
                      ];
                return (
                  <div className="device" key={`${index}-${device.label}`}>
                    <div className="device-head">
                      <span className="device-name" title={device.label}>{device.label}</span>
                      <span className={`status-text ${deviceTones[status]}`} title={title}>{statusText}</span>
                    </div>
                    <dl className="device-details">
                      {deviceRows.map((entry) => (
                        <div key={entry.label}>
                          <dt>{entry.label}</dt>
                          <dd title={entry.title}>{entry.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                );
              }) : <p className="collection-empty">등록된 장비 상태가 없습니다.</p>}
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
    {selectedAlert && <DetailDialog
      id="active-alert-detail-title"
      title={"alert" in selectedAlert ? selectedAlert.alert.title : selectedAlert.notice.title}
      onClose={closeAlertDetail}
    >
      <dl className="monitoring-detail-list">
        {"alert" in selectedAlert ? (
          selectedAlert.alert.health ? <>
            <div><dt>대상</dt><dd>{`${selectedAlert.alert.health.componentName} (${selectedAlert.alert.health.componentId})`}</dd></div>
            <div><dt>현재 상태</dt><dd>{`${deviceLabel(selectedAlert.alert.health.state)} (${selectedAlert.alert.health.state})`}</dd></div>
            <div><dt>판정 근거</dt><dd>{`${evidenceSourceLabel(selectedAlert.alert.health.evidenceSource)} (${selectedAlert.alert.health.evidenceSource})`}</dd></div>
            <div><dt>상세 사유</dt><dd>{renderDetailReasons(selectedAlert.alert.health.reasonCodes, "세부 사유 코드가 함께 전달되지 않았습니다.")}</dd></div>
            <div><dt>서버 최초 확인</dt><dd>{selectedAlert.alert.startedAt === undefined ? "미제공" : selectedAlert.alert.startedAt === null ? "시작 정보 없음" : selectedAlert.alert.startedAt}</dd></div>
            <div><dt>표시 시각</dt><dd>{selectedAlert.alert.time}</dd></div>
            {selectedAlert.alert.validUntilAt && <div><dt>유효 기한</dt><dd>{formatOptionalTimestamp(selectedAlert.alert.validUntilAt)}</dd></div>}
          </> : <>
            <div><dt>내용</dt><dd>{selectedAlert.alert.detail}</dd></div>
            <div><dt>등급</dt><dd>{selectedAlert.alert.level === "error" ? "위험" : selectedAlert.alert.level === "warning" ? "경고" : "안내"}</dd></div>
            {selectedAlert.alert.startedAt !== undefined && <div><dt>서버 최초 확인</dt><dd>{selectedAlert.alert.startedAt === null ? "시작 정보 없음" : selectedAlert.alert.startedAt}</dd></div>}
            <div><dt>표시 시각</dt><dd>{selectedAlert.alert.time}</dd></div>
          </>
        ) : <>
          <div><dt>내용</dt><dd>{selectedAlert.notice.detail}</dd></div>
          <div><dt>상세 사유</dt><dd>{renderDetailReasons(selectedAlert.notice.reasonCodes, "세부 사유 코드가 함께 전달되지 않았습니다.")}</dd></div>
        </>}
      </dl>
    </DetailDialog>}
  </DashboardPageShell>;
}
