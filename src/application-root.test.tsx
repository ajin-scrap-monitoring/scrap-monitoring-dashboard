import { act, fireEvent, screen } from "@testing-library/react";
import { StrictMode, useEffect, useState } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { createApplicationRoot } from "./application-root";

const applications: ReturnType<typeof createApplicationRoot>[] = [];
const containers: HTMLElement[] = [];

afterEach(() => {
  act(() => { for (const application of applications.splice(0)) application.dispose(); });
  for (const container of containers.splice(0)) container.remove();
  vi.useRealTimers();
});

function createApplication() {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const application = createApplicationRoot(container);
  applications.push(application);
  return application;
}

function ConnectedView({ connect }: { connect: () => () => void }) {
  useEffect(connect, [connect]);
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(value => value + 1)}>{count}</button>;
}

test("일반 pageshow와 중복 pageshow는 현재 앱을 다시 mount하지 않는다", () => {
  const connect = vi.fn(() => vi.fn());
  const application = createApplication();
  act(() => application.render(<ConnectedView connect={connect} />));
  act(() => {
    window.dispatchEvent(new PageTransitionEvent("pageshow"));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  expect(connect).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "0" })).toBeVisible();
});

test.each([false, true])("pagehide persisted=%s는 연결과 timer를 동기적으로 정리한다", persisted => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const closed = vi.fn();
  const connect = () => {
    const timer = window.setInterval(() => undefined, 1000);
    return () => { controller.abort(); window.clearInterval(timer); closed(); };
  };
  const application = createApplication();
  act(() => application.render(<ConnectedView connect={connect} />));
  act(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted }));
    expect(controller.signal.aborted).toBe(true);
    expect(closed).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("cached document 복원은 새 앱을 mount하고 현재 상태를 다시 조회한다", () => {
  const closed = vi.fn();
  const connect = vi.fn(() => closed);
  const application = createApplication();
  act(() => application.render(<ConnectedView connect={connect} />));
  fireEvent.click(screen.getByRole("button", { name: "0" }));
  expect(screen.getByRole("button", { name: "1" })).toBeVisible();
  act(() => { window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })); });
  act(() => { window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })); });
  expect(connect).toHaveBeenCalledTimes(2);
  expect(closed).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "0" })).toBeVisible();
});

test("화면 종료 뒤 완료된 초기화는 document 복원 전까지 mount하지 않는다", () => {
  const connect = vi.fn(() => vi.fn());
  const application = createApplication();
  act(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    application.render(<ConnectedView connect={connect} />);
  });
  expect(connect).not.toHaveBeenCalled();
  act(() => { window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })); });
  expect(connect).toHaveBeenCalledOnce();
});

test("StrictMode에서 document 종료와 복원을 반복해도 활성 연결은 하나다", () => {
  const active = new Set<AbortController>();
  const connect = () => {
    const controller = new AbortController();
    active.add(controller);
    return () => { controller.abort(); active.delete(controller); };
  };
  const application = createApplication();
  act(() => application.render(<StrictMode><ConnectedView connect={connect} /></StrictMode>));
  for (let cycle = 0; cycle < 4; cycle += 1) {
    expect(active.size).toBe(1);
    act(() => { window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })); });
    expect(active.size).toBe(0);
    act(() => { window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })); });
  }
  expect(active.size).toBe(1);
  act(() => application.dispose());
  expect(active.size).toBe(0);
});

test("dispose는 event listener를 제거하고 늦은 render와 document 복원을 무시한다", () => {
  const remove = vi.spyOn(window, "removeEventListener");
  const closed = vi.fn();
  const connect = vi.fn(() => closed);
  const application = createApplication();
  act(() => application.render(<ConnectedView connect={connect} />));
  act(() => application.dispose());
  expect(remove).toHaveBeenCalledWith("pagehide", expect.any(Function));
  expect(remove).toHaveBeenCalledWith("pageshow", expect.any(Function));
  remove.mockRestore();
  act(() => {
    application.dispose();
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    application.render(<ConnectedView connect={connect} />);
  });
  expect(connect).toHaveBeenCalledOnce();
  expect(closed).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
