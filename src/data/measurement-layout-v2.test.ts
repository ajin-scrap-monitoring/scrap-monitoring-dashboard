import { describe, expect, test } from "vitest";

import { measurementLayoutFixture } from "../test/backend-contract-fixtures";
import { parseMeasurementLayoutV2 } from "./measurement-layout-v2";

describe("측정 영역 배치 상태", () => {
  test("simulated가 응답에 없으면 false로 보충하지 않고 null로 둔다", () => {
    const omitted: Record<string, unknown> = measurementLayoutFixture();
    delete omitted.simulated;
    expect(parseMeasurementLayoutV2(omitted, "pit-01").simulated).toBeNull();
    expect(parseMeasurementLayoutV2(measurementLayoutFixture({ simulated: false }), "pit-01").simulated).toBe(false);
    expect(parseMeasurementLayoutV2(measurementLayoutFixture(), "pit-01").simulated).toBe(true);
  });
});
