import { expect, test } from "@playwright/test";

import type { components } from "../src/generated/backend-contract.js";

test("실제 관리자 설정과 대상 저장, 테스트 접수 및 사용자별 읽음 상태를 검증한다", async ({ page, playwright }) => {
  const login = await page.request.post("/api/v1/session", { data: { username: "admin", password: process.env.SYNC_ADMIN_PASSWORD, persistent: false } });
  expect(login.status()).toBe(200);
  const session = await login.json() as components["schemas"]["Session"];
  const originalResponse = await page.request.get("/api/v1/settings/alerts?pit_id=pit-01");
  expect(originalResponse.status()).toBe(200);
  const original = await originalResponse.json() as components["schemas"]["AlertSettings"];
  try {
    await page.goto("/admin");
    await expect(page.locator(".admin-content .card")).toHaveCount(4);
    await page.getByLabel("변경값").fill("87");
    const save = page.waitForResponse(response => response.request().method() === "PUT" && new URL(response.url()).pathname === "/api/v1/settings/alerts");
    await page.getByRole("button", { name: "수거 설정 저장" }).click();
    expect((await save).status()).toBe(200);
    await expect(page.locator(".threshold-applied strong")).toHaveText("87%");
    await page.getByRole("combobox", { name: "발송 시점" }).click();
    await page.getByRole("option", { name: "5분 후" }).click();
    await page.getByRole("button", { name: "정책 저장" }).click();
    await expect(page.getByText("알림 정책을 저장했습니다.", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("combobox", { name: "발송 시점" })).toHaveText("5분 후");
    await expect(page.locator(".threshold-applied strong")).toHaveText("87%");

    await page.getByRole("button", { name: "알림 대상 추가" }).click();
    const dialog = page.getByRole("dialog", { name: "알림 대상 추가" });
    await dialog.getByLabel("이름").fill("검증 담당자");
    await dialog.getByLabel("소속").fill("검증팀");
    await dialog.getByRole("textbox", { name: "이메일" }).fill("integration-admin@example.com");
    await dialog.getByLabel("전화번호").fill("010-0000-0000");
    await dialog.getByRole("button", { name: "알림 대상 추가", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(".recipients-table-wrap")).toContainText("integration-admin@example.com");
    await page.getByRole("button", { name: "수신 설정", exact: true }).click();
    const preferences = page.getByRole("dialog", { name: "검증 담당자 수신 설정" });
    await preferences.getByText("문자", { exact: true }).click();
    await expect(preferences.getByRole("checkbox", { name: "문자", exact: true })).toBeChecked();
    await preferences.getByRole("button", { name: "수신 설정 저장" }).click();
    await expect(preferences).toBeHidden();
    await page.reload();
    await expect(page.locator(".recipients-table-wrap tbody")).toContainText("이메일, 문자");

    const recipients = await (await page.request.get("/api/v1/notification-recipients?page=1&pageSize=100")).json() as components["schemas"]["NotificationRecipientPage"];
    const recipient = recipients.items.find(item => item.email === "integration-admin@example.com");
    expect(recipient).toBeDefined();
    const rejected = await page.request.post("/api/v1/notifications/test", { data: { recipientId: recipient!.id, channels: ["email"] } });
    expect(rejected.status()).toBe(403);
    const accepted = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/notifications/test");
    await page.getByRole("button", { name: "테스트 알림 보내기" }).click();
    expect((await accepted).status()).toBe(202);
    await expect(page.getByText("테스트 알림 요청을 접수했습니다.", { exact: true })).toBeVisible();
    const response = await page.request.get("/api/v1/notifications?page=1&pageSize=100");
    expect(response.status()).toBe(200);
    const notifications = await response.json() as components["schemas"]["NotificationPage"];
    const notification = notifications.items.find(item => item.detail.includes("검증 담당자"));
    expect(notification).toBeDefined();
    await page.getByRole("button", { name: /^알림 [1-9][0-9]*건$/ }).click();
    const popover = page.getByLabel("최근 알림");
    await expect(popover).toContainText(notification!.detail);
    const readAll = page.waitForResponse(result => result.request().method() === "POST" && new URL(result.url()).pathname === "/api/v1/notifications/read-all");
    await popover.getByRole("button", { name: "모두 읽음", exact: true }).click();
    expect((await readAll).status()).toBe(204);
    await expect(page.getByRole("button", { name: "알림 0건", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "알림 0건", exact: true })).toBeVisible();

    const viewer = await playwright.request.newContext({ baseURL: "http://backend:8000" });
    try {
      expect((await viewer.post("/api/v1/session", { data: { username: "operator", password: process.env.SYNC_VIEWER_PASSWORD, persistent: false } })).status()).toBe(200);
      expect((await viewer.get("/api/v1/settings/alerts?pit_id=pit-01")).status()).toBe(403);
      const ownNotifications = await (await viewer.get("/api/v1/notifications?page=1&pageSize=100")).json() as components["schemas"]["NotificationPage"];
      expect(ownNotifications.items.find(item => item.id === notification!.id)?.readAt).toBeNull();
    } finally { await viewer.dispose(); }
  } finally {
    const latest = await (await page.request.get("/api/v1/settings/alerts?pit_id=pit-01")).json() as components["schemas"]["AlertSettings"];
    const settings = Object.fromEntries(Object.entries(original).filter(([key]) => key !== "version"));
    expect((await page.request.put("/api/v1/settings/alerts?pit_id=pit-01", { data: settings, headers: { "X-CSRF-Token": session.csrfToken, "If-Match": latest.version } })).status()).toBe(200);
  }
});
