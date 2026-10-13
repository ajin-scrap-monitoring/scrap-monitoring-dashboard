import { expect, expectTypeOf, test } from "vitest";

import type { components } from "../generated/backend-contract";
import { alertSettingsFixture, eventPageFixture, loadHistoryFixture, monitoringFixture, notificationPageFixture, recipientFixture, sessionFixture } from "../test/api-contract-fixtures";

test("공통 제안 fixture는 실제 Backend 조회 타입과 호환된다", () => {
  expectTypeOf<typeof sessionFixture>().toExtend<components["schemas"]["Session"]>();
  expectTypeOf<typeof monitoringFixture>().toExtend<components["schemas"]["MonitoringSnapshot"]>();
  expectTypeOf<typeof alertSettingsFixture>().toExtend<components["schemas"]["AlertSettings"]>();
  expectTypeOf<typeof loadHistoryFixture>().toExtend<components["schemas"]["LoadHistory"]>();
  expectTypeOf<typeof eventPageFixture>().toExtend<components["schemas"]["EventPage"]>();
  expectTypeOf<typeof notificationPageFixture>().toExtend<components["schemas"]["NotificationPage"]>();
  expectTypeOf<typeof recipientFixture>().toExtend<components["schemas"]["NotificationRecipient"]>();
});

test("Backend 계약은 default 입력의 생략과 ValidationError ctx 속성을 허용한다", () => {
  const login: components["schemas"]["LoginRequest"] = { username: "synthetic-user", password: "public-test-placeholder" };
  const validation: components["schemas"]["ValidationError"] = { loc: ["body"], msg: "Synthetic validation", type: "greater_than_equal", ctx: { ge: 1 } };
  expect(login.persistent).toBeUndefined();
  expect(validation.ctx?.ge).toBe(1);
});
