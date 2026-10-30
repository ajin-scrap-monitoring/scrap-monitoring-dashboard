import { useEffect, useRef, useState } from "react";
import { ROUTES, clearAuthentication } from "../app-routing";
import type { DashboardDataSource } from "../data/dashboard-data-source";
import type { DataAreaState, HeaderNotification, UserSession } from "../domain/dashboard";
import { useModalFocus } from "../use-modal-focus";
import { BellIcon } from "./DashboardPrimitives";

type NotificationState = {
  readIds: Set<string>;
  unreadCount: number | null;
};

// 공통 헤더의 알림 패널과 사용자 메뉴 패널이다. 헤더가 첫 화면 렌더링 뒤에 불러온다.
export function NotificationsPopover({
  dataSource,
  initialNotifications,
  localState,
  onClose,
  onStateChange,
  queryState,
}: {
  dataSource?: DashboardDataSource;
  initialNotifications: HeaderNotification[];
  localState: NotificationState;
  onClose: () => void;
  onStateChange: (state: NotificationState) => void;
  queryState?: DataAreaState;
}) {
  const [actionError, setActionError] = useState("");
  const popoverRef = useRef<HTMLElement>(null);
  useModalFocus<HTMLElement>(true, onClose, ".notifications-popover");

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popoverRef.current?.contains(target) && !(target instanceof Element && target.closest(".notification-button"))) {
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
  }, [onClose]);

  const notifications = initialNotifications.map((n) => ({
    ...n,
    read: n.read || localState.readIds.has(n.id),
  }));

  const markNotificationRead = (id: string) => {
    const notification = notifications.find((item) => item.id === id);
    if (!notification || notification.read) return;
    const previous = localState;
    onStateChange({
      readIds: new Set(localState.readIds).add(id),
      unreadCount: localState.unreadCount === null ? null : Math.max(0, localState.unreadCount - 1),
    });
    setActionError("");
    void dataSource?.markNotificationRead?.(id).catch(() => {
      onStateChange(previous);
      setActionError("알림 읽음 상태를 저장하지 못했습니다.");
    });
  };

  const markAllNotificationsRead = () => {
    const previous = localState;
    onStateChange({
      readIds: new Set([...localState.readIds, ...initialNotifications.map((item) => item.id)]),
      unreadCount: 0,
    });
    setActionError("");
    void dataSource?.markAllNotificationsRead?.().catch(() => {
      onStateChange(previous);
      setActionError("알림 읽음 상태를 저장하지 못했습니다.");
    });
  };

  return (
    <section className="header-popover notifications-popover" aria-label="최근 알림" ref={popoverRef}>
      <div className="header-popover-head">
        <strong>최근 알림</strong>
        <button type="button" disabled={localState.unreadCount === null} onClick={markAllNotificationsRead}>모두 읽음</button>
      </div>
      {queryState?.status === "error" && (
        <div className={`notification-unavailable${queryState.stale ? " has-previous" : ""}`} role="alert">
          <span className="notification-unavailable-icon" aria-hidden="true"><BellIcon /></span>
          <div>
            <strong>{queryState.stale ? "최신 알림을 확인할 수 없습니다" : "알림을 확인할 수 없습니다"}</strong>
            <p>{queryState.stale ? "마지막으로 받은 알림을 표시합니다." : "알림 정보를 받으면 자동으로 표시합니다."}</p>
          </div>
        </div>
      )}
      {actionError && <p role="alert">{actionError}</p>}
      <div className="header-notification-list">
        {notifications.map((notification) => (
          <button key={notification.id} className={`header-notification ${notification.read ? "read" : ""}`} type="button" onClick={() => markNotificationRead(notification.id)}>
            <span className={`header-notification-dot ${notification.level}`} />
            <span><strong title={notification.title}>{notification.title}</strong><small title={notification.detail}>{notification.detail}</small></span>
            <time>{notification.time}</time>
          </button>
        ))}
      </div>
      <a className="header-popover-link" href={ROUTES.history}>알림 이력에서 보기</a>
    </section>
  );
}

export function UserPopover({
  dataSource,
  displayName,
  onClose,
  role,
}: {
  dataSource?: DashboardDataSource;
  displayName: string;
  onClose: () => void;
  role?: UserSession["user"]["role"];
}) {
  const [actionError, setActionError] = useState("");
  const popoverRef = useRef<HTMLElement>(null);
  useModalFocus<HTMLElement>(true, onClose, ".user-popover");

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popoverRef.current?.contains(target) && !(target instanceof Element && target.closest(".user-menu"))) {
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
  }, [onClose]);

  const logout = async () => {
    try {
      await dataSource?.deleteSession?.();
      clearAuthentication();
      window.location.assign(ROUTES.login);
    } catch {
      setActionError("로그아웃하지 못했습니다. 다시 시도하세요.");
    }
  };

  return (
    <section className="header-popover user-popover" aria-label="사용자 메뉴" ref={popoverRef}>
      <div className="user-popover-profile">
        <strong title={displayName}>{displayName}</strong>
        <span>{role === "viewer" ? "조회 사용자" : "시스템 관리자"}</span>
      </div>
      {role !== "viewer" && <a href={ROUTES.admin}>관리자 설정</a>}
      <button type="button" onClick={() => void logout()}>로그아웃</button>
      {actionError && <p role="alert">{actionError}</p>}
    </section>
  );
}
