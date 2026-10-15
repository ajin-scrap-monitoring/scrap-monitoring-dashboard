import { expect, test } from "@playwright/test";

import { monitoringV2StateFixture } from "../src/test/backend-contract-fixtures.js";
import { historyV2, installBackendApi, type BackendSnapshot } from "./backend-api.js";

test.use({ timezoneId: "Asia/Seoul" });

for (const source of ["mock", "api"]) {
  test(`${source} 현재 상태의 6개 지표는 같은 크기이며 제목과 값을 구분한다`, async ({ page }) => {
    if (source === "api") await installBackendApi(page, { initial: monitoringV2StateFixture("UNAVAILABLE") });
    await page.goto(`/?source=${source}`);
    const card = page.locator(".kpi-card");
    const metrics = card.locator(".mini-stat");
    await expect(metrics).toHaveCount(6);
    await page.evaluate(() => document.fonts.ready);
    await expect(metrics.locator(".label")).toHaveText([
      "수거 임계율", "적재율 경보", "예상 도달", "1시간 전 적재율", "최근 수거 후 경과", "평균 수거 주기",
    ]);
    const bounds = await card.boundingBox();
    expect(bounds).not.toBeNull();
    const boxes = await metrics.evaluateAll(elements => elements.map(element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      const title = element.querySelector<HTMLElement>(".label")!;
      const value = element.querySelector<HTMLElement>("strong")!;
      return { x, y, width, height, overflowX: element.scrollWidth - element.clientWidth, overflowY: element.scrollHeight - element.clientHeight,
        titleSize: parseFloat(getComputedStyle(title).fontSize), valueSize: parseFloat(getComputedStyle(value).fontSize),
        titleWeight: Number(getComputedStyle(title).fontWeight), valueWeight: Number(getComputedStyle(value).fontWeight),
        valueColor: getComputedStyle(value).color };
    }));
    for (const box of boxes) {
      expect(Math.abs(box.width - boxes[0].width)).toBeLessThanOrEqual(0.1);
      expect(box.height).toBe(boxes[0].height);
      expect(box.overflowX).toBeLessThanOrEqual(1);
      expect(box.overflowY).toBeLessThanOrEqual(1);
      expect(box.valueSize).toBeGreaterThan(box.titleSize);
      expect(box.valueWeight).toBeGreaterThan(box.titleWeight);
      expect(box.valueColor).toBe(boxes[0].valueColor);
      expect(box.y + box.height).toBeLessThanOrEqual(bounds!.y + bounds!.height - 8);
    }
    expect(boxes.slice(0, 3).every(box => box.y === boxes[0].y)).toBe(true);
    expect(boxes.slice(3).every(box => box.y === boxes[3].y)).toBe(true);
    expect(boxes[3].y).toBeGreaterThan(boxes[0].y + boxes[0].height);
  });
}

test("1시간 전 적재율은 서버 이력에서 선택하고 새로고침 및 현재 판단 상태와 독립적으로 표시한다", async ({ page }) => {
  const initial = monitoringV2StateFixture("FRESH", 72.5);
  const api = await installBackendApi(page, { initial });
  let value: number | null = 68.123456;
  let failHistory = false;
  let requests = 0;
  await page.route("**/api/v2/monitoring/load-history?*", route => {
    requests += 1;
    if (failHistory) return route.fulfill({ status: 503, json: { detail: "Synthetic load history failure" } });
    const url = new URL(route.request().url());
    const history = historyV2(url, initial);
    const at = Date.parse(history.to) - 3_600_000 - 1000;
    const observedAt = new Date(at).toISOString();
    return route.fulfill({ json: { ...history, samples: history.samples.map(sample => {
      const present = at >= Date.parse(sample.bucketStartAt) && at < Date.parse(sample.bucketEndAt);
      return { ...sample, generatedAt: present ? observedAt : null, observedAt: present ? observedAt : null,
        assessmentId: present ? "synthetic-past-load" : null, valid: present && value !== null,
        valuePercent: present ? value : null, dataState: present && value !== null ? "AVAILABLE" : "NO_DATA", reasonCodes: [] };
    }) } });
  });
  await page.goto("/?source=api");
  const past = page.locator(".status-details > div").filter({ hasText: "1시간 전 적재율" }).locator("strong");
  await expect(past).toHaveText("68.123456%");
  await expect(past).toHaveAttribute("title", /관측 시각:.*8:00:09/);
  await expect(page.getByText("최근 1시간 변화량", { exact: true })).toHaveCount(0);
  await expect(page.locator(".monitoring-grid > .card")).toHaveCount(8);
  expect(await past.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await api.snapshot(monitoringV2StateFixture("NO_DATA"));
  await expect(page.locator(".kpi-value")).toHaveText("판단 불가");
  await expect(past).toHaveText("68.123456%");
  const before = requests;
  value = 0;
  await page.reload();
  await expect(past).toHaveText("0%");
  expect(requests).toBeGreaterThan(before);
  value = null;
  await page.reload();
  await expect(past).toHaveText("정보 없음");
  failHistory = true;
  await page.reload();
  await expect(past).toHaveText("정보 없음");
});

function deviceSnapshot(): BackendSnapshot {
  const initial = monitoringV2StateFixture("UNAVAILABLE");
  const at = "2026-10-15T00:00:12.123456Z";
  return { ...initial, serverTime: "2026-10-15T00:00:20Z", deviceStatus: {
    ...initial.deviceStatus, connection_state: "REPORTING", effective_state: "DEGRADED", last_received_at: at,
    snapshot: {
      schema_version: "2.0", message_type: "edge_status", message_id: "synthetic-device-status", site_id: "site-demo", edge_id: "edge-demo",
      generated_at: at, config_revision: "synthetic-config-1", orchestrator_instance_id: "synthetic-browser-status", sequence: 1,
      overall_state: "DEGRADED", reason_codes: [], clock: { state: "SYNCED", offset_ms: 0 },
      sensors: [{ sensor_id: "lidar-a", data_state: "FRESH", last_scan_at: at, reason_codes: [] },
        { sensor_id: "lidar-b", data_state: "STALE", last_scan_at: null, reason_codes: [] }], services: [],
      delivery: { pending_messages: 0, pending_bytes: 0, quarantined_messages: 0, last_backend_ack_at: null },
      storage: { limit_bytes: 4096, used_bytes: 0, lost_messages: 0, loss_from: null, loss_to: null, last_loss_reason: null, unavailable_evidence_scan_ids: [] },
    },
  } };
}

test("현황 장비는 상태만 표시하고 scan 시각과 수신 시각 및 지연은 표시하지 않는다", async ({ page }) => {
  const initial = deviceSnapshot();
  await installBackendApi(page, { initial });
  await page.goto("/?source=api");
  const sensor = page.locator(".device").filter({ has: page.getByText("lidar-a", { exact: true }) });
  await expect(sensor.getByText("정상", { exact: true })).toHaveAttribute("title", "FRESH");
  await expect(sensor.locator("time")).toHaveCount(0);
  await expect(page.locator(".devices-card")).toContainText("갱신 지연");
  await expect(page.locator(".devices-card")).toContainText("일부 기능 제한");
  await expect(page.locator(".devices-card time, .devices-card .device-meta")).toHaveCount(0);
  await expect(page.locator(".devices-card")).not.toContainText(/마지막 scan|최근 수신|지연 정보/);
  await expect(page.locator(".kpi-value")).toHaveText("판단 불가");
  await expect(page.locator(".mini-stat").filter({ hasText: "적재율 경보" })).toContainText("미지원");
  const chart = page.getByRole("img", { name: "최근 24시간 대표 적재율 그래프" });
  await expect(chart).toContainText("현재 임계율 85%");
  await expect(chart).not.toContainText("참고");
  const target = page.locator(".chart-point-target").first();
  const at = await target.getAttribute("aria-label");
  expect(at).toMatch(/^09:\d{2} 대표 적재율/);
  await expect(page.getByRole("button", { name: "상태 상세", exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "모니터링 상태 상세", exact: true })).toHaveCount(0);
});

test("카메라 service의 모든 상태와 오래된 장비 보고를 기존 카드 배치에서 구분한다", async ({ page }) => {
  const snapshot = deviceSnapshot();
  const initial = { ...snapshot, deviceStatus: { ...snapshot.deviceStatus, snapshot: {
    ...snapshot.deviceStatus.snapshot!, services: [{ service: "camera-edge", state: "HEALTHY" as const, last_progress_at: snapshot.serverTime, reason_codes: [] }],
  } } };
  const api = await installBackendApi(page, { initial });
  await page.goto("/?source=api");
  const camera = page.locator(".device").filter({ has: page.getByText("카메라", { exact: true }) }).locator(".status-text");
  const sensor = page.locator(".device").filter({ has: page.getByText("lidar-a", { exact: true }) }).locator(".status-text");
  await expect(camera).toHaveText("정상");
  await expect(sensor).toHaveText("정상");
  await expect(page.locator(".kpi-value")).toHaveText("판단 불가");
  const card = page.locator(".devices-card");
  const before = await card.boundingBox();
  for (const [state, label, tone] of [
    ["STARTING", "시작 중", "warning"], ["DEGRADED", "일부 기능 제한", "warning"], ["RETRYING", "재연결 중", "warning"],
    ["FATAL", "사용 불가", "error"], ["UNKNOWN", "확인 불가", ""], ["HEALTHY", "정상", "ok"],
  ] as const) {
    await api.snapshot({ ...initial, deviceStatus: { ...initial.deviceStatus, snapshot: {
      ...initial.deviceStatus.snapshot, services: [{ ...initial.deviceStatus.snapshot.services[0], state }],
    } } });
    await expect(camera).toHaveText(label);
    await expect(camera).toHaveAttribute("title", state);
    if (tone) await expect(camera).toHaveClass(new RegExp(`\\b${tone}\\b`));
  }
  await api.snapshot({ ...initial, deviceStatus: { ...initial.deviceStatus, connection_state: "UNKNOWN", effective_state: "UNKNOWN", reason_codes: ["STATUS_NOT_RECEIVED"] } });
  await expect(camera).toHaveText("확인 불가");
  await expect(sensor).toHaveText("확인 불가");
  await expect(camera).not.toHaveClass(/\bok\b/);
  await expect(sensor).not.toHaveClass(/\bok\b/);
  await api.snapshot(initial);
  await expect(camera).toHaveText("정상");
  await expect(sensor).toHaveText("정상");
  await expect(card.locator("time, .device-meta")).toHaveCount(0);
  await expect(page.locator(".monitoring-grid > .card")).toHaveCount(8);
  expect(await card.boundingBox()).toEqual(before);
});

test("분과 초가 있는 최근 24시간 조회도 시간축만 정각 눈금으로 표시한다", async ({ page }) => {
  const initial = { ...deviceSnapshot(), serverTime: "2026-10-15T10:21:34Z" };
  const api = await installBackendApi(page, { initial });
  await page.goto("/?source=api");
  const chart = page.getByRole("img", { name: "최근 24시간 대표 적재율 그래프" });
  await expect(chart.locator('text[y="166"]')).toHaveText(["21:00", "00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00"]);
  const query = api.requests.find(url => url.pathname === "/api/v2/monitoring/load-history");
  expect(query?.searchParams.get("to")).toBe(initial.serverTime);
  expect(Date.parse(query!.searchParams.get("to")!) - Date.parse(query!.searchParams.get("from")!)).toBe(86_400_000);
  await expect(chart.locator(".chart-point-target").first()).toHaveAttribute("aria-label", /^19:21 대표 적재율/);
});

test("촬영 시각이 없는 영상은 frame 수신 시각을 표시하고 확대해도 같은 규칙을 적용한다", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-15T03:00:00Z") });
  const initial = deviceSnapshot();
  await installBackendApi(page, { initial });
  await page.goto("/?source=api");
  const video = page.locator(".live-frame");
  await expect(video.locator(".live-time")).toHaveText(/^영상 수신 \d{2}:\d{2}:\d{2}$/);
  await expect(video.locator(".live-time")).toHaveAttribute("title", /GMT\+0900/);
  await expect(video).not.toContainText("촬영 시각 미제공");
  const receivedAt = await video.locator("time").getAttribute("datetime");
  expect(Date.parse(receivedAt!)).toBeGreaterThan(Date.parse(initial.serverTime));
  await expect(page.locator(".devices-card").getByText("카메라").locator("..")).toContainText("정보 없음");
  await page.getByRole("button", { name: "실시간 영상 크게 보기" }).click();
  const modal = page.getByRole("dialog", { name: "실시간 영상 크게 보기", exact: true });
  await expect(modal.locator(".live-time")).toHaveText(/^영상 수신 \d{2}:\d{2}:\d{2}$/);
  await expect(page.locator(".live-time")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(video.locator(".live-time")).toHaveText(/^영상 수신 \d{2}:\d{2}:\d{2}$/);
  await expect(page.locator(".live-time")).toHaveCount(1);
});

for (const threshold of [85, 90, 100]) {
  test(`현재 임계율 ${threshold}% 문구는 점선과 겹치지 않고 측정 영역은 제목과 그림만 표시한다`, async ({ page }) => {
    const snapshot = deviceSnapshot();
    const initial = { ...snapshot, summary: { ...snapshot.summary, collectionThresholdPercent: threshold } };
    await installBackendApi(page, { initial });
    await page.goto("/?source=api");
    const chart = page.getByRole("img", { name: "최근 24시간 대표 적재율 그래프" });
    const label = chart.getByText(`현재 임계율 ${threshold}%`, { exact: true });
    await expect(label).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const labelBounds = await label.boundingBox();
    const lineBounds = await chart.locator('path[stroke-dasharray="5 5"]').boundingBox();
    if (!labelBounds || !lineBounds) throw new Error("The threshold label and line must be measurable.");
    expect(lineBounds.y - labelBounds.y - labelBounds.height).toBeGreaterThan(4);
    await expect(page.locator(".measurement-card .monitoring-card-title")).toHaveText("측정 영역");
    await expect(page.locator(".measurement-card svg")).toBeVisible();
    await expect(page.locator(".monitoring-grid > .card")).toHaveCount(8);
  });
}

test("긴 소수 적재율의 tooltip과 장비 표시가 기존 카드 밖으로 넘치지 않는다", async ({ page }) => {
  const initial = deviceSnapshot();
  await installBackendApi(page, { initial });
  const value = 99.123456789;
  await page.route("**/api/v2/monitoring/load-history?*", route => {
    const history = historyV2(new URL(route.request().url()), initial);
    return route.fulfill({ json: { ...history, samples: history.samples.map(sample => sample.valid ? { ...sample, valuePercent: value } : sample) } });
  });
  await page.goto("/?source=api");
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole("img", { name: "최근 24시간 대표 적재율 그래프" }).waitFor();
  const geometry = () => page.locator(".monitoring-grid > .card").evaluateAll(cards => cards.map(card => {
    const { x, y, width, height } = card.getBoundingClientRect();
    return { x, y, width, height };
  }));
  const before = await geometry();
  await page.locator(".chart-point-target").first().focus();
  const tooltip = page.locator(".chart-tooltip");
  await expect(tooltip).toContainText(`대표 적재율 ${value}%`);
  const overflow = await tooltip.evaluate(element => {
    const rect = element.querySelector("rect")!.getBBox();
    return Math.max(...[...element.querySelectorAll("text")].map(text => {
      const box = text.getBBox();
      return box.x + box.width - (rect.x + rect.width);
    }));
  });
  expect(overflow).toBeLessThanOrEqual(0);
  expect(await geometry()).toEqual(before);
  expect(await page.locator(".device").evaluateAll(nodes => Math.max(...nodes.map(node => node.scrollWidth - node.clientWidth)))).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});
