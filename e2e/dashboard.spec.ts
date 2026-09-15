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

test("합성 운영 주기 시나리오는 수거와 장애 상태를 순서대로 표시한다", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-10T10:00:00Z") });
  await page.clock.pauseAt(new Date("2026-09-10T10:00:01Z"));
  await page.goto("/?scenario=operation-cycle");
  await expect(page.getByRole("main")).toBeVisible();
  await page.clock.runFor(500);
  await expect(page.getByText("대표 적재율 80%")).toBeVisible();
  await page.clock.runFor(500);
  await expect(page.getByText("수거 완료", { exact: true })).toBeVisible({ timeout: 1500 });
  await page.clock.runFor(500);
  await expect(page.locator(".page-meta").getByText("측정 오류", { exact: true })).toBeVisible({ timeout: 1500 });
  await page.clock.runFor(500);
  await expect(page.locator(".page-meta").getByText("연결 끊김", { exact: true })).toBeVisible({ timeout: 1500 });
  await page.clock.runFor(500);
  await expect(page.getByText("정상", { exact: true }).first()).toBeVisible({ timeout: 1500 });
});

test("기간 선택기는 키보드로 날짜를 선택하고 조회 전 결과를 유지한다", async ({ page }) => {
  for (const path of ["/history", "/recordings"]) {
    await page.goto(path);
    const start = page.getByRole("textbox", { name: "시작 시각", exact: true });
    const resultCount = path === "/history"
      ? page.locator(".history-card-head > span")
      : page.locator(".recordings-card-head > span");
    const previous = await start.inputValue();
    const previousResultCount = await resultCount.textContent();
    await page.getByRole("button", { name: "시작 시각 선택기 열기" }).click();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(start).not.toHaveValue(previous);
    await expect(page.getByRole("button", { name: "시작 시각 선택기 열기" })).toBeFocused();
    await expect(resultCount).toHaveText(previousResultCount ?? "");
  }
});

test("관리자 정책 취소와 대상 추가 모달의 키보드 닫기를 제공한다", async ({ page }) => {
  await page.addInitScript("window.sessionStorage.setItem('scrap-monitoring-authenticated', 'true')");
  await page.goto("/admin");
  const timing = page.getByRole("combobox", { name: "발송 시점", exact: true });
  await timing.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(timing).toHaveText("5분 후");
  await page.locator(".policy-actions").getByRole("button", { name: "취소", exact: true }).click();
  await expect(timing).toHaveText("즉시");
  const add = page.getByRole("button", { name: "알림 대상 추가", exact: true });
  await add.click();
  await expect(page.getByRole("dialog", { name: "알림 대상 추가" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(add).toBeFocused();
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

test("외부 연동 전 요청은 처리 범위를 화면에 표시한다", async ({ page }) => {
  await page.goto("/recordings");
  await page.getByRole("button", { name: "녹화 영상 다운로드" }).click();
  await expect(page.getByRole("status")).toHaveText("예시 데이터에서는 파일을 다운로드하지 않습니다.");

  await page.goto("/login");
  await page.getByLabel("아이디").fill("admin");
  await page.getByLabel("비밀번호").fill("test");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.goto("/admin");
  await page.getByRole("button", { name: "테스트 알림 보내기" }).click();
  await expect(page.getByRole("status")).toHaveText("테스트 알림 요청을 접수했습니다.");
});

test("적재율 이력의 이벤트 트랙에서 상세 정보를 제공한다", async ({ page }) => {
  await page.goto("/history");

  const eventMarker = page.getByLabel("2026-09-03 12:00 수거 필요 대표 적재율 80% 도달");
  await eventMarker.hover();
  const chart = page.getByLabel("조회 기간 대표 적재율 변화 그래프");
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

test("빈 부가 목록은 각 화면의 빈 상태를 유지한다", async ({ page }) => {
  await page.goto("/history?scenario=empty-lists");
  await expect(page.getByText("조회된 이벤트가 없습니다.")).toBeVisible();

  await page.goto("/recordings?scenario=empty-lists");
  await expect(page.getByText("조회된 녹화 영상이 없습니다.")).toBeVisible();
  await expect(page.getByText("선택할 수 있는 녹화 영상이 없습니다.")).toBeVisible();

  await page.addInitScript("window.sessionStorage.setItem('scrap-monitoring-authenticated', 'true')");
  await page.goto("/admin?scenario=empty-lists");
  await expect(page.getByText("등록된 알림 대상이 없습니다.")).toBeVisible();
});

test("녹화 영상 카드의 제목과 영상 영역을 분리한다", async ({ page }) => {
  await page.goto("/recordings");
  const titleBox = await page.locator(".recording-player .section-title").boundingBox();
  const frameBox = await page.locator(".recording-frame").boundingBox();
  expect(titleBox).not.toBeNull();
  expect(frameBox).not.toBeNull();
  expect(frameBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height + 4);

  await page.goto("/recordings?scenario=empty-lists");
  const panelBox = await page.locator(".recordings-empty-panel").boundingBox();
  const emptyTitleBox = await page.locator(".recordings-empty-panel .section-title").boundingBox();
  expect(panelBox).not.toBeNull();
  expect(emptyTitleBox).not.toBeNull();
  expect(emptyTitleBox!.x - panelBox!.x).toBeGreaterThanOrEqual(16);
  expect(emptyTitleBox!.y - panelBox!.y).toBeGreaterThanOrEqual(14);
});

test("이력과 녹화 목록의 필터 및 페이지 이동을 제공한다", async ({ page }) => {
  await page.goto("/history");
  await page.getByRole("button", { name: "다음 이벤트 페이지" }).click();
  await expect(page.getByText("2 / 2")).toBeVisible();
  await page.locator(".history-query").getByRole("button", { name: "오류" }).click();
  await expect(page.getByText("총 9건")).toBeVisible();
  await page.locator(".history-query").getByRole("button", { name: "조회", exact: true }).click();
  await expect(page.getByText("총 1건")).toBeVisible();

  await page.goto("/recordings");
  await page.getByRole("button", { name: "다음 녹화 목록 페이지" }).click();
  await expect(page.getByRole("img", { name: "2026-09-03 녹화 영상" })).toBeVisible();
  await page.locator(".recordings-query").getByRole("button", { name: "오류" }).click();
  await expect(page.locator(".recordings-card-head > span")).toHaveText("7건");
  await page.locator(".recordings-query").getByRole("button", { name: "조회", exact: true }).click();
  await expect(page.getByText("2건")).toBeVisible();
});

test("주요 페이지는 대상 뷰포트에서 수평으로 넘치지 않는다", async ({ page }) => {
  await page.addInitScript("window.sessionStorage.setItem('scrap-monitoring-authenticated', 'true')");

  const pages = [
    ["/", "스크랩 모니터링", 1],
    ["/history", "이력", 1],
    ["/recordings", "녹화 영상", 1],
    ["/admin", "관리자 설정", 1],
    ["/login", "로그인", 2],
  ] as const;

  for (const [path, heading, level] of pages) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: true, level })).toBeVisible();
    const horizontalOverflow = await page.evaluate<number>(
      "document.documentElement.scrollWidth - document.documentElement.clientWidth",
    );
    const maximumCardOverflow = await page.evaluate<number>(
      "Math.max(0, ...[...document.querySelectorAll('.card')].map((element) => element.scrollHeight - element.clientHeight))",
    );
    const footerOverlapCount = await page.evaluate<number>(
      "(() => { const footer = document.querySelector('.app-footer'); if (!footer) return 0; const footerRect = footer.getBoundingClientRect(); return [...document.querySelectorAll('.card')].filter((element) => { const cardRect = element.getBoundingClientRect(); return cardRect.bottom > footerRect.top && cardRect.top < footerRect.bottom; }).length; })()",
    );
    const documentHeight = await page.evaluate<number>("document.documentElement.scrollHeight");
    expect(horizontalOverflow).toBeLessThanOrEqual(0);
    expect(maximumCardOverflow).toBeLessThanOrEqual(2);
    expect(footerOverlapCount).toBe(0);
    expect(documentHeight).toBeLessThanOrEqual(1100);
  }
});

test("주요 페이지의 대화형 요소와 이미지에 접근 가능한 이름을 제공한다", async ({ page }) => {
  await page.addInitScript("window.sessionStorage.setItem('scrap-monitoring-authenticated', 'true')");

  for (const path of ["/", "/history", "/recordings", "/admin", "/login"]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();

    const unnamedControls = await page.evaluate<string[]>(`[...document.querySelectorAll('button, input, select, textarea, a[href]')]
      .filter((element) => {
        const ariaLabel = element.getAttribute('aria-label')?.trim();
        const labelledBy = element.getAttribute('aria-labelledby')
          ?.split(/\\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
          .join(' ')
          .trim();
        const labels = 'labels' in element
          ? [...(element.labels ?? [])].map((label) => label.textContent?.trim() ?? '').join(' ').trim()
          : '';
        return !ariaLabel && !labelledBy && !labels && !element.textContent?.trim() && !element.getAttribute('title');
      })
      .map((element) => element.outerHTML)`);
    const imagesWithoutAlt = await page.locator("img:not([alt])").count();

    expect(unnamedControls).toEqual([]);
    expect(imagesWithoutAlt).toBe(0);
  }
});
