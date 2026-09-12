import { lazy, Suspense, useCallback, useState } from "react";

import { ROUTES } from "./app-routing";
import cameraFrame from "./assets/camera-frame.png";
import { ApplicationFooter, DashboardHeader, DashboardPageShell, type DashboardPage } from "./components/DashboardShell";
import { DashboardStatePage } from "./components/DashboardStatePage";
import { DashboardStatusLabel, ExpandIcon, SectionTitle } from "./components/DashboardPrimitives";
import { LoadChart, MeasurementDiagram, ProfileChart } from "./components/MonitoringVisuals";
import { Pagination } from "./components/Pagination";
import { WhepVideo } from "./components/WhepVideo";
import type { DashboardDataSource } from "./data/dashboard-data-source";
import { useDashboardData } from "./data/use-dashboard-data";
import { LoginPage } from "./pages/LoginPage";
import { useModalFocus } from "./use-modal-focus";
import "./App.css";

const alertsPerPage = 4;
const AdminPage = lazy(() => import("./pages/AdminPage"));
const HistoryPage = lazy(() => import("./pages/HistoryPage"));
const RecordingsPage = lazy(() => import("./pages/RecordingsPage"));

export function App({ dataSource }: { dataSource: DashboardDataSource }) {
  if (window.location.pathname === ROUTES.login) return <LoginPage dataSource={dataSource} />;

  return <DashboardApplication dataSource={dataSource} />;
}

function DashboardApplication({ dataSource }: { dataSource: DashboardDataSource }) {
  const activePage: DashboardPage = window.location.pathname === ROUTES.history
    ? "history"
    : window.location.pathname === ROUTES.recordings
      ? "recordings"
      : window.location.pathname === ROUTES.admin
        ? "admin"
        : "monitoring";
  const [alertPage, setAlertPage] = useState(0);
  const [videoOpen, setVideoOpen] = useState(false);
  const closeVideo = useCallback(() => setVideoOpen(false), []);
  const videoModalRef = useModalFocus<HTMLDivElement>(videoOpen, closeVideo);
  const { data: dashboardData, error: dashboardError, reload } = useDashboardData(dataSource);

  const statePageFooter = <ApplicationFooter />;
  const statePageHeader = <DashboardHeader activePage={activePage} initialNotifications={[]} />;
  if (dashboardError) return <DashboardStatePage title="데이터를 불러올 수 없습니다." description="데이터 연결 상태를 확인한 뒤 다시 시도하세요." onRetry={reload} header={statePageHeader} footer={statePageFooter} />;
  if (dashboardData === null) return <DashboardStatePage title="데이터를 불러오는 중입니다." description="최신 모니터링 데이터를 준비하고 있습니다." header={statePageHeader} footer={statePageFooter} />;

  const { admin, history, lastMeasuredAt, monitoring, recordings } = dashboardData;
  const totalAlertPages = Math.max(1, Math.ceil(monitoring.alerts.length / alertsPerPage));
  const currentAlertPage = Math.min(alertPage, totalAlertPages - 1);
  const pageStart = currentAlertPage * alertsPerPage;
  const visibleAlerts = monitoring.alerts.slice(pageStart, pageStart + alertsPerPage);

  if (window.location.pathname === ROUTES.admin && dashboardData.session === null) {
    window.history.replaceState(null, "", ROUTES.login);
    return <LoginPage dataSource={dataSource} />;
  }
  const loadedHeader = <DashboardHeader activePage={activePage} dataSource={dataSource} initialNotifications={monitoring.headerNotifications} initialUnreadCount={monitoring.unreadNotificationCount} session={dashboardData.session} />;
  if (window.location.pathname === ROUTES.admin && dashboardData.session?.user.role !== "administrator") {
    return <DashboardStatePage title="접근 권한이 없습니다." description="관리자 권한이 있는 계정으로 로그인하세요." header={loadedHeader} footer={statePageFooter} />;
  }
  const routeFallback = <DashboardStatePage title="화면을 불러오는 중입니다." description="요청한 화면을 준비하고 있습니다." header={loadedHeader} footer={statePageFooter} />;
  if (window.location.pathname === ROUTES.recordings) return <Suspense fallback={routeFallback}><RecordingsPage dataSource={dataSource} recordings={recordings} headerNotifications={monitoring.headerNotifications} headerUnreadCount={monitoring.unreadNotificationCount} lastMeasuredAt={lastMeasuredAt} queryEndsAt={history.endsAt} session={dashboardData.session} status={monitoring.status} /></Suspense>;
  if (window.location.pathname === ROUTES.history) return <Suspense fallback={routeFallback}><HistoryPage dataSource={dataSource} history={history} headerNotifications={monitoring.headerNotifications} headerUnreadCount={monitoring.unreadNotificationCount} lastMeasuredAt={lastMeasuredAt} session={dashboardData.session} status={monitoring.status} /></Suspense>;
  if (window.location.pathname === ROUTES.admin) return <Suspense fallback={routeFallback}><AdminPage admin={admin} dataSource={dataSource} headerNotifications={monitoring.headerNotifications} headerUnreadCount={monitoring.unreadNotificationCount} session={dashboardData.session} /></Suspense>;
  if (monitoring.status === "no-data") return <DashboardStatePage title="표시할 모니터링 데이터가 없습니다." description="조회 조건 또는 장비 데이터 수신 상태를 확인하세요." header={loadedHeader} footer={statePageFooter} />;

  return (
    <DashboardPageShell activePage="monitoring" dataSource={dataSource} headerNotifications={monitoring.headerNotifications} headerUnreadCount={monitoring.unreadNotificationCount} session={dashboardData.session}>
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
                    <span className="pre-alert-summary">{monitoring.summary.preCollectionAlert.enabled ? `사전 알림 기준 ${monitoring.summary.preCollectionAlert.threshold}%` : "사전 알림 꺼짐"}</span>
                  </div>
                  <div className="mini-stat">
                    <span className="label">운영 상태</span>
                    <strong className="status-text ok">{monitoring.summary.operationState === "accumulating" ? "적재 중" : monitoring.summary.operationState === "collecting" ? "수거 중" : "대기"}</strong>
                  </div>
                  <div className="mini-stat">
                    <span className="label">예상 도달</span>
                    <strong>{monitoring.summary.expectedArrivalAt}</strong>
                    <span className="remaining-time">남은 시간 {monitoring.summary.remainingTime}</span>
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
                {videoOpen && monitoring.videoMode === "webrtc"
                  ? <img src={cameraFrame} alt="" />
                  : <WhepVideo alt="스크랩 적재 공간 실시간 영상" fallbackImage={cameraFrame} mode={monitoring.videoMode} status={monitoring.videoStatus} streamId={monitoring.videoStreamId} />}
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
                {visibleAlerts.length > 0 ? visibleAlerts.map((alert) => (
                  <div className="active-alert" key={alert.id}>
                    <div><strong className={`alert-${alert.level}`}>{alert.title}</strong><span>{alert.detail}</span></div>
                    <time>{alert.time}</time>
                  </div>
                )) : <p className="collection-empty">활성 알림이 없습니다.</p>}
              </div>
              <Pagination ariaLabel="활성 알림 페이지" currentPage={currentAlertPage} itemLabel="알림" onPageChange={setAlertPage} totalPages={totalAlertPages} />
            </section>
            <section className="card devices-card span-8">
              <SectionTitle>장비 상태</SectionTitle>
              <div className="device-grid">
                {monitoring.devices.length > 0 ? monitoring.devices.map((device) => (
                  <div className="device" key={device.label}>
                    <div>
                      <span className="device-name">{device.label}</span>
                      <span className={`status-text ${device.status === "normal" ? "ok" : device.status === "delayed" ? "warning" : "error"}`}>{device.status === "normal" ? "정상" : device.status === "delayed" ? "지연" : "수신 없음"}</span>
                      <span className="device-meta">최근 수신 {device.received}</span>
                      <span className="device-meta">지연 {device.latency}</span>
                    </div>
                  </div>
                )) : <p className="collection-empty">등록된 장비 상태가 없습니다.</p>}
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
              <WhepVideo alt="스크랩 적재 공간 실시간 영상 확대" fallbackImage={cameraFrame} mode={monitoring.videoMode} status={monitoring.videoStatus} streamId={monitoring.videoStreamId} />
              <span className="live-indicator">LIVE</span>
              <span className="live-time">{monitoring.videoTimestamp}</span>
            </div>
          </div>
        </div>
      )}
    </DashboardPageShell>
  );
}
