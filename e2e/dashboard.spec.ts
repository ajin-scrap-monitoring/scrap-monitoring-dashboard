import { expect, test } from "@playwright/test";

test("프로덕션 빌드의 대시보드 진입점을 제공한다", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("main", { name: "스크랩 모니터링 대시보드" }),
  ).toBeAttached();
});
