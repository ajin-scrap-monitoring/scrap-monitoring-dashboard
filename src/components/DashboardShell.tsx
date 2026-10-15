import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { applicationVersion } from "../application-version";
import { ROUTES, clearAuthentication, hasAuthenticationSession } from "../app-routing";
import type { DashboardDataSource } from "../data/dashboard-data-source";
import type { DataAreaState, HeaderNotification, UserSession } from "../domain/dashboard";
import { useModalFocus } from "../use-modal-focus";
import { UserIcon } from "./DashboardPrimitives";

export type DashboardPage = "monitoring" | "history" | "recordings" | "admin";

function BellIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg className="icon chevron-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m8 10 4 4 4-4" />
    </svg>
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
  const [notificationActionError, setNotificationActionError] = useState("");
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const isAuthenticated = session === undefined ? hasAuthenticationSession() : session !== null;
  const canManage = !sessionPending && (session === undefined ? hasAuthenticationSession() : session?.user.role === "administrator");
  const serverDisplayName = session?.user.displayName;
  const displayName = session?.user.role === "viewer" && serverDisplayName === "현장 운영자" ? "조회 사용자" : serverDisplayName ?? "관리자";
  const notifications = initialNotifications.map((notification) => ({
    ...notification,
    read: notification.read || notificationState.readIds.has(notification.id),
  }));
  const closeNotifications = useCallback(() => setNotificationsOpen(false), []);
  const closeUserMenu = useCallback(() => setUserMenuOpen(false), []);
  useModalFocus<HTMLElement>(notificationsOpen, closeNotifications, ".notifications-popover");
  useModalFocus<HTMLElement>(userMenuOpen, closeUserMenu, ".user-popover");

  useEffect(() => {
    const closePopoverOnOutsidePointer = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) {
        setNotificationsOpen(false);
        setUserMenuOpen(false);
      }
    };
    const closePopoverOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNotificationsOpen(false);
        setUserMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", closePopoverOnOutsidePointer);
    window.addEventListener("keydown", closePopoverOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closePopoverOnOutsidePointer);
      window.removeEventListener("keydown", closePopoverOnEscape);
    };
  }, []);

  const markNotificationRead = (id: string) => {
    const notification = notifications.find((item) => item.id === id);
    if (!notification || notification.read) return;
    const previousState = notificationState;
    setLocalNotificationState({
      readIds: new Set(notificationState.readIds).add(id),
      unreadCount: notificationState.unreadCount === null ? null : Math.max(0, notificationState.unreadCount - 1),
      version: notificationVersion,
    });
    setNotificationActionError("");
    void dataSource?.markNotificationRead?.(id).catch(() => {
      setLocalNotificationState(previousState);
      setNotificationActionError("알림 읽음 상태를 저장하지 못했습니다.");
    });
  };

  const markAllNotificationsRead = () => {
    const previousState = notificationState;
    setLocalNotificationState({
      readIds: new Set([...notificationState.readIds, ...initialNotifications.map((item) => item.id)]),
      unreadCount: 0,
      version: notificationVersion,
    });
    setNotificationActionError("");
    void dataSource?.markAllNotificationsRead?.().catch(() => {
      setLocalNotificationState(previousState);
      setNotificationActionError("알림 읽음 상태를 저장하지 못했습니다.");
    });
  };

  const logout = async () => {
    try {
      await dataSource?.deleteSession?.();
      clearAuthentication();
      window.location.assign(ROUTES.login);
    } catch {
      setNotificationActionError("로그아웃하지 못했습니다. 다시 시도하세요.");
    }
  };

  return (
    <header className="topbar" ref={headerRef}>
      <a className="brand" href={ROUTES.monitoring} aria-label="AJIN SCRAP MONITORING 홈"><span className="brand-mark" aria-hidden="true" /><span>AJIN SCRAP MONITORING</span></a>
      <nav className="global-nav" aria-label="주요 메뉴">
        {([["monitoring", "현황"], ["history", "이력"], ["recordings", "녹화 영상"], ["admin", "관리자"]] as const).filter(([page]) => page !== "admin" || canManage).map(([page, label]) => <a key={page} className={`nav-link ${activePage === page ? "active" : ""}`} href={ROUTES[page]} aria-current={activePage === page ? "page" : undefined}>{label}</a>)}
      </nav>
      {sessionPending ? <div className="user-tools" aria-hidden="true" /> : isAuthenticated ? <div className="user-tools"><div className="header-popover-anchor">
        <button className="icon-button notification-button" type="button" aria-label={notificationState.unreadCount === null ? "알림 조회 실패" : `알림 ${notificationState.unreadCount}건`} aria-expanded={notificationsOpen} onClick={() => { setNotificationsOpen((open) => !open); setUserMenuOpen(false); }}>
          <BellIcon />{(notificationState.unreadCount === null || notificationState.unreadCount > 0) && <span className="notification-badge">{notificationState.unreadCount ?? "?"}</span>}
        </button>
        {notificationsOpen && <section className="header-popover notifications-popover" aria-label="최근 알림">
          <div className="header-popover-head"><strong>최근 알림</strong><button type="button" disabled={notificationState.unreadCount === null} onClick={markAllNotificationsRead}>모두 읽음</button></div>
          {notificationQueryState?.status === "error" && <div className={`notification-unavailable${notificationQueryState.stale ? " has-previous" : ""}`} role="alert">
            <span className="notification-unavailable-icon" aria-hidden="true"><BellIcon /></span>
            <div><strong>{notificationQueryState.stale ? "최신 알림을 확인할 수 없습니다" : "알림을 확인할 수 없습니다"}</strong>
              <p>{notificationQueryState.stale ? "마지막으로 받은 알림을 표시합니다." : "알림 정보를 받으면 자동으로 표시합니다."}</p></div>
          </div>}
          {notificationActionError && <p role="alert">{notificationActionError}</p>}
          <div className="header-notification-list">{notifications.map((notification) => <button key={notification.id} className={`header-notification ${notification.read ? "read" : ""}`} type="button" onClick={() => markNotificationRead(notification.id)}><span className={`header-notification-dot ${notification.level}`} /><span><strong title={notification.title}>{notification.title}</strong><small title={notification.detail}>{notification.detail}</small></span><time>{notification.time}</time></button>)}</div>
          <a className="header-popover-link" href={ROUTES.history}>알림 이력에서 보기</a>
        </section>}
      </div><span className="tool-divider" aria-hidden="true" /><div className="header-popover-anchor"><button className="user-menu" type="button" aria-label="사용자 메뉴" aria-expanded={userMenuOpen} onClick={() => { setUserMenuOpen((open) => !open); setNotificationsOpen(false); }}><UserIcon /><span title={displayName}>{displayName}</span><ChevronIcon /></button>{userMenuOpen && <section className="header-popover user-popover" aria-label="사용자 메뉴"><div className="user-popover-profile"><strong title={displayName}>{displayName}</strong><span>{session?.user.role === "viewer" ? "조회 사용자" : "시스템 관리자"}</span></div>{session?.user.role !== "viewer" && <a href={ROUTES.admin}>관리자 설정</a>}<button type="button" onClick={() => void logout()}>로그아웃</button>{notificationActionError && <p role="alert">{notificationActionError}</p>}</section>}</div></div> : <div className="user-tools"><a className="header-login-link" href={ROUTES.login}>로그인</a></div>}
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
