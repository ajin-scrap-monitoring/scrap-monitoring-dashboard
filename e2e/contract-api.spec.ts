import { expect, test } from "@playwright/test";

import { installContractApi } from "./contract-api.js";

test("제안 계약의 현재 상태, SSE와 WHEP를 브라우저에 연결한다", async ({ page }) => {
  const { requests } = await installContractApi(page, { initiallyAuthenticated: true });

  await page.goto("/?source=api");

  await expect(page.getByRole("heading", { name: "스크랩 모니터링", exact: true })).toBeVisible();
  await expect(page.locator(".kpi-value")).toHaveText("72%");
  await expect(page.getByText("사전 알림 기준 70%")).toBeVisible();
  await expect(page.getByText("계약 관리자")).toBeVisible();
  await expect(page.getByRole("button", { name: "알림 1건" })).toBeVisible();
  await expect(page.locator(".profile-stat").first()).toContainText("평균1.8 m");
  await expect.poll(() => requests.some(({ method, url }) => method === "GET" && url.pathname === "/api/v1/monitoring/events")).toBe(true);
  await expect.poll(() => requests.some(({ method, url }) => method === "POST" && url.pathname === "/api/v1/webrtc/streams/camera-main")).toBe(true);
  await expect.poll(() => requests.some(({ method, url }) => method === "PATCH" && url.pathname === "/api/v1/webrtc/sessions/whep-contract-1")).toBe(true);
  await page.getByRole("button", { name: "실시간 영상 크게 보기" }).click();
  await expect(page.getByRole("dialog", { name: "실시간 영상 크게 보기" })).toBeVisible();
  await expect.poll(() => requests.some(({ method, url }) => method === "DELETE" && url.pathname === "/api/v1/webrtc/sessions/whep-contract-1")).toBe(true);
});

test("WHEP session 생성 실패 뒤 자동으로 다시 연결한다", async ({ page }) => {
  const { requests } = await installContractApi(page, { whepFailures: 1 });

  await page.goto("/?source=api");

  await expect(page.getByRole("heading", { name: "스크랩 모니터링", exact: true })).toBeVisible();
  await expect.poll(
    () => requests.filter(({ method, url }) => method === "POST" && url.pathname === "/api/v1/webrtc/streams/camera-main").length,
    { timeout: 5000 },
  ).toBe(2);
  await expect.poll(() => requests.some(({ method, url }) => method === "PATCH" && url.pathname === "/api/v1/webrtc/sessions/whep-contract-1")).toBe(true);
  await expect(page.getByRole("button", { name: "영상 다시 연결" })).toHaveCount(0);
});

test("제안 계약의 이력 조회와 관련 녹화 재생 및 다운로드를 연결한다", async ({ page }) => {
  const { requests } = await installContractApi(page);

  await page.goto("/history?source=api");
  await expect(page.getByText("총 1건")).toBeVisible();
  await expect(page.getByText("대표 적재율 85% 도달")).toBeVisible();
  await expect(page.getByLabel("2026-09-09 12:17 수거 필요 대표 적재율 85% 도달")).toBeAttached();

  await page.locator(".history-query").getByRole("button", { name: "알림", exact: true }).click();
  await page.locator(".history-query").getByRole("button", { name: "조회", exact: true }).click();
  await expect.poll(() => requests.filter(({ url }) => url.pathname === "/api/v1/history/load").at(-1)?.url.searchParams.get("eventCategory")).toBe("alert");
  const historyRequest = requests.filter(({ url }) => url.pathname === "/api/v1/history/load").at(-1);
  expect(historyRequest?.url.searchParams.get("from")).toMatch(/[+]09:00$/);
  expect(historyRequest?.url.searchParams.get("to")).toMatch(/[+]09:00$/);

  await page.getByRole("link", { name: "영상 보기" }).click();
  await expect(page).toHaveURL(/\/recordings\?recordingId=recording-contract-1$/);
  await expect(page.getByRole("heading", { name: "녹화 영상", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "시작 시각", exact: true })).toHaveValue("2026-09-09 00:00");
  await expect(page.getByRole("textbox", { name: "종료 시각", exact: true })).toHaveValue("2026-09-09 23:59");
  await expect(page.getByText("640 x 480")).toBeVisible();
  await expect(page.getByText("30 fps")).toBeVisible();
  await expect(page.locator('video[aria-label="2026-09-09 녹화 영상"]')).toHaveAttribute("src", "/api/v1/recordings/recording-contract-1/content");
  await expect.poll(() => requests.some(({ method, url }) => method === "GET" && url.pathname === "/api/v1/recordings/recording-contract-1")).toBe(true);
  await expect.poll(() => requests.some(({ method, url }) => method === "GET" && url.pathname === "/api/v1/recordings/recording-contract-1/thumbnail")).toBe(true);
  await expect.poll(() => requests.some(({ method, url }) => method === "GET" && url.pathname === "/api/v1/recordings/recording-contract-1/content")).toBe(true);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "녹화 영상 다운로드" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("recording-contract-1.mp4");
  await expect(page.getByRole("status")).toHaveText("다운로드를 시작했습니다.");
});

test("제안 계약의 로그인, 알림 읽음과 관리자 변경 요청을 연결한다", async ({ page }) => {
  const { requests } = await installContractApi(page);

  await page.goto("/login?source=api");
  await page.getByLabel("아이디").fill("contract-admin");
  await page.getByLabel("비밀번호").fill("contract-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("계약 관리자")).toBeVisible();

  await page.getByRole("button", { name: "알림 1건" }).click();
  await page.locator(".header-notification").first().click();
  await expect(page.getByRole("button", { name: "알림 0건" })).toBeVisible();
  await page.getByRole("button", { name: "모두 읽음" }).click();
  await expect(page.getByRole("button", { name: "알림 0건" })).toBeVisible();

  await page.goto("/admin");
  await page.getByLabel("변경값").fill("82");
  await page.getByRole("button", { name: "수거 설정 저장" }).click();
  await expect(page.getByRole("status")).toHaveText("수거 설정을 저장했습니다.");

  await page.getByRole("button", { name: "수신 설정", exact: true }).click();
  const recipientDialog = page.getByRole("dialog", { name: "계약 담당자 수신 설정" });
  await recipientDialog.getByText("문자", { exact: true }).click();
  await expect(recipientDialog.getByRole("checkbox", { name: "문자" })).not.toBeChecked();
  await recipientDialog.getByRole("button", { name: "수신 설정 저장" }).click();
  await expect(recipientDialog).toBeHidden();

  await page.getByRole("button", { name: "알림 대상 추가" }).click();
  const addRecipientDialog = page.getByRole("dialog", { name: "알림 대상 추가" });
  await addRecipientDialog.getByLabel("이름").fill("계약 추가 담당자");
  await addRecipientDialog.getByLabel("소속").fill("생산관리팀");
  await addRecipientDialog.getByRole("textbox", { name: "이메일" }).fill("new-operator@example.com");
  await addRecipientDialog.getByLabel("전화번호").fill("010-1111-2222");
  await addRecipientDialog.getByRole("button", { exact: true, name: "알림 대상 추가" }).click();
  await expect(addRecipientDialog).toBeHidden();
  await expect(page.getByText("계약 추가 담당자")).toBeVisible();

  await page.getByRole("button", { name: "테스트 알림 보내기" }).click();
  await expect(page.getByText("테스트 알림 요청을 접수했습니다.", { exact: true })).toBeVisible();

  const settingsRequest = requests.find(({ method, url }) => method === "PUT" && url.pathname === "/api/v1/settings/alerts");
  expect(settingsRequest?.headers["x-csrf-token"]).toBe("csrf-contract-example");
  expect(settingsRequest?.headers["if-match"]).toBe('"settings-contract-v1"');
  const settingsBody = JSON.parse(settingsRequest?.postData ?? "{}") as { collectionThresholdPercent?: unknown };
  expect(settingsBody.collectionThresholdPercent).toBe(82);
  const recipientRequest = requests.find(({ method, url }) => method === "PATCH" && url.pathname === "/api/v1/notification-recipients/recipient-contract-1");
  expect(recipientRequest?.headers["content-type"]).toBe("application/merge-patch+json");
  expect(recipientRequest?.headers["if-match"]).toBe('"recipient-contract-v1"');
  expect(requests.some(({ method, url }) => method === "POST" && url.pathname === "/api/v1/notifications/test")).toBe(true);
  expect(requests.some(({ method, url }) => method === "PATCH" && url.pathname === "/api/v1/notifications/notification-contract-1")).toBe(true);
  expect(requests.some(({ method, url }) => method === "POST" && url.pathname === "/api/v1/notifications/read-all")).toBe(true);
  expect(requests.some(({ method, url }) => method === "POST" && url.pathname === "/api/v1/notification-recipients")).toBe(true);

  await page.getByRole("button", { name: "관리자 메뉴" }).click();
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(requests.some(({ method, url }) => method === "DELETE" && url.pathname === "/api/v1/session")).toBe(true);
  for (const path of [
    "/api/v1/notifications/read-all",
    "/api/v1/settings/alerts",
    "/api/v1/notification-recipients/recipient-contract-1",
    "/api/v1/notification-recipients",
    "/api/v1/notifications/test",
    "/api/v1/session",
  ]) {
    const mutation = requests.find(({ method, url }) => method !== "GET" && method !== "POST" && url.pathname === path)
      ?? requests.find(({ method, url }) => method === "POST" && url.pathname === path && path !== "/api/v1/session");
    expect(mutation?.headers["x-csrf-token"], path).toBe("csrf-contract-example");
  }
});
