import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { applicationVersion } from "../application-version";
import { ROUTES, clearAuthentication, hasAuthenticationSession } from "../app-routing";
import type { HeaderNotification } from "../domain/dashboard";
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

export function DashboardHeader({ activePage, initialNotifications }: {
  activePage: DashboardPage;
  initialNotifications: HeaderNotification[];
}) {
  const [readNotificationIds, setReadNotificationIds] = useState(() => new Set(initialNotifications.filter((notification) => notification.read).map((notification) => notification.id)));
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const isAuthenticated = hasAuthenticationSession();
  const notifications = initialNotifications.map((notification) => ({
    ...notification,
    read: notification.read || readNotificationIds.has(notification.id),
  }));
  const unreadCount = notifications.filter((notification) => !notification.read).length;
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

  const markNotificationRead = (id: number) => {
    setReadNotificationIds((ids) => new Set(ids).add(id));
  };

  const markAllNotificationsRead = () => {
    setReadNotificationIds((ids) => new Set([...ids, ...initialNotifications.map((item) => item.id)]));
  };

  const logout = () => {
    clearAuthentication();
    window.location.assign(ROUTES.login);
  };

  return (
    <header className="topbar" ref={headerRef}>
      <a className="brand" href={ROUTES.monitoring} aria-label="AJIN SCRAP MONITORING 홈"><span className="brand-mark" aria-hidden="true" /><span>AJIN SCRAP MONITORING</span></a>
      <nav className="global-nav" aria-label="주요 메뉴">
        <a className={`nav-link ${activePage === "monitoring" ? "active" : ""}`} href={ROUTES.monitoring} aria-current={activePage === "monitoring" ? "page" : undefined}>현황</a>
        <a className={`nav-link ${activePage === "history" ? "active" : ""}`} href={ROUTES.history} aria-current={activePage === "history" ? "page" : undefined}>이력</a>
        <a className={`nav-link ${activePage === "recordings" ? "active" : ""}`} href={ROUTES.recordings} aria-current={activePage === "recordings" ? "page" : undefined}>녹화 영상</a>
        {isAuthenticated && <a className={`nav-link ${activePage === "admin" ? "active" : ""}`} href={ROUTES.admin} aria-current={activePage === "admin" ? "page" : undefined}>관리자</a>}
      </nav>
      {isAuthenticated ? <div className="user-tools"><div className="header-popover-anchor"><button className="icon-button notification-button" type="button" aria-label={`알림 ${unreadCount}건`} aria-expanded={notificationsOpen} onClick={() => { setNotificationsOpen((open) => !open); setUserMenuOpen(false); }}><BellIcon />{unreadCount > 0 && <span className="notification-badge">{unreadCount}</span>}</button>{notificationsOpen && <section className="header-popover notifications-popover" aria-label="최근 알림"><div className="header-popover-head"><strong>최근 알림</strong><button type="button" onClick={markAllNotificationsRead}>모두 읽음</button></div><div className="header-notification-list">{notifications.map((notification) => <button key={notification.id} className={`header-notification ${notification.read ? "read" : ""}`} type="button" onClick={() => markNotificationRead(notification.id)}><span className={`header-notification-dot ${notification.level}`} /><span><strong>{notification.title}</strong><small>{notification.detail}</small></span><time>{notification.time}</time></button>)}</div><a className="header-popover-link" href={ROUTES.history}>알림 이력에서 보기</a></section>}</div><span className="tool-divider" aria-hidden="true" /><div className="header-popover-anchor"><button className="user-menu" type="button" aria-label="관리자 메뉴" aria-expanded={userMenuOpen} onClick={() => { setUserMenuOpen((open) => !open); setNotificationsOpen(false); }}><UserIcon /><span>관리자</span><ChevronIcon /></button>{userMenuOpen && <section className="header-popover user-popover" aria-label="관리자 메뉴"><div className="user-popover-profile"><strong>관리자</strong><span>시스템 관리자</span></div><a href={ROUTES.admin}>관리자 설정</a><button type="button" onClick={logout}>로그아웃</button></section>}</div></div> : <div className="user-tools"><a className="header-login-link" href={ROUTES.login}>로그인</a></div>}
    </header>
  );
}

export function ApplicationFooter() {
  return <footer className="app-footer"><span>Copyright 2026 AJIN INDUSTRIAL. All rights reserved.</span><span>Version {applicationVersion}</span></footer>;
}

export function DashboardPageShell({ activePage, children, headerNotifications }: {
  activePage: DashboardPage;
  children: ReactNode;
  headerNotifications: HeaderNotification[];
}) {
  return (
    <div className="app-shell">
      <DashboardHeader activePage={activePage} initialNotifications={headerNotifications} />
      {children}
      <ApplicationFooter />
    </div>
  );
}
