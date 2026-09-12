import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { applicationVersion } from "../application-version";
import { ROUTES, clearAuthentication, hasAuthenticationSession } from "../app-routing";
import type { DashboardDataSource } from "../data/dashboard-data-source";
import type { HeaderNotification, UserSession } from "../domain/dashboard";
import { useModalFocus } from "../use-modal-focus";

export type DashboardPage = "monitoring" | "history" | "recordings" | "admin";

function BellIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="7" r="4" />
      <path d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2" />
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

export function DashboardHeader({ activePage, dataSource, initialNotifications, initialUnreadCount, session }: {
  activePage: DashboardPage;
  dataSource?: DashboardDataSource;
  initialNotifications: HeaderNotification[];
  initialUnreadCount?: number;
  session?: UserSession | null;
}) {
  const notificationVersion = `${initialUnreadCount ?? "derived"}:${initialNotifications.map((notification) => `${notification.id}:${notification.read}`).join("|")}`;
  const serverNotificationState = {
    readIds: new Set(initialNotifications.filter((notification) => notification.read).map((notification) => notification.id)),
    unreadCount: initialUnreadCount ?? initialNotifications.filter((notification) => !notification.read).length,
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
  const canManage = session === undefined ? hasAuthenticationSession() : session?.user.role === "administrator";
  const displayName = session?.user.displayName ?? "관리자";
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
      unreadCount: Math.max(0, notificationState.unreadCount - 1),
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
        <a className={`nav-link ${activePage === "monitoring" ? "active" : ""}`} href={ROUTES.monitoring} aria-current={activePage === "monitoring" ? "page" : undefined}>현황</a>
        <a className={`nav-link ${activePage === "history" ? "active" : ""}`} href={ROUTES.history} aria-current={activePage === "history" ? "page" : undefined}>이력</a>
        <a className={`nav-link ${activePage === "recordings" ? "active" : ""}`} href={ROUTES.recordings} aria-current={activePage === "recordings" ? "page" : undefined}>녹화 영상</a>
        {canManage && <a className={`nav-link ${activePage === "admin" ? "active" : ""}`} href={ROUTES.admin} aria-current={activePage === "admin" ? "page" : undefined}>관리자</a>}
      </nav>
      {isAuthenticated ? <div className="user-tools"><div className="header-popover-anchor"><button className="icon-button notification-button" type="button" aria-label={`알림 ${notificationState.unreadCount}건`} aria-expanded={notificationsOpen} onClick={() => { setNotificationsOpen((open) => !open); setUserMenuOpen(false); }}><BellIcon />{notificationState.unreadCount > 0 && <span className="notification-badge">{notificationState.unreadCount}</span>}</button>{notificationsOpen && <section className="header-popover notifications-popover" aria-label="최근 알림"><div className="header-popover-head"><strong>최근 알림</strong><button type="button" onClick={markAllNotificationsRead}>모두 읽음</button></div>{notificationActionError && <p role="alert">{notificationActionError}</p>}<div className="header-notification-list">{notifications.map((notification) => <button key={notification.id} className={`header-notification ${notification.read ? "read" : ""}`} type="button" onClick={() => markNotificationRead(notification.id)}><span className={`header-notification-dot ${notification.level}`} /><span><strong>{notification.title}</strong><small>{notification.detail}</small></span><time>{notification.time}</time></button>)}</div><a className="header-popover-link" href={ROUTES.history}>알림 이력에서 보기</a></section>}</div><span className="tool-divider" aria-hidden="true" /><div className="header-popover-anchor"><button className="user-menu" type="button" aria-label="관리자 메뉴" aria-expanded={userMenuOpen} onClick={() => { setUserMenuOpen((open) => !open); setNotificationsOpen(false); }}><UserIcon /><span>{displayName}</span><ChevronIcon /></button>{userMenuOpen && <section className="header-popover user-popover" aria-label="관리자 메뉴"><div className="user-popover-profile"><strong>{displayName}</strong><span>{session?.user.role === "viewer" ? "조회 사용자" : "시스템 관리자"}</span></div>{session?.user.role !== "viewer" && <a href={ROUTES.admin}>관리자 설정</a>}<button type="button" onClick={() => void logout()}>로그아웃</button>{notificationActionError && <p role="alert">{notificationActionError}</p>}</section>}</div></div> : <div className="user-tools"><a className="header-login-link" href={ROUTES.login}>로그인</a></div>}
    </header>
  );
}

export function ApplicationFooter() {
  return <footer className="app-footer"><span>Copyright 2026 AJIN INDUSTRIAL. All rights reserved.</span><span>Version {applicationVersion}</span></footer>;
}

export function DashboardPageShell({ activePage, children, dataSource, headerNotifications, headerUnreadCount, session }: {
  activePage: DashboardPage;
  children: ReactNode;
  dataSource?: DashboardDataSource;
  headerNotifications: HeaderNotification[];
  headerUnreadCount?: number;
  session?: UserSession | null;
}) {
  return (
    <div className="app-shell">
      <DashboardHeader activePage={activePage} dataSource={dataSource} initialNotifications={headerNotifications} initialUnreadCount={headerUnreadCount} session={session} />
      {children}
      <ApplicationFooter />
    </div>
  );
}
