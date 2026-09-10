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
