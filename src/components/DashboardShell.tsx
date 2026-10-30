import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { applicationVersion } from "../application-version";
import { ROUTES, hasAuthenticationSession } from "../app-routing";
import type { DashboardDataSource } from "../data/dashboard-data-source";
import type { DataAreaState, HeaderNotification, UserSession } from "../domain/dashboard";
import { useModalFocus } from "../use-modal-focus";
import { BellIcon, UserIcon } from "./DashboardPrimitives";
import { loadHeaderPopovers } from "./header-popovers-loader";

export type DashboardPage = "monitoring" | "history" | "recordings" | "admin";

function ChevronIcon() {
  return (
    <svg className="icon chevron-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m8 10 4 4 4-4" />
    </svg>
  );
}

function HeaderPopoverPlaceholder({
  error = false,
  label,
  onClose,
  onRetry,
  panelClass,
  triggerSelector,
}: {
  error?: boolean;
  label: string;
  onClose: () => void;
  onRetry?: () => void;
  panelClass: "notifications-popover" | "user-popover";
  triggerSelector: ".notification-button" | ".user-menu";
}) {
  const modalRef = useModalFocus<HTMLElement>(true, onClose, `.${panelClass}`);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!modalRef.current?.contains(target) && !(target instanceof Element && target.closest(triggerSelector))) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [modalRef, onClose, triggerSelector]);

  return (
    <section className={`header-popover ${panelClass}`} aria-label={error ? `${label} 안내` : `${label} 불러오는 중`} ref={modalRef}>
      <div className={`header-popover-status${error ? " error" : ""}`} role={error ? "alert" : "status"}>
        {error ? (
          <>
            <p>메뉴를 불러오지 못했습니다.</p>
            {onRetry && <button type="button" onClick={onRetry}>다시 시도</button>}
          </>
        ) : (
          <p>불러오는 중...</p>
        )}
      </div>
    </section>
  );
}

export function DashboardHeader({ activePage, dataSource, initialNotifications, initialUnreadCount, notificationState: notificationQueryState, session, sessionPending = false }: {
  activePage: DashboardPage;
  dataSource?: DashboardDataSource;
  initialNotifications: HeaderNotification[];
  initialUnreadCount?: number | null;
  notificationState?: DataAreaState;
  session?: UserSession | null;
  sessionPending?: boolean;
}) {
  const notificationVersion = `${initialUnreadCount === null ? "unknown" : initialUnreadCount ?? "derived"}:${initialNotifications.map((notification) => `${notification.id}:${notification.read}`).join("|")}`;
  const serverNotificationState = {
    readIds: new Set(initialNotifications.filter((notification) => notification.read).map((notification) => notification.id)),
    unreadCount: initialUnreadCount === null ? null : initialUnreadCount ?? initialNotifications.filter((notification) => !notification.read).length,
    version: notificationVersion,
  };
  const [localNotificationState, setLocalNotificationState] = useState(serverNotificationState);
  const notificationState = localNotificationState.version === notificationVersion
    ? localNotificationState
    : serverNotificationState;
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [popovers, setPopovers] = useState<Awaited<ReturnType<typeof loadHeaderPopovers>> | null>(null);
  const [popoverError, setPopoverError] = useState(false);
  const mountedRef = useRef(true);
  const isAuthenticated = session === undefined ? hasAuthenticationSession() : session !== null;
  const canManage = !sessionPending && (session === undefined ? hasAuthenticationSession() : session?.user.role === "administrator");
  const serverDisplayName = session?.user.displayName;
  const displayName = session?.user.role === "viewer" && serverDisplayName === "현장 운영자" ? "조회 사용자" : serverDisplayName ?? "관리자";

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const requestPopovers = useCallback(() => {
    if (popovers) return;
    setPopoverError(false);
    void loadHeaderPopovers()
      .then((module) => {
        if (mountedRef.current) {
          setPopovers(module);
          setPopoverError(false);
        }
      })
      .catch(() => {
        if (mountedRef.current) {
          setPopoverError(true);
        }
      });
  }, [popovers]);

  // 알림과 사용자 메뉴 패널은 첫 화면 렌더링 뒤에 별도 모듈로 불러온다.
  useEffect(() => {
    if (sessionPending || !isAuthenticated) return undefined;
    let current = true;
    void loadHeaderPopovers().then((module) => { if (current) setPopovers(module); }, () => undefined);
    return () => { current = false; };
  }, [isAuthenticated, sessionPending]);

  const toggleNotifications = () => {
    const next = !notificationsOpen;
    setNotificationsOpen(next);
    setUserMenuOpen(false);
    if (next && !popovers) requestPopovers();
  };

  const toggleUserMenu = () => {
    const next = !userMenuOpen;
    setUserMenuOpen(next);
    setNotificationsOpen(false);
    if (next && !popovers) requestPopovers();
  };

  return (
    <header className="topbar">
      <a className="brand" href={ROUTES.monitoring} aria-label="AJIN SCRAP MONITORING 홈"><span className="brand-mark" aria-hidden="true" /><span>AJIN SCRAP MONITORING</span></a>
      <nav className="global-nav" aria-label="주요 메뉴" aria-hidden={sessionPending || undefined}>
        {!sessionPending && ([["monitoring", "현황"], ["history", "이력"], ["recordings", "녹화 영상"], ["admin", "관리자"]] as const).filter(([page]) => page !== "admin" || canManage).map(([page, label]) => <a key={page} className={`nav-link ${activePage === page ? "active" : ""}`} href={ROUTES[page]} aria-current={activePage === page ? "page" : undefined}>{label}</a>)}
      </nav>
      {sessionPending ? <div className="user-tools" aria-hidden="true" /> : isAuthenticated ? <div className="user-tools"><div className="header-popover-anchor">
        <button className="icon-button notification-button" type="button" aria-label={notificationState.unreadCount === null ? "알림 조회 실패" : `알림 ${notificationState.unreadCount}건`} aria-expanded={notificationsOpen} onClick={toggleNotifications}>
          <BellIcon />{(notificationState.unreadCount === null || notificationState.unreadCount > 0) && <span className="notification-badge">{notificationState.unreadCount ?? "?"}</span>}
        </button>
        {notificationsOpen && (popovers ? <popovers.NotificationsPopover
          dataSource={dataSource}
          initialNotifications={initialNotifications}
          localState={notificationState}
          onClose={() => setNotificationsOpen(false)}
          onStateChange={(next) => setLocalNotificationState({ ...next, version: notificationVersion })}
          queryState={notificationQueryState}
        /> : <HeaderPopoverPlaceholder
          error={popoverError}
          label="최근 알림"
          onClose={() => setNotificationsOpen(false)}
          onRetry={requestPopovers}
          panelClass="notifications-popover"
          triggerSelector=".notification-button"
        />)}
      </div><span className="tool-divider" aria-hidden="true" /><div className="header-popover-anchor"><button className="user-menu" type="button" aria-label="사용자 메뉴" aria-expanded={userMenuOpen} onClick={toggleUserMenu}><UserIcon /><span title={displayName}>{displayName}</span><ChevronIcon /></button>{userMenuOpen && (popovers ? <popovers.UserPopover
        dataSource={dataSource}
        displayName={displayName}
        onClose={() => setUserMenuOpen(false)}
        role={session?.user.role}
      /> : <HeaderPopoverPlaceholder
        error={popoverError}
        label="사용자 메뉴"
        onClose={() => setUserMenuOpen(false)}
        onRetry={requestPopovers}
        panelClass="user-popover"
        triggerSelector=".user-menu"
      />)}</div></div> : <div className="user-tools"><a className="header-login-link" href={ROUTES.login}>로그인</a></div>}
    </header>
  );
}

export function ApplicationFooter() {
  return <footer className="app-footer"><span>Copyright 2026 AJIN INDUSTRIAL. All rights reserved.</span><span>Version {applicationVersion}</span></footer>;
}

export function DashboardPageShell({ activePage, children, dataSource, headerNotifications, headerUnreadCount, notificationState, session }: {
  activePage: DashboardPage;
  children: ReactNode;
  dataSource?: DashboardDataSource;
  headerNotifications: HeaderNotification[];
  headerUnreadCount?: number | null;
  notificationState?: DataAreaState;
  session?: UserSession | null;
}) {
  return (
    <div className="app-shell">
      <DashboardHeader activePage={activePage} dataSource={dataSource} initialNotifications={headerNotifications} initialUnreadCount={headerUnreadCount} notificationState={notificationState} session={session} />
      {children}
      <ApplicationFooter />
    </div>
  );
}
