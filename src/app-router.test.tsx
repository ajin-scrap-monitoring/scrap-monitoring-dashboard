import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { AppLink } from "./app-link";
import { getRememberedScroll, isClientRoute, navigate, resetNavigationForTesting, useAppLocation } from "./app-router";

describe("app-router: client route 판별 및 AppLink 동작", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
    resetNavigationForTesting();
  });

  test("isClientRoute: 허용된 경로만 true를 반환한다", () => {
    expect(isClientRoute("/")).toBe(true);
    expect(isClientRoute("/history")).toBe(true);
    expect(isClientRoute("/recordings")).toBe(true);
    expect(isClientRoute("/admin")).toBe(true);
    expect(isClientRoute("/recordings?recordingId=rec-1")).toBe(true);

    expect(isClientRoute("/login")).toBe(false);
    expect(isClientRoute("/other-page")).toBe(false);
    expect(isClientRoute("https://external-domain.com/history")).toBe(false);
  });

  test("AppLink: 일반 왼쪽 클릭은 기본 동작을 막고 navigate를 호출한다", () => {
    const onNavigate = vi.fn();
    const pushStateSpy = vi.spyOn(window.history, "pushState");

    render(<AppLink to="/history" onNavigate={onNavigate}>이력</AppLink>);
    const link = screen.getByRole("link", { name: "이력" });

    fireEvent.click(link, { button: 0 });

    expect(pushStateSpy).toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/history");
  });

  test("AppLink: 보조키(Ctrl, Meta, Shift, Alt)가 눌리면 가로채지 않는다", () => {
    render(<AppLink to="/history">이력</AppLink>);
    const link = screen.getByRole("link", { name: "이력" });

    for (const key of ["ctrlKey", "metaKey", "shiftKey", "altKey"] as const) {
      const event = new MouseEvent("click", { button: 0, cancelable: true, [key]: true });
      link.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
  });

  test("AppLink: 가운데 버튼(button 1)이나 우클릭(button 2)은 가로채지 않는다", () => {
    render(<AppLink to="/history">이력</AppLink>);
    const link = screen.getByRole("link", { name: "이력" });

    const middleClick = new MouseEvent("click", { button: 1, cancelable: true });
    link.dispatchEvent(middleClick);
    expect(middleClick.defaultPrevented).toBe(false);

    const rightClick = new MouseEvent("click", { button: 2, cancelable: true });
    link.dispatchEvent(rightClick);
    expect(rightClick.defaultPrevented).toBe(false);
  });

  test("AppLink: target이 _blank이거나 download 속성이 있으면 가로채지 않는다", () => {
    const { rerender } = render(<AppLink to="/history" target="_blank">이력</AppLink>);
    let link = screen.getByRole("link", { name: "이력" });
    let event = new MouseEvent("click", { button: 0, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);

    rerender(<AppLink to="/history" download="file.txt">이력</AppLink>);
    link = screen.getByRole("link", { name: "이력" });
    event = new MouseEvent("click", { button: 0, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  test("AppLink: /login 경로나 외부 도메인은 가로채지 않는다", () => {
    const { rerender } = render(<AppLink to="/login">로그인</AppLink>);
    let link = screen.getByRole("link", { name: "로그인" });
    let event = new MouseEvent("click", { button: 0, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);

    rerender(<AppLink to="https://other.com/history">외부</AppLink>);
    link = screen.getByRole("link", { name: "외부" });
    event = new MouseEvent("click", { button: 0, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  test("navigate: 같은 위치(pathname + search 동일) 클릭은 새 entry를 만들지 않는다", () => {
    window.history.replaceState(null, "", "/history?tab=1");
    const pushStateSpy = vi.spyOn(window.history, "pushState");

    navigate("/history?tab=1");
    expect(pushStateSpy).not.toHaveBeenCalled();
  });

  test("첫 document entry와 push entry는 서로 다른 key를 history.state에 가진다", () => {
    resetNavigationForTesting();
    const firstKey = (window.history.state as { entryKey?: string }).entryKey;
    expect(firstKey).toEqual(expect.any(String));

    navigate("/history");
    const secondKey = (window.history.state as { entryKey?: string }).entryKey;
    expect(secondKey).toEqual(expect.any(String));
    expect(secondKey).not.toBe(firstKey);
  });

  test("뒤로와 앞으로 이동은 각 entry를 떠나기 직전의 scroll 위치를 복원한다", async () => {
    let scroll = { x: 0, y: 0 };
    Object.defineProperty(window, "scrollX", { configurable: true, get: () => scroll.x });
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => scroll.y });
    const popstate = () => new Promise<void>((resolve) => window.addEventListener("popstate", () => resolve(), { once: true }));
    resetNavigationForTesting();

    scroll = { x: 0, y: 150 };
    navigate("/recordings");
    expect(getRememberedScroll()).toEqual({ x: 0, y: 0 });
    scroll = { x: 5, y: 320 };

    const back = popstate();
    window.history.back();
    await back;
    expect(window.location.pathname).toBe("/");
    expect(getRememberedScroll()).toEqual({ x: 0, y: 150 });
    scroll = { x: 0, y: 40 };

    const forward = popstate();
    window.history.forward();
    await forward;
    expect(window.location.pathname).toBe("/recordings");
    expect(getRememberedScroll()).toEqual({ x: 5, y: 320 });

    const backAgain = popstate();
    window.history.back();
    await backAgain;
    expect(getRememberedScroll()).toEqual({ x: 0, y: 40 });
    Reflect.deleteProperty(window, "scrollX");
    Reflect.deleteProperty(window, "scrollY");
  });

  test("useAppLocation: popstate 이벤트를 구독하여 위치 변경을 감지한다", () => {
    function TestLocation() {
      const loc = useAppLocation();
      return <div data-testid="loc">{loc.pathname}{loc.search}</div>;
    }

    render(<TestLocation />);
    expect(screen.getByTestId("loc").textContent).toBe("/");

    act(() => {
      window.history.pushState(null, "", "/recordings?source=daily");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(screen.getByTestId("loc").textContent).toBe("/recordings?source=daily");
  });
});
