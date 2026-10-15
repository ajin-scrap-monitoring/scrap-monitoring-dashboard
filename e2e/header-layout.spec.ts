import { expect, test, type Page } from "@playwright/test";

import { notificationPageFixture, sessionFixture } from "../src/test/api-contract-fixtures.js";
import { installBackendApi } from "./backend-api.js";

function geometry(page: Page) {
  return page.locator(".topbar, .global-nav, .page-heading, .card, .app-footer").evaluateAll(elements => elements.map(element => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x: x + scrollX, y: y + scrollY, width, height };
  }));
}

test("최근 알림 20건은 popover 내부에서 스크롤하고 헤더와 이력 링크를 유지한다", async ({ page }) => {
  const api = await installBackendApi(page);
  const items = Array.from({ length: 20 }, (_, index) => ({ ...notificationPageFixture.items[0], id: `notice-${index}`, title: `알림 ${index + 1}`, detail: "긴 서버 알림 설명 ".repeat(20) }));
  api.setNotifications({ items, unreadCount: 20, page: { page: 1, pageSize: 20, totalItems: 20, totalPages: 1 } });
  await page.goto("/?source=api");
  await expect(page.locator(".monitoring-page")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const before = await geometry(page);
  const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.getByRole("button", { name: "알림 20건", exact: true }).click();
  const popover = page.getByRole("region", { name: "최근 알림", exact: true });
  await expect(popover).toBeInViewport({ ratio: 1 });
  await expect(popover.getByRole("button", { name: "모두 읽음", exact: true })).toBeInViewport({ ratio: 1 });
  const history = popover.getByRole("link", { name: "알림 이력에서 보기", exact: true });
  await expect(history).toBeInViewport({ ratio: 1 });
  expect(await popover.locator(".header-notification-list").evaluate(element => getComputedStyle(element).overflowY === "auto" && element.scrollHeight > element.clientHeight)).toBe(true);
  const notifications = popover.locator(".header-notification");
  await expect(notifications).toHaveCount(20);
  for (let index = 0; index < 20; index += 1) {
    await notifications.nth(index).focus();
    await expect(notifications.nth(index)).toBeFocused();
    await expect(notifications.nth(index)).toBeInViewport({ ratio: 0.99 });
    await expect(notifications.nth(index).locator("strong")).toBeInViewport({ ratio: 1 });
  }
  await expect(history).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(documentHeight);
  expect(await geometry(page)).toEqual(before);
});

test("긴 사용자명은 생략하되 원문과 헤더 높이 및 사용자 메뉴 접근을 유지한다", async ({ page }) => {
  await installBackendApi(page);
  const displayName = "현장모니터링담당자".repeat(10);
  let long = false;
  await page.route("**/api/v1/session", route => route.fulfill({ json: { ...sessionFixture, user: { ...sessionFixture.user, displayName: long ? displayName : sessionFixture.user.displayName } } }));
  await page.goto("/?source=api");
  await expect(page.locator(".monitoring-page")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const before = await geometry(page);
  long = true;
  await page.reload();
  const menu = page.getByRole("button", { name: "사용자 메뉴", exact: true });
  await expect(menu.locator("span")).toHaveAttribute("title", displayName);
  await page.evaluate(() => document.fonts.ready);
  expect(await geometry(page)).toEqual(before);
  expect(await menu.locator("span").evaluate(element => element.scrollWidth > element.clientWidth && getComputedStyle(element).textOverflow === "ellipsis")).toBe(true);
  expect(await menu.locator("svg").evaluateAll(elements => elements.every(element => getComputedStyle(element).flexShrink === "0"))).toBe(true);
  await expect(page.getByRole("button", { name: "알림 1건", exact: true })).toBeInViewport({ ratio: 1 });
  await menu.click();
  await expect(page.locator(".user-popover-profile strong")).toHaveAttribute("title", displayName);
  await expect(page.getByRole("link", { name: "관리자 설정", exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("button", { name: "로그아웃", exact: true })).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  expect(await geometry(page)).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
