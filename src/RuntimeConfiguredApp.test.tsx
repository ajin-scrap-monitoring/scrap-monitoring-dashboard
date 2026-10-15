import { act, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { RuntimeConfiguredApp } from "./RuntimeConfiguredApp";

vi.mock("./App", () => ({ App: () => <main>Configured application</main> }));
const config = { schemaVersion: 1, pitId: "pit-example", cameraId: "camera-example" };
const source = { getDashboardData: vi.fn() };

test("설정을 읽고 검증하기 전에는 HTTP data source와 화면을 연결하지 않는다", async () => {
  let complete: (response: Response) => void = () => undefined;
  const createDataSource = vi.fn(() => source);
  const fetchImplementation = vi.fn(() => new Promise<Response>((resolve) => { complete = resolve; }));
  render(<RuntimeConfiguredApp createDataSource={createDataSource} fetchImplementation={fetchImplementation} />);
  expect(screen.getByText("대시보드 설정을 불러오는 중입니다.")).toBeVisible();
  expect(screen.queryByRole("link", { name: "로그인" })).not.toBeInTheDocument();
  expect(createDataSource).not.toHaveBeenCalled();
  await act(() => { complete(Response.json(config)); return Promise.resolve(); });
  expect(await screen.findByText("Configured application")).toBeVisible();
  expect(createDataSource).toHaveBeenCalledExactlyOnceWith(config);
});

test("설정 오류에는 재시도를 표시하고 HTTP data source를 생성하지 않는다", async () => {
  const createDataSource = vi.fn(() => source);
  render(<RuntimeConfiguredApp createDataSource={createDataSource} fetchImplementation={() => Promise.resolve(new Response(null, { status: 404 }))} />);
  expect(await screen.findByText("대시보드 설정을 불러올 수 없습니다.")).toBeVisible();
  expect(screen.queryByRole("link", { name: "로그인" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "다시 시도" })).toBeVisible();
  expect(createDataSource).not.toHaveBeenCalled();
});

test("화면 종료 후 설정의 늦은 응답은 data source를 생성하지 않는다", async () => {
  let complete: (response: Response) => void = () => undefined;
  let signal: AbortSignal | null | undefined;
  const createDataSource = vi.fn(() => source);
  const view = render(<RuntimeConfiguredApp createDataSource={createDataSource} fetchImplementation={(_input, options) => {
    signal = options?.signal;
    return new Promise((resolve) => { complete = resolve; });
  }} />);
  view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(() => { complete(Response.json(config)); return Promise.resolve(); });
  expect(createDataSource).not.toHaveBeenCalled();
});

test("설정 조회 구현 변경은 새 검증 전 기존 application을 연결하지 않는다", async () => {
  const createDataSource = vi.fn(() => source);
  const initialFetch = () => Promise.resolve(Response.json(config));
  const view = render(<RuntimeConfiguredApp createDataSource={createDataSource} fetchImplementation={initialFetch} />);
  await screen.findByText("Configured application");
  let complete: (response: Response) => void = () => undefined;
  const nextFetch = () => new Promise<Response>((resolve) => { complete = resolve; });
  view.rerender(<RuntimeConfiguredApp createDataSource={createDataSource} fetchImplementation={nextFetch} />);
  expect(screen.queryByText("Configured application")).not.toBeInTheDocument();
  expect(createDataSource).toHaveBeenCalledOnce();
  await act(() => { complete(Response.json(config)); return Promise.resolve(); });
  await screen.findByText("Configured application");
  expect(createDataSource).toHaveBeenCalledTimes(2);
});
