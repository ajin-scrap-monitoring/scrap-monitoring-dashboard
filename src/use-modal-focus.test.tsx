import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { useModalFocus } from "./use-modal-focus";

function Modal({ busy = false, onClose = () => {} }: { busy?: boolean; onClose?: () => void }) {
  const ref = useModalFocus<HTMLDivElement>(true, onClose);
  return <><button>배경</button><div ref={ref} role="dialog"><fieldset disabled={busy}><input aria-label="이름" /><button>저장</button></fieldset></div></>;
}

test("disabled fieldset의 입력을 제외하고 Tab과 Shift Tab을 모달에 유지한다", async () => {
  const view = render(<Modal />);
  await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 0)); });
  expect(screen.getByRole("textbox")).toHaveFocus();
  view.rerender(<Modal busy />);
  for (const shiftKey of [false, true]) {
    const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
    fireEvent(window, event);
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole("dialog")).toHaveFocus();
  }
});

test("배경이나 비활성화된 요소의 포커스는 사용 가능한 모달 요소로 이동한다", async () => {
  render(<Modal />);
  await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 0)); });
  screen.getByRole("button", { name: "배경" }).focus();
  fireEvent.keyDown(window, { key: "Tab" });
  expect(screen.getByRole("textbox")).toHaveFocus();
  screen.getByRole("button", { name: "배경" }).focus();
  fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
  expect(screen.getByRole("button", { name: "저장" })).toHaveFocus();
});

test("닫기 callback 변경은 포커스를 초기화하지 않고 최신 callback을 실행한다", async () => {
  const oldClose = vi.fn();
  const latestClose = vi.fn();
  const view = render(<Modal onClose={oldClose} />);
  await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 0)); });
  screen.getByRole("button", { name: "저장" }).focus();
  view.rerender(<Modal onClose={latestClose} />);
  expect(screen.getByRole("button", { name: "저장" })).toHaveFocus();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(oldClose).not.toHaveBeenCalled();
  expect(latestClose).toHaveBeenCalledTimes(1);
});

function MediaModal({ onClose = () => {} }: { onClose?: () => void }) {
  const ref = useModalFocus<HTMLDivElement>(true, onClose);
  return <div ref={ref} role="dialog"><button>닫기</button><video controls tabIndex={0} aria-label="영상" /><video aria-label="제어 없음" /></div>;
}

test("controls가 있는 video에서는 Tab과 Shift Tab을 가로채지 않고 닫기 버튼에서는 video로 순환한다", async () => {
  const onClose = vi.fn();
  render(<MediaModal onClose={onClose} />);
  await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 0)); });
  const close = screen.getByRole("button", { name: "닫기" });
  const video = screen.getByLabelText("영상");
  expect(close).toHaveFocus();
  const backward = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
  fireEvent(window, backward);
  expect(backward.defaultPrevented).toBe(true);
  expect(video).toHaveFocus();
  for (const shiftKey of [false, true]) {
    const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
    fireEvent(window, event);
    expect(event.defaultPrevented).toBe(false);
    expect(video).toHaveFocus();
  }
  fireEvent.keyDown(video, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("media에서 Tab으로 넘긴 focus가 modal 밖으로 나가면 방향에 맞는 modal 요소로 되돌린다", async () => {
  render(<><button>배경</button><MediaModal /><button>뒤</button></>);
  await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 0)); });
  const close = screen.getByRole("button", { name: "닫기" });
  const video = screen.getByLabelText("영상");
  video.focus();
  fireEvent.keyDown(window, { key: "Tab" });
  screen.getByRole("button", { name: "뒤" }).focus();
  expect(close).toHaveFocus();
  video.focus();
  fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
  screen.getByRole("button", { name: "배경" }).focus();
  expect(video).toHaveFocus();
});

test("Tab을 media에 넘기지 않은 상태의 modal 밖 focus는 되돌리지 않는다", async () => {
  render(<><button>배경</button><MediaModal /></>);
  await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 0)); });
  screen.getByRole("button", { name: "배경" }).focus();
  expect(screen.getByRole("button", { name: "배경" })).toHaveFocus();
});
