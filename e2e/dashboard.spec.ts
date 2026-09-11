import { expect, test } from "@playwright/test";

test("프로덕션 빌드의 대시보드 진입점을 제공한다", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("main", { name: "스크랩 모니터링 대시보드" }),
  ).toBeAttached();
  await expect(
    page.getByRole("heading", { name: "스크랩 모니터링" }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "최근 24시간 대표 적재율 그래프" }),
  ).toBeVisible();
  await expect(page.getByText("LiDAR 2 일부 측정 불가")).toBeVisible();
});

test("합성 시나리오 데이터를 화면에서 확인할 수 있다", async ({ page }) => {
  await page.goto("/?scenario=collection-required");

  await expect(page.getByText("대표 적재율 84%")).toBeVisible();
});

test("합성 실시간 갱신 시나리오는 새 스냅샷을 표시한다", async ({ page }) => {
  await page.goto("/?scenario=live-update");

  await expect(page.locator(".kpi-value")).toHaveText("75%");
  await expect(page.getByText("마지막 측정 10:24:21")).toBeVisible();
});

test("영상 확대 모달은 키보드로 닫고 원래 제어 요소로 돌아간다", async ({ page }) => {
  await page.goto("/");
  const expand = page.getByRole("button", { name: "실시간 영상 크게 보기" });
  await expand.click();
  await expect(page.getByRole("dialog", { name: "실시간 영상 크게 보기" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "실시간 영상 크게 보기" })).toBeHidden();
  await expect(expand).toBeFocused();
});

test("합성 데이터의 로딩, 오류와 데이터 없음 상태를 구분한다", async ({ page }) => {
  await page.goto("/?scenario=loading");
  await expect(page.getByRole("main", { name: "데이터를 불러오는 중입니다." })).toBeVisible();

  await page.goto("/?scenario=request-error");
  await expect(page.getByRole("main", { name: "데이터를 불러올 수 없습니다." })).toBeVisible();
  await expect(page.getByRole("button", { name: "다시 시도" })).toBeVisible();

  await page.goto("/?scenario=no-data");
  await expect(page.getByRole("main", { name: "표시할 모니터링 데이터가 없습니다." })).toBeVisible();
});

test("상단 알림함과 관리자 메뉴를 제공한다", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("아이디").fill("admin");
  await page.getByLabel("비밀번호").fill("test");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.goto("/admin");

  await page.getByRole("button", { name: "알림 3건" }).click();
  await expect(page.getByLabel("최근 알림")).toBeVisible();
  await expect(page.getByLabel("최근 알림").getByText("수거 필요", { exact: true })).toBeVisible();

  await page.getByRole("heading", { name: "관리자 설정" }).click();
  await expect(page.getByLabel("최근 알림")).toBeHidden();

  await page.getByRole("button", { name: "알림 3건" }).click();

  await page.getByRole("button", { name: "모두 읽음" }).click();
  await expect(page.getByRole("button", { name: "알림 0건" })).toBeVisible();

  await page.getByRole("button", { name: "관리자 메뉴" }).click();
  await expect(page.getByRole("link", { name: "관리자 설정" })).toBeVisible();

  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("아이디").fill("admin");
  await page.getByLabel("비밀번호").fill("test");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("상단 브랜드는 현황 화면으로 이동한다", async ({ page }) => {
  await page.goto("/recordings");

  await page.getByRole("link", { name: "AJIN SCRAP MONITORING 홈" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("main", { name: "스크랩 모니터링 대시보드" })).toBeVisible();
});

test("적재율 이력의 이벤트 트랙에서 상세 정보를 제공한다", async ({ page }) => {
  await page.goto("/history");

  const eventMarker = page.getByLabel("2026-09-03 12:00 수거 필요 대표 적재율 80% 도달");
  await eventMarker.hover();
  const chart = page.getByLabel("최근 1주일 대표 적재율 변화 그래프");
  await expect(chart.getByText("2026-09-03 12:00 수거 필요")).toBeVisible();
  await expect(chart.getByText("대표 적재율 80% 도달")).toBeVisible();
});

test("비로그인 사용자는 조회 화면만 사용한다", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("link", { name: "로그인" })).toBeVisible();
  await expect(page.locator("header").getByRole("button", { name: /알림/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "관리자 메뉴" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "관리자", exact: true })).toHaveCount(0);

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("link", { name: "현황 보기" })).toBeVisible();
});
