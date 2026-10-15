import { expect, test, type Page } from "@playwright/test";

import { installContractApi } from "./contract-api.js";
import { recipientFixture, recipientPageFixture } from "../src/test/api-contract-fixtures.js";

async function geometry(page: Page) {
  return page.locator(".admin-content .card, .threshold-editor, .threshold-alert-settings, .test-alert-card button.admin-outline-button").evaluateAll(elements => elements.map(element => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x: x + window.scrollX, y: y + window.scrollY, width, height };
  }));
}

test("긴 대상 정보는 고정 셀 안에서 생략하고 전체 값과 관리 버튼 포커스를 유지한다", async ({ page }) => {
  await installContractApi(page, { initiallyAuthenticated: true });
  const recipient = { ...recipientFixture, name: "검증 담당자".repeat(20), team: "현장 관리 부서".repeat(20), email: `${"recipient".repeat(6)}@${"department".repeat(5)}.example.com`, phone: "010-0000-0000" };
  let longValues = false;
  await page.route("**/api/v1/notification-recipients?*", route => route.fulfill({ json: { ...recipientPageFixture, items: [longValues ? recipient : recipientFixture] } }));
  await page.goto("/admin?source=api");
  await expect(page.locator(".recipients-table-wrap tbody tr")).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
  const before = await geometry(page);
  const tableGeometry = () => page.locator(".recipients-table-wrap tbody tr, .recipients-table-wrap tbody td").evaluateAll(elements => elements.map(element => {
    const { x, width, height } = element.getBoundingClientRect();
    return { x, width, height };
  }));
  const cellsBefore = await tableGeometry();
  const panelGeometry = () => page.locator(".recipient-panel, .recipient-panel-head, .recipient-panel-body, .recipient-panel-actions").evaluateAll(elements => elements.map(element => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  }));
  await page.getByRole("button", { name: "수신 설정", exact: true }).click();
  const shortPanel = await panelGeometry();
  await page.getByRole("button", { name: "수신 설정 닫기", exact: true }).click();
  longValues = true;
  await page.reload();
  await expect(page.locator(".recipients-table-wrap tbody td").nth(2)).toContainText(recipient.email);
  await page.evaluate(() => document.fonts.ready);
  expect(await geometry(page)).toEqual(before);
  expect(await tableGeometry()).toEqual(cellsBefore);
  const cells = page.locator(".recipients-table-wrap tbody td");
  for (const [index, value] of [recipient.name, recipient.team, recipient.email].entries()) {
    const text = cells.nth(index).locator(".recipient-cell-text");
    await expect(text).toHaveAttribute("title", value);
    const bounds = await text.boundingBox();
    const cell = await cells.nth(index).boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(cell!.x);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(cell!.x + cell!.width);
    expect(await text.evaluate(element => {
      const style = getComputedStyle(element);
      return style.textOverflow === "ellipsis" && style.overflowX === "hidden" && element.scrollWidth > element.clientWidth;
    })).toBe(true);
  }
  const button = cells.nth(7).getByRole("button", { name: "수신 설정", exact: true });
  await button.focus();
  await expect(button).toBeFocused();
  expect(await cells.nth(7).evaluate(element => getComputedStyle(element).overflow)).toBe("visible");
  const focus = await button.boundingBox();
  const table = await page.locator(".recipients-table-wrap").boundingBox();
  expect(focus!.x - table!.x).toBeGreaterThan(3);
  expect(table!.x + table!.width - focus!.x - focus!.width).toBeGreaterThan(3);
  const assertNoOverflow = async () => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator(".test-alert-card, .test-alert-card .dropdown-trigger, .test-alert-card .dropdown-option, .recipient-panel, .recipient-panel-head").evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth + 1))).toBe(true);
    expect(await geometry(page)).toEqual(before);
  };
  const target = page.getByRole("combobox", { name: "등록 대상", exact: true });
  await expect(target.locator(".dropdown-value")).toHaveAttribute("title", `${recipient.name} (${recipient.email})`);
  await target.click();
  const option = page.getByRole("option", { name: `${recipient.name} (${recipient.email})`, exact: true });
  await expect(option).toBeVisible();
  await expect(option.locator(".dropdown-option-label")).toHaveAttribute("title", `${recipient.name} (${recipient.email})`);
  await assertNoOverflow();
  await option.click();
  await expect(target).toHaveAttribute("aria-expanded", "false");
  await assertNoOverflow();
  await button.click();
  const panel = page.getByRole("dialog", { name: `${recipient.name} 수신 설정`, exact: true });
  await expect(panel).toBeVisible();
  expect(await panelGeometry()).toEqual(shortPanel);
  await expect(panel.locator(".recipient-panel-head h2")).toHaveAttribute("title", recipient.name);
  await expect(panel.locator(".recipient-panel-head p")).toHaveAttribute("title", `${recipient.team} | ${recipient.email}`);
  const close = panel.getByRole("button", { name: "수신 설정 닫기", exact: true });
  const closeBounds = await close.boundingBox();
  expect(closeBounds!.x).toBeGreaterThanOrEqual(0);
  expect(closeBounds!.x + closeBounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await close.focus();
  await expect(close).toBeFocused();
  await assertNoOverflow();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(button).toBeFocused();
  await button.click();
  await expect(panel).toBeVisible();
  await close.click();
  await expect(panel).toHaveCount(0);
  await expect(button).toBeFocused();
  await assertNoOverflow();
});

test("관리자 저장 충돌과 테스트 접수는 안내 위치만 바꾸고 기존 카드 배치를 유지한다", async ({ page }) => {
  await installContractApi(page, { initiallyAuthenticated: true });
  await page.goto("/admin?source=api");
  await expect(page.locator(".admin-content .card")).toHaveCount(4);
  await page.evaluate(() => document.fonts.ready);
  const before = await geometry(page);
  await page.route("**/api/v1/settings/alerts", route => route.request().method() === "PUT"
    ? route.fulfill({ status: 412, json: { detail: "Synthetic settings conflict" } }) : route.fallback());
  await page.getByRole("button", { name: "수거 설정 저장" }).click();
  await expect(page.getByRole("alert")).toHaveText("다른 변경이 있습니다. 새로고침 후 다시 시도하세요.");
  expect(await geometry(page)).toEqual(before);
  await page.getByRole("button", { name: "테스트 알림 보내기" }).click();
  await expect(page.getByText("테스트 알림 요청을 접수했습니다.", { exact: true })).toBeVisible();
  expect(await geometry(page)).toEqual(before);
  await page.route("**/api/v1/notifications/test", route => route.fulfill({ status: 503, json: { detail: "Synthetic test failure" } }));
  await page.getByRole("button", { name: "테스트 알림 보내기" }).click();
  await expect(page.locator(".test-alert-card [role=alert]")).toHaveText("테스트 알림 요청을 처리하지 못했습니다.");
  expect(await geometry(page)).toEqual(before);
  await expect(page.locator(".test-alert-card")).toContainText("실제 이메일이나 문자 수신을 보장하지 않습니다.");
});

test("대상 생성 요청 중 닫기를 잠그고 성공한 대상은 목록에 한 번만 반영한다", async ({ page }) => {
  const api = await installContractApi(page, { initiallyAuthenticated: true });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/v1/notification-recipients", async route => {
    if (route.request().method() === "POST") await gate;
    await route.fallback();
  });
  await page.goto("/admin?source=api");
  await page.getByRole("button", { name: "알림 대상 추가" }).click();
  const dialog = page.getByRole("dialog", { name: "알림 대상 추가" });
  await dialog.getByLabel("이름").fill("검증 담당자");
  await dialog.getByLabel("소속").fill("검증팀");
  await dialog.getByRole("textbox", { name: "이메일" }).fill("admin-validation@example.com");
  await dialog.getByRole("button", { name: "알림 대상 추가", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "추가 중" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "알림 대상 추가 닫기" })).toBeDisabled();
  for (const key of ["Tab", "Shift+Tab", "Tab", "Tab"]) {
    await page.keyboard.press(key);
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  release();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".recipients-table-wrap")).toContainText("admin-validation@example.com");
  expect(api.requests.filter(request => request.method === "POST" && request.url.pathname === "/api/v1/notification-recipients")).toHaveLength(1);
});
