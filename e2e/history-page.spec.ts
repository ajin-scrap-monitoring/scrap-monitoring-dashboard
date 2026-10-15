import { expect, test } from "@playwright/test";

import { eventFixture, eventPageFixture } from "../src/test/api-contract-fixtures.js";
import { mediaRecordingFixture, monitoringV2StateFixture } from "../src/test/backend-contract-fixtures.js";
import { installBackendApi } from "./backend-api.js";
import { installContractApi } from "./contract-api.js";

test("조회 입력 오류와 실패 안내는 기존 카드와 조회 조건의 위치를 유지한다", async ({ page }) => {
  await installContractApi(page, { initiallyAuthenticated: true });
  await page.goto("/history?source=api");
  await expect(page.locator(".history-content > .card")).toHaveCount(3);
  await page.evaluate(() => document.fonts.ready);
  const geometry = () => page.locator(".history-content > .card, .query-controls").evaluateAll(elements => elements.map(element => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x: x + window.scrollX, y: y + window.scrollY, width, height };
  }));
  const before = await geometry();
  const input = page.getByRole("textbox", { name: "시작 시각", exact: true });
  const start = await input.inputValue();
  await input.fill("invalid");
  await page.getByRole("button", { name: "조회", exact: true }).click();
  const alert = page.locator(".history-query-head [role=alert]");
  await expect(alert).toContainText("올바른 날짜와 시간");
  await expect(alert).toBeVisible();
  expect(await geometry()).toEqual(before);
  const alertBounds = await alert.boundingBox();
  const headingBounds = await page.locator(".history-query-head").boundingBox();
  expect(alertBounds!.y + alertBounds!.height).toBeLessThanOrEqual(headingBounds!.y + headingBounds!.height);
  await input.fill(start);
  let fail = true;
  await page.route("**/api/v1/events?*", route => fail ? route.fulfill({ status: 503, json: { detail: "Synthetic query failure" } }) : route.fallback());
  await page.getByRole("button", { name: "조회", exact: true }).click();
  await expect(alert).toHaveText("이력 데이터를 조회하지 못했습니다. 기존 조회 결과를 유지합니다.");
  await expect(page.getByRole("button", { name: "조회", exact: true })).toBeEnabled();
  expect(await geometry()).toEqual(before);
  await expect(page.locator(".history-query > p")).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "조회", exact: true }).click();
  await expect(alert).toHaveCount(0);
  expect(await geometry()).toEqual(before);
});

for (const threshold of [0, 90, 100]) {
  test(`이력의 현재 임계율 ${threshold}% 문구는 점선 위쪽에 겹침 없이 표시한다`, async ({ page }) => {
    const snapshot = monitoringV2StateFixture("UNAVAILABLE");
    await installBackendApi(page, { initial: { ...snapshot, summary: { ...snapshot.summary, collectionThresholdPercent: threshold } } });
    await page.goto("/history?source=api");
    const chart = page.locator(".history-chart");
    const label = chart.getByText(`현재 임계율 ${threshold}%`, { exact: true });
    await expect(label).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const labelBounds = await label.boundingBox();
    const lineBounds = await chart.locator('path[stroke-dasharray="6 6"]').boundingBox();
    if (!labelBounds || !lineBounds) throw new Error("The threshold label and line must be measurable.");
    expect(lineBounds.y - labelBounds.y - labelBounds.height).toBeGreaterThan(4);
  });
}

test("24시간 이력은 정각 눈금을 사용하며 분 단위 조회 조건을 그대로 전송한다", async ({ page }) => {
  const initial = { ...monitoringV2StateFixture("UNAVAILABLE"), serverTime: "2026-10-15T19:21:34+09:00" };
  const api = await installBackendApi(page, { initial });
  await page.goto("/history?source=api");
  await page.getByRole("button", { name: "최근 24시간", exact: true }).click();
  await page.getByRole("button", { name: "조회", exact: true }).click();
  await expect(page.getByRole("button", { name: "조회", exact: true })).toBeEnabled();
  const chart = page.getByRole("img", { name: "조회 기간 대표 적재율 변화 그래프" });
  await expect(chart.locator('text[y="218"]')).toHaveText(["21:00", "00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00"]);
  const queries = api.requests.filter(url => url.pathname === "/api/v2/monitoring/load-history");
  const query = queries.at(-1)!;
  expect(query.searchParams.get("from")).toBe("2026-10-14T19:21:00+09:00");
  expect(query.searchParams.get("to")).toBe("2026-10-15T19:21:00+09:00");
  await expect(page.getByRole("textbox", { name: "시작 시각", exact: true })).toHaveValue("2026-10-14 19:21");
  await expect(page.getByRole("textbox", { name: "종료 시각", exact: true })).toHaveValue("2026-10-15 19:21");
});

test("기간과 유형 필터는 조회 버튼으로 적용하며 정상 적재율과 현재 임계율 범례를 유지한다", async ({ page }) => {
  const snapshot = monitoringV2StateFixture("UNAVAILABLE");
  const initial = { ...snapshot, summary: { ...snapshot.summary, collectionThresholdPercent: 93 } };
  await installBackendApi(page, { initial });
  const events = [
    { ...eventFixture, id: "evt-col-1", category: "collection" as const, type: "collection_completed" as const, status: "completed" as const, title: "수거 완료", occurredAt: "2026-10-12T03:00:00Z", recordingId: null },
    { ...eventFixture, id: "evt-alt-1", occurredAt: "2026-10-12T06:00:00Z", recordingId: null },
    { ...eventFixture, id: "evt-err-1", category: "error" as const, type: "measurement_error" as const, title: "측정 오류", occurredAt: "2026-10-11T06:00:00Z", recordingId: null },
  ];
  const queries: URL[] = [];
  await page.route("**/api/v1/events?*", route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("pageSize") === "1") return route.fallback();
    queries.push(url);
    const from = Date.parse(url.searchParams.get("from")!);
    const to = Date.parse(url.searchParams.get("to")!);
    const category = url.searchParams.get("category");
    const items = events.filter(event => Date.parse(event.occurredAt) >= from && Date.parse(event.occurredAt) <= to && (!category || category === event.category));
    return route.fulfill({ json: { items, page: { page: 1, pageSize: 100, totalItems: items.length, totalPages: items.length ? 1 : 0 } } });
  });
  await page.goto("/history?source=api");
  const rows = page.locator(".history-events tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(page.getByRole("columnheader", { name: "이벤트 유형", exact: true })).toBeVisible();
  await expect(rows.nth(0).locator("td").nth(2)).toHaveText("완료");
  await expect(rows.nth(1).locator("td").nth(2)).toBeEmpty();
  await expect(rows.nth(2).locator("td").nth(2)).toBeEmpty();
  await expect(rows.nth(1).locator(".event-dot")).toHaveCount(0);
  expect(Date.parse(queries[0].searchParams.get("to")!) - Date.parse(queries[0].searchParams.get("from")!)).toBe(7 * 86_400_000);
  const chart = page.locator(".history-chart");
  const legend = page.getByLabel("그래프 범례");
  await expect(legend).toHaveText("현재 임계율");
  await expect(chart.getByText("현재 임계율 93%", { exact: true })).toBeVisible();
  await expect(chart).not.toContainText("유효한 적재율 데이터가 없습니다.");
  const threshold = await chart.locator('path[stroke-dasharray="6 6"]').getAttribute("d");
  expect(Number(threshold?.match(/^M58 ([\d.]+)H1900$/)?.[1])).toBeCloseTo(192 - 93 * 1.3);
  const paths = () => chart.locator(".history-load-line").evaluateAll(lines => lines.map(line => line.getAttribute("d")));
  expect((await paths()).some(path => /[ML][\d.]+ 192(?: |$)/.test(path ?? ""))).toBe(true);
  expect((await paths()).every(path => !/NaN|Infinity/.test(path ?? ""))).toBe(true);
  const limited = page.getByLabel(/대표 적재율 68.5%, 입력 제한/).first();
  await limited.focus();
  await expect(chart.locator(".history-chart-tooltip")).toContainText("대표 적재율 68.5% / 입력 제한");
  await limited.blur();
  const previousCount = queries.length;
  await page.getByRole("button", { name: "최근 24시간", exact: true }).click();
  await page.getByRole("button", { name: "알림", exact: true }).click();
  await expect(rows).toHaveCount(3);
  expect(queries).toHaveLength(previousCount);
  const apply = async () => {
    const response = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === "/api/v1/events" && url.searchParams.get("pageSize") === "100";
    });
    await page.getByRole("button", { name: "조회", exact: true }).click();
    expect((await response).status()).toBe(200);
    await expect(page.getByRole("button", { name: "조회", exact: true })).toBeEnabled();
  };
  await apply();
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator("td").nth(1)).toHaveText("알림");
  const baseline = await paths();
  for (const [label, category, count] of [["수거", "collection", 1], ["오류", "error", 0], ["전체", null, 2], ["알림", "alert", 1]] as const) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await apply();
    expect(queries.at(-1)?.searchParams.get("category")).toBe(category);
    expect(Date.parse(queries.at(-1)!.searchParams.get("to")!) - Date.parse(queries.at(-1)!.searchParams.get("from")!)).toBe(86_400_000);
    expect(queries.at(-1)?.searchParams.get("pit_id")).toBe(initial.pitId);
    if (count) await expect(rows).toHaveCount(count);
    else await expect(rows).toContainText("조회된 이벤트가 없습니다.");
    expect(await paths()).toEqual(baseline);
    await expect(legend).toHaveText("현재 임계율");
    await expect(chart.getByText("현재 임계율 93%", { exact: true })).toBeVisible();
    await expect(chart.locator(".history-event-target")).toHaveCount(0);
  }
  await page.getByRole("button", { name: "전체", exact: true }).click();
  await page.getByRole("textbox", { name: "시작 시각", exact: true }).fill("2026-10-11T00:00");
  await page.getByRole("textbox", { name: "종료 시각", exact: true }).fill("2026-10-12T00:00");
  await apply();
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator("td").nth(1)).toHaveText("오류");
  expect(Date.parse(queries.at(-1)!.searchParams.get("from")!)).toBe(Date.parse("2026-10-11T00:00:00Z"));
  expect(Date.parse(queries.at(-1)!.searchParams.get("to")!)).toBe(Date.parse("2026-10-12T00:00:00Z"));
  const beforeInvalid = queries.length;
  await page.getByRole("textbox", { name: "시작 시각", exact: true }).fill("2026-10-13T00:00");
  await page.getByRole("button", { name: "조회", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("올바른 날짜와 시간");
  expect(queries).toHaveLength(beforeInvalid);
  await expect(rows).toHaveCount(1);
});

for (const raw of ["Synthetic camera integration check; not a field alert", "Unexpected backend event description; preserve original content"]) {
test(`Backend 설명을 해석하지 않고 제목과 중앙 모달에 원문을 표시한다: ${raw}`, async ({ page }) => {
  const api = await installBackendApi(page);
  await page.route("**/api/v1/events?*", route => new URL(route.request().url()).searchParams.get("category") === "collection"
    ? route.fallback() : route.fulfill({ json: { ...eventPageFixture, items: [{ ...eventFixture, occurredAt: "2026-10-12T00:00:00Z", detail: raw, recordingId: null }] } }));
  await page.goto("/history?source=api");
  const opener = page.getByRole("button", { name: /알림 수거 필요 상세 보기/ });
  await expect(opener).toBeVisible();
  await expect(page.locator(".history-events")).not.toContainText(raw);
  await expect(page.getByLabel("그래프 범례")).toContainText("현재 임계율");
  await expect(page.getByLabel("그래프 범례")).not.toContainText("참고");
  await page.evaluate(() => document.fonts.ready);
  const geometry = () => page.locator(".history-content > .card").evaluateAll(cards => cards.map(card => {
    const { x, y, width, height } = card.getBoundingClientRect();
    return { x, y, width, height };
  }));
  const before = await geometry();
  await opener.click();
  const modal = page.getByRole("dialog", { name: "이벤트 상세", exact: true });
  await expect(modal).toHaveAttribute("aria-modal", "true");
  await expect(modal.getByRole("heading", { name: eventFixture.title, exact: true })).toBeVisible();
  await expect(modal.getByText(raw, { exact: true })).toBeVisible();
  await expect(modal).not.toContainText("실제 현장 경보가 아닙니다.");
  await expect(modal.getByRole("region", { name: "경보 판단 정보" })).toHaveCount(0);
  await expect(modal).not.toContainText("조회 범위");
  await expect(modal.locator("dt").filter({ hasText: /^상태$/ })).toHaveCount(0);
  expect(api.requests.some(url => url.pathname === "/api/v2/monitoring/alerts")).toBe(false);
  const panel = await modal.locator(".monitoring-detail-panel").boundingBox();
  const viewport = page.viewportSize()!;
  expect(panel).not.toBeNull();
  expect(Math.abs(panel!.x + panel!.width / 2 - viewport.width / 2)).toBeLessThan(2);
  expect(Math.abs(panel!.y + panel!.height / 2 - viewport.height / 2)).toBeLessThan(2);
  expect(await geometry()).toEqual(before);
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(await geometry()).toEqual(before);
});
}

for (const failed of [false, true]) {
  test(`이벤트의 영상 보기는 연결된 녹화를 조회하고 ${failed ? "녹화 실패를 표시한다" : "재생과 다운로드를 제공한다"}`, async ({ page }) => {
    const api = await installBackendApi(page);
    const id = "550e8400-e29b-41d4-a716-446655440099";
    api.setRecordings([{ ...mediaRecordingFixture, id,
      status: failed ? "unavailable" : "available", mediaStatus: failed ? "failed" : "ready",
      contentPath: failed ? null : `/media/clips/${id}/content`, downloadPath: failed ? null : `/media/clips/${id}/content?download=true`,
      errorCode: failed ? "NO_FRAMES_AVAILABLE" : null,
    }]);
    await page.route("**/api/v1/events?*", route => new URL(route.request().url()).searchParams.get("category") === "collection"
      ? route.fallback() : route.fulfill({ json: { ...eventPageFixture, items: [{ ...eventFixture, id: "evt-alt-31", occurredAt: "2026-10-12T00:00:00Z", recordingId: id }] } }));
    await page.route("**/api/v2/monitoring/alerts?*", route => route.fulfill({ json: {
      offset: 0, limit: 20, totalItems: 1,
      items: [{ eventId: "evt-alt-31", assessmentId: "assessment-for-event-31", notificationId: "notif-31", loadPercent: 85,
        observedAt: "2026-10-12T00:00:00Z", triggeredAt: "2026-10-12T00:00:01Z", readAt: null }],
    } }));
    await page.goto("/history?source=api");
    const row = page.locator(".history-events tbody tr").first();
    await row.getByRole("button", { name: /수거 필요 상세 보기/ }).click();
    const modal = page.getByRole("dialog", { name: "이벤트 상세", exact: true });
    await expect(modal).toContainText(eventFixture.detail);
    await expect(modal.getByRole("region", { name: "경보 판단 정보" })).toHaveCount(0);
    expect(api.requests.some(url => url.pathname === "/api/v2/monitoring/alerts")).toBe(false);
    await expect(modal.getByRole("link", { name: "관련 녹화 확인" })).toHaveAttribute("href", `/recordings?recordingId=${id}`);
    await page.keyboard.press("Escape");
    await expect(row.getByRole("link", { name: "영상 보기" })).toHaveAttribute("href", `/recordings?recordingId=${id}`);
    await row.getByRole("link", { name: "영상 보기" }).click();
    await expect(page).toHaveURL(new RegExp(`/recordings\\?recordingId=${id}$`));
    await expect(page.getByRole("heading", { name: "녹화 영상", level: 1, exact: true })).toBeVisible();
    expect(api.requests.some(url => url.pathname === `/api/v1/recordings/${id}`)).toBe(true);
    if (failed) {
      await expect(page.locator(".recording-frame video")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "다운로드 불가", exact: true })).toBeDisabled();
      await expect(page.locator(".recording-info")).toContainText("녹화 실패");
    } else {
      await expect(page.locator(".recording-frame video")).toBeVisible();
      await expect(page.getByRole("button", { name: "녹화 영상 다운로드", exact: true })).toBeEnabled();
    }
  });
}
