import { lazy, Suspense, useEffect } from "react";

import { ROUTES } from "./app-routing";
import { ApplicationFooter, DashboardHeader, type DashboardPage } from "./components/DashboardShell";
import { DashboardStatePage } from "./components/DashboardStatePage";
import type { DashboardDataSource } from "./data/dashboard-data-source";
import { ApiError } from "./data/http-dashboard-data-source";
import { useDashboardData } from "./data/use-dashboard-data";
import { MonitoringPage } from "./pages/MonitoringPage";
import "./App.css";

const loadAdminPage = () => import("./pages/AdminPage");
const loadHistoryPage = () => import("./pages/HistoryPage");
const loadRecordingsPage = () => import("./pages/RecordingsPage");
const LoginPage = lazy(() => import("./pages/LoginPage").then(module => ({ default: module.LoginPage })));
const AdminPage = lazy(loadAdminPage);
const HistoryPage = lazy(loadHistoryPage);
const RecordingsPage = lazy(loadRecordingsPage);
const loginPage = (dataSource: DashboardDataSource) => <Suspense fallback={<main className="login-page" aria-label="로그인 화면 준비 중" aria-busy="true" />}><LoginPage dataSource={dataSource} /></Suspense>;

export function App({ dataSource }: { dataSource: DashboardDataSource }) {
  if (window.location.pathname === ROUTES.login) return loginPage(dataSource);

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
  useEffect(() => {
    const load = activePage === "admin" ? loadAdminPage : activePage === "history" ? loadHistoryPage : activePage === "recordings" ? loadRecordingsPage : undefined;
    void load?.().catch(() => undefined);
  }, [activePage]);
  const { data: dashboardData, error: dashboardError, reload } = useDashboardData(dataSource);
  const reception = dashboardData?.reception ?? { status: "waiting" as const, lastReceivedAt: null };

  const statePageFooter = <ApplicationFooter />;
  const pendingPageHeader = <DashboardHeader activePage={activePage} sessionPending initialNotifications={[]} />;
  const statePageHeader = <DashboardHeader activePage={activePage} dataSource={dataSource} sessionPending={dashboardData === null} session={dashboardData?.session} initialNotifications={dashboardData?.monitoring.headerNotifications ?? []} initialUnreadCount={dashboardData?.monitoring.unreadNotificationCount} notificationState={dashboardData?.monitoring.notificationState} />;
  if (dashboardError) {
    const status = dashboardError instanceof ApiError ? dashboardError.status : undefined;
    const description = status === 401 ? "로그인 세션이 만료되었습니다. 다시 로그인하세요."
      : status === 403 ? "이 데이터를 조회할 권한이 없습니다. 계정 권한을 확인하세요."
        : dashboardError instanceof ApiError && dashboardError.code === "MONITORING_SOURCE_NOT_CONFIGURED" ? "Backend의 pit 연결 설정을 확인하세요."
          : "데이터 연결 상태를 확인한 뒤 다시 시도하세요.";
    return <DashboardStatePage title={status === 403 ? "접근 권한이 없습니다." : "데이터를 불러올 수 없습니다."} description={description} onRetry={reload} header={statePageHeader} footer={statePageFooter} reception={{ ...reception, status: "error" }} />;
  }
  if (dashboardData === null) return <DashboardStatePage title="데이터를 불러오는 중입니다." description="최신 모니터링 데이터를 준비하고 있습니다." header={pendingPageHeader} footer={statePageFooter} />;

  const { admin, history, monitoring, recordings } = dashboardData;

  if (window.location.pathname === ROUTES.admin && dashboardData.session === null) {
    window.history.replaceState(null, "", ROUTES.login);
    return loginPage(dataSource);
  }
  if (window.location.pathname === ROUTES.admin && dashboardData.session?.user.role !== "administrator") {
    return <DashboardStatePage title="접근 권한이 없습니다." description="관리자 권한이 있는 계정으로 로그인하세요." header={statePageHeader} footer={statePageFooter} />;
  }
  const routeFallback = <DashboardStatePage title="화면을 불러오는 중입니다." description="요청한 화면을 준비하고 있습니다." header={pendingPageHeader} footer={statePageFooter} />;
  if (window.location.pathname === ROUTES.recordings) return <Suspense fallback={routeFallback}><RecordingsPage dataSource={dataSource} recordings={recordings} recordingsState={dashboardData.recordingsState} recordingsSource={dashboardData.recordingsSource} recordingsList={dashboardData.recordingsList} recordingsTotal={dashboardData.recordingsTotal} serverTime={monitoring.v2?.serverTime} headerNotifications={monitoring.headerNotifications} headerUnreadCount={monitoring.unreadNotificationCount} headerNotificationState={monitoring.notificationState} reception={reception} queryEndsAt={history.endsAt} session={dashboardData.session} /></Suspense>;
  if (window.location.pathname === ROUTES.history) return <Suspense fallback={routeFallback}><HistoryPage dataSource={dataSource} history={history} headerNotifications={monitoring.headerNotifications} headerUnreadCount={monitoring.unreadNotificationCount} headerNotificationState={monitoring.notificationState} reception={reception} session={dashboardData.session} /></Suspense>;
  if (window.location.pathname === ROUTES.admin) return <Suspense fallback={routeFallback}><AdminPage admin={admin} dataSource={dataSource} headerNotifications={monitoring.headerNotifications} headerUnreadCount={monitoring.unreadNotificationCount} headerNotificationState={monitoring.notificationState} session={dashboardData.session} /></Suspense>;
  if (!monitoring.v2 && monitoring.status === "no-data") return <DashboardStatePage title="표시할 모니터링 데이터가 없습니다." description="조회 조건 또는 장비 데이터 수신 상태를 확인하세요." header={statePageHeader} footer={statePageFooter} />;

  return <MonitoringPage data={dashboardData} dataSource={dataSource} />;
}
