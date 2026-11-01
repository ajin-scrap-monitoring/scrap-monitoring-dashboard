import { lazy, Suspense, useEffect, useState } from "react";

import { getNavigationType, getRememberedScroll, useAppLocation, type AppLocation } from "./app-router";
import { ROUTES } from "./app-routing";
import { ApplicationFooter, DashboardHeader, type DashboardPage } from "./components/DashboardShell";
import { DashboardStatePage } from "./components/DashboardStatePage";
import type { DashboardDataSource } from "./data/dashboard-data-source";
import { ApiError } from "./data/http-dashboard-data-source";
import { useDashboardData } from "./data/use-dashboard-data";
import { useRouteData } from "./data/use-route-data";
import { getLoadedPageModule } from "./page-loaders";
import { usePageModule } from "./use-page-module";
import { MonitoringPage } from "./pages/MonitoringPage";
import "./App.css";

const LoginPage = lazy(() => import("./pages/LoginPage").then(module => ({ default: module.LoginPage })));
const loginPage = (dataSource: DashboardDataSource) => <Suspense fallback={<main className="login-page" aria-label="로그인 화면 준비 중" aria-busy="true" />}><LoginPage dataSource={dataSource} /></Suspense>;

function RouteView({ children, routeKey }: { children: React.ReactNode; routeKey: string }) {
  useEffect(() => {
    const navType = getNavigationType();
    if (navType === "popstate") {
      const { x, y } = getRememberedScroll();
      window.scrollTo(x, y);
    } else {
      window.scrollTo(0, 0);
      const heading = document.querySelector<HTMLElement>("main .page-heading h1");
      heading?.focus({ preventScroll: true });
    }
  }, [routeKey]);

  return <>{children}</>;
}

export function App({ dataSource }: { dataSource: DashboardDataSource }) {
  const location = useAppLocation();
  if (location.pathname === ROUTES.login) return loginPage(dataSource);

  return <DashboardApplication dataSource={dataSource} location={location} />;
}

function DashboardApplication({ dataSource, location }: { dataSource: DashboardDataSource; location: AppLocation }) {
  const activePage: DashboardPage = location.pathname === ROUTES.history
    ? "history"
    : location.pathname === ROUTES.recordings
      ? "recordings"
      : location.pathname === ROUTES.admin
        ? "admin"
        : "monitoring";

  const { error: moduleError, isLoading: isModuleLoading, reload: reloadModule } = usePageModule(activePage);

  const { data: dashboardData, error: dashboardError, reload: reloadApp } = useDashboardData(dataSource);
  const isAppReady = dashboardData !== null;

  const isInternalNavigation = location.hasNavigated;
  const revalidateSession = isInternalNavigation && activePage === "admin";

  const {
    data: routeData,
    error: routeError,
    isLoading: isRouteLoading,
    reload: reloadRoute,
  } = useRouteData({
    dataSource,
    fallbackData: dashboardData,
    isAppReady,
    revalidateSession,
    route: activePage,
    search: location.search,
    sessionUserId: dashboardData?.session?.user.id,
  });

  const requiresMonitoringDetails = activePage === "monitoring" && typeof dataSource.activateMonitoringDetails === "function";
  const [detailsReadySource, setDetailsReadySource] = useState<{ source: DashboardDataSource; page: DashboardPage } | null>(null);

  useEffect(() => {
    if (!requiresMonitoringDetails || !isAppReady) return;
    let active = true;
    const activation = dataSource.activateMonitoringDetails!();
    void activation.ready.then(() => {
      if (active) setDetailsReadySource({ source: dataSource, page: activePage });
    });
    return () => {
      active = false;
      setDetailsReadySource(null);
      activation.release();
    };
  }, [activePage, dataSource, isAppReady, requiresMonitoringDetails]);

  const monitoringDetailsReady = !requiresMonitoringDetails
    || dataSource.isMonitoringDetailsReady?.() === true
    || (detailsReadySource?.source === dataSource && detailsReadySource?.page === activePage);

  const reception = dashboardData?.reception ?? { status: "waiting" as const, lastReceivedAt: null };

  const statePageFooter = <ApplicationFooter />;
  const pendingPageHeader = <DashboardHeader activePage={activePage} sessionPending initialNotifications={[]} />;
  const statePageHeader = <DashboardHeader activePage={activePage} dataSource={dataSource} sessionPending={dashboardData === null} session={dashboardData?.session} initialNotifications={dashboardData?.monitoring.headerNotifications ?? []} initialUnreadCount={dashboardData?.monitoring.unreadNotificationCount} notificationState={dashboardData?.monitoring.notificationState} />;
  const loadingHeader = isInternalNavigation ? statePageHeader : pendingPageHeader;

  const activeError = dashboardError ?? moduleError ?? routeError;
  const isPending = dashboardData === null
    || isModuleLoading
    || (activePage === "monitoring" ? !monitoringDetailsReady : isRouteLoading);

  const routeKey = `${location.pathname}${location.search}`;

  if (activeError) {
    const status = activeError instanceof ApiError ? activeError.status : undefined;
    const description = status === 401 ? "로그인 세션이 만료되었습니다. 다시 로그인하세요."
      : status === 403 ? "이 데이터를 조회할 권한이 없습니다. 계정 권한을 확인하세요."
        : activeError instanceof ApiError && activeError.code === "MONITORING_SOURCE_NOT_CONFIGURED" ? "Backend의 pit 연결 설정을 확인하세요."
          : "데이터 연결 상태를 확인한 뒤 다시 시도하세요.";
    return <DashboardStatePage title={status === 403 ? "접근 권한이 없습니다." : "데이터를 불러올 수 없습니다."} description={description} onRetry={dashboardError ? reloadApp : moduleError ? reloadModule : reloadRoute} header={statePageHeader} footer={statePageFooter} reception={{ ...reception, status: "error" }} />;
  }

  if (isPending) {
    return <DashboardStatePage title="데이터를 불러오는 중입니다." description="최신 모니터링 데이터를 준비하고 있습니다." header={loadingHeader} footer={statePageFooter} reception={dashboardData ? reception : undefined} />;
  }

  const { monitoring } = dashboardData;

  if (location.pathname === ROUTES.admin && dashboardData.session === null) {
    window.history.replaceState(null, "", ROUTES.login);
    return loginPage(dataSource);
  }
  if (location.pathname === ROUTES.admin && dashboardData.session?.user.role !== "administrator") {
    return <DashboardStatePage title="접근 권한이 없습니다." description="관리자 권한이 있는 계정으로 로그인하세요." header={statePageHeader} footer={statePageFooter} />;
  }

  if (location.pathname === ROUTES.recordings) { const { RecordingsPage } = getLoadedPageModule("recordings")!; return <RouteView routeKey={routeKey}><RecordingsPage key={routeKey} dataSource={dataSource} recordings={routeData?.recordings ?? []} recordingsState={routeData?.recordingsState ?? dashboardData.recordingsState} recordingsSource={routeData?.recordingsSource ?? dashboardData.recordingsSource} recordingsList={routeData?.recordingsList ?? dashboardData.recordingsList} recordingsTotal={routeData?.recordingsTotal ?? dashboardData.recordingsTotal} serverTime={monitoring.v2?.serverTime} headerNotifications={monitoring.headerNotifications} headerUnreadCount={monitoring.unreadNotificationCount} headerNotificationState={monitoring.notificationState} reception={reception} queryEndsAt={routeData?.history?.endsAt ?? dashboardData.history.endsAt} session={dashboardData.session} /></RouteView>; }
  if (location.pathname === ROUTES.history) { const { HistoryPage } = getLoadedPageModule("history")!; return <RouteView routeKey={routeKey}><HistoryPage key={routeKey} dataSource={dataSource} history={routeData?.history ?? dashboardData.history} headerNotifications={monitoring.headerNotifications} headerUnreadCount={monitoring.unreadNotificationCount} headerNotificationState={monitoring.notificationState} reception={reception} session={dashboardData.session} /></RouteView>; }
  if (location.pathname === ROUTES.admin) { const { AdminPage } = getLoadedPageModule("admin")!; return <RouteView routeKey={routeKey}><AdminPage key={routeKey} admin={routeData?.admin ?? dashboardData.admin} dataSource={dataSource} headerNotifications={monitoring.headerNotifications} headerUnreadCount={monitoring.unreadNotificationCount} headerNotificationState={monitoring.notificationState} session={dashboardData.session} /></RouteView>; }
  if (!monitoring.v2 && monitoring.status === "no-data") return <DashboardStatePage title="표시할 모니터링 데이터가 없습니다." description="조회 조건 또는 장비 데이터 수신 상태를 확인하세요." header={statePageHeader} footer={statePageFooter} />;

  return <RouteView routeKey={routeKey}><MonitoringPage key={routeKey} data={dashboardData} dataSource={dataSource} /></RouteView>;
}
