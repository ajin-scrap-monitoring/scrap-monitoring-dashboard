import { describe, expect, test } from "vitest";

import { lidarProfilesFixture } from "../test/backend-contract-fixtures";

import { calculateUnmeasuredRanges, parseLidarProfilesV2 } from "./lidar-profiles-v2";

type Sample = { positionRatio: number | null; height: number | null; valid: boolean; angleMdeg?: number; sourceIndex?: number };

function profilesOf(sensorA: Sample[], sensorB: Sample[] = []) {
  const base = lidarProfilesFixture();
  return { ...base, profiles: [{ ...base.profiles[1], sensorId: "lidar-a", samples: sensorA }, { ...base.profiles[0], sensorId: "lidar-b", samples: sensorB }] };
}

describe("LiDAR profile 표본", () => {
  test("SENSOR_ANGLE 표본은 개수를 20개로 가정하지 않고 위치 없는 무효 표본을 끊김 표지로 보존한다", () => {
    const invalid: Sample[] = Array.from({ length: 605 }, (_, index) => ({ angleMdeg: 270_088 + index, sourceIndex: 1114 + index, positionRatio: null, height: null, valid: false }));
    const valid: Sample[] = Array.from({ length: 195 }, (_, index) => ({ angleMdeg: 338_148 + index, sourceIndex: 1719 + index, positionRatio: 0.985 - index * 0.004, height: 163.9 + index, valid: true }));
    const [first, second] = parseLidarProfilesV2(profilesOf([...invalid, ...valid]), "pit-01");
    expect(first.samples).toHaveLength(800);
    expect(first.samples.slice(0, 605).every((sample) => sample.positionRatio === null && sample.height === null)).toBe(true);
    expect(first.samples.slice(605).every((sample) => sample.positionRatio !== null && sample.height !== null)).toBe(true);
    expect(second.samples).toEqual([]);
  });

  test("유효점, 위치 null 표본, 유효점 순서를 배열 순서대로 보존해 선을 끊을 수 있다", () => {
    const [first] = parseLidarProfilesV2(profilesOf([
      { positionRatio: 0.9, height: 200, valid: true }, { positionRatio: null, height: null, valid: false }, { positionRatio: 0.3, height: 100, valid: true },
    ]), "pit-01");
    expect(first.samples).toEqual([{ positionRatio: 0.9, height: 2 }, { positionRatio: null, height: null }, { positionRatio: 0.3, height: 1 }]);
  });

  test("positionRatio 0이 A, 1이 B이며 서버 값을 반전하거나 재계산하지 않는다", () => {
    const [first] = parseLidarProfilesV2(profilesOf([
      { positionRatio: 0, height: 100, valid: true }, { positionRatio: 0.25, height: 200, valid: true }, { positionRatio: 1, height: 300, valid: true },
    ]), "pit-01");
    expect(first.samples).toEqual([{ positionRatio: 0, height: 1 }, { positionRatio: 0.25, height: 2 }, { positionRatio: 1, height: 3 }]);
  });

  test("valid=false나 null 높이는 null로 두고 유효한 0cm는 0 m로 보존하며 cm를 m로 한 번만 변환한다", () => {
    const [first] = parseLidarProfilesV2(profilesOf([
      { positionRatio: 0, height: 0, valid: true },
      { positionRatio: 0.2, height: 250, valid: false },
      { positionRatio: 0.4, height: null, valid: true },
      { positionRatio: 0.6, height: null, valid: false },
      { positionRatio: 0.8, height: 125, valid: true },
    ]), "pit-01");
    expect(first.samples.map((sample) => sample.height)).toEqual([0, null, null, null, 1.25]);
  });

  test("valid나 height 필드가 없는 표본은 계약 오류로 처리한다", () => {
    expect(() => parseLidarProfilesV2(profilesOf([{ positionRatio: 0.1, valid: true } as unknown as Sample]), "pit-01")).toThrow();
    expect(() => parseLidarProfilesV2(profilesOf([{ positionRatio: 0.1, height: 1 } as unknown as Sample]), "pit-01")).toThrow();
    expect(() => parseLidarProfilesV2(profilesOf([{ positionRatio: 0.1, height: 1, valid: true, angleMdeg: 1.5 }]), "pit-01")).toThrow();
  });

  test("sensorId로 LiDAR 1과 2를 대응하며 배열 순서에 의존하지 않는다", () => {
    const [first, second] = parseLidarProfilesV2(profilesOf([{ positionRatio: 0, height: 100, valid: true }], [{ positionRatio: 1, height: 200, valid: true }]), "pit-01");
    expect([first.label, first.samples[0].height, second.label, second.samples[0].height]).toEqual(["LiDAR 1", 1, "LiDAR 2", 2]);
  });

  test("samples가 누락되었거나 null이면 계약 오류로 처리하고 samples=[]는 표본 없음으로 보존한다", () => {
    const base = lidarProfilesFixture();
    const missingSamples = { ...base, profiles: [{ ...base.profiles[0], samples: undefined }] };
    expect(() => parseLidarProfilesV2(missingSamples, "pit-01")).toThrow("Unexpected v2 LiDAR profile contract.");

    const nullSamples = { ...base, profiles: [{ ...base.profiles[0], samples: null }] };
    expect(() => parseLidarProfilesV2(nullSamples, "pit-01")).toThrow("Unexpected v2 LiDAR profile contract.");

    const emptySamples = { ...base, profiles: [{ ...base.profiles[0], sensorId: "lidar-a", samples: [] }, { ...base.profiles[1], sensorId: "lidar-b", samples: [] }] };
    const [first, second] = parseLidarProfilesV2(emptySamples, "pit-01");
    expect(first.samples).toEqual([]);
    expect(second.samples).toEqual([]);
  });

  test("새 optional field(sampleSource, processingVersion, sourceScanId)를 허용하고 잘못된 sampleSource는 거부한다", () => {
    const base = lidarProfilesFixture();
    const withValidFields = {
      ...base,
      profiles: [
        {
          ...base.profiles[0],
          sensorId: "lidar-a",
          sampleSource: "FILTERED_POINT_CLOUD",
          processingVersion: "ANGULAR_RANGE_MEDIAN_V1",
          sourceScanId: "scan-001",
        },
        {
          ...base.profiles[1],
          sensorId: "lidar-b",
          sampleSource: "MEASUREMENT",
          processingVersion: null,
          sourceScanId: null,
        },
      ],
    };
    const [first, second] = parseLidarProfilesV2(withValidFields, "pit-01");
    expect(first.label).toBe("LiDAR 1");
    expect(second.label).toBe("LiDAR 2");
    expect("sampleSource" in first).toBe(false);
    expect("processingVersion" in first).toBe(false);
    expect("sourceScanId" in first).toBe(false);

    const withInvalidSource = {
      ...base,
      profiles: [{ ...base.profiles[0], sampleSource: "INVALID_SOURCE" }],
    };
    expect(() => parseLidarProfilesV2(withInvalidSource, "pit-01")).toThrow("Unexpected v2 LiDAR profile contract.");

    const withNullSource = {
      ...base,
      profiles: [{ ...base.profiles[0], sampleSource: null }],
    };
    expect(() => parseLidarProfilesV2(withNullSource, "pit-01")).not.toThrow();

    const withInvalidProcessingVersion = {
      ...base,
      profiles: [{ ...base.profiles[0], processingVersion: 123 }],
    };
    expect(() => parseLidarProfilesV2(withInvalidProcessingVersion, "pit-01")).toThrow("Unexpected v2 LiDAR profile contract.");

    const withInvalidScanId = {
      ...base,
      profiles: [{ ...base.profiles[0], sourceScanId: 123 }],
    };
    expect(() => parseLidarProfilesV2(withInvalidScanId, "pit-01")).toThrow("Unexpected v2 LiDAR profile contract.");
  });

  test("Q21 단면 확장 필드(sectionSource, sectionJudgmentState, binSource, sectionFillPercent, rawMeanSectionFillPercent)를 허용하고 형식 오류를 거부한다", () => {
    const base = lidarProfilesFixture();
    const withSectionFields = {
      ...base,
      meanSectionFillPercent: 48.2,
      rawMeanSectionFillPercent: 49.5,
      profiles: [
        {
          ...base.profiles[0],
          sensorId: "lidar-a",
          sampleSource: null,
          sectionSource: "EDGE_SECTION_PROFILE",
          sectionJudgmentState: "LIMITED",
          sectionFillPercent: 51.25,
          samples: [
            { positionRatio: 0.1, height: 100, valid: true, sourceIndex: 0, binSource: "OBSERVED" },
            { positionRatio: 0.5, height: 150, valid: true, sourceIndex: 1, binSource: "INTERPOLATED" },
            { positionRatio: 0.9, height: null, valid: false, sourceIndex: 2, binSource: "UNAVAILABLE" },
          ],
        },
        {
          ...base.profiles[1],
          sensorId: "lidar-b",
          sampleSource: null,
          sectionSource: null,
          sectionJudgmentState: null,
          sectionFillPercent: null,
          samples: [
            { positionRatio: 0.2, height: null, valid: false, sourceIndex: 0, binSource: "MASKED" },
          ],
        },
      ],
    };
    const [first, second] = parseLidarProfilesV2(withSectionFields, "pit-01");
    expect(first.samples).toEqual([
      { positionRatio: 0.1, height: 1 },
      { positionRatio: 0.5, height: 1.5 },
      { positionRatio: 0.9, height: null },
    ]);
    expect(second.samples).toEqual([{ positionRatio: 0.2, height: null }]);

    expect(() => parseLidarProfilesV2({
      ...withSectionFields,
      rawMeanSectionFillPercent: 101,
    }, "pit-01")).toThrow("Unexpected v2 LiDAR profile contract.");

    expect(() => parseLidarProfilesV2({
      ...withSectionFields,
      profiles: [{ ...withSectionFields.profiles[0], sectionSource: "OTHER_SOURCE" }],
    }, "pit-01")).toThrow("Unexpected v2 LiDAR profile contract.");

    expect(() => parseLidarProfilesV2({
      ...withSectionFields,
      profiles: [{ ...withSectionFields.profiles[0], sectionJudgmentState: "INVALID" }],
    }, "pit-01")).toThrow("Unexpected v2 LiDAR profile contract.");

    expect(() => parseLidarProfilesV2({
      ...withSectionFields,
      meanSectionFillPercent: 100.1,
    }, "pit-01")).toThrow("Unexpected v2 LiDAR profile contract.");

    expect(() => parseLidarProfilesV2({
      ...withSectionFields,
      profiles: [{ ...withSectionFields.profiles[0], sectionFillPercent: -1 }],
    }, "pit-01")).toThrow("Unexpected v2 LiDAR profile contract.");

    expect(() => parseLidarProfilesV2({
      ...withSectionFields,
      profiles: [{ ...withSectionFields.profiles[0], samples: [{ positionRatio: 0.1, height: 100, valid: true, binSource: "CONFLICT" }] }],
    }, "pit-01")).toThrow("Unexpected v2 LiDAR profile sample contract.");

    expect(() => parseLidarProfilesV2({
      ...withSectionFields,
      profiles: [{ ...withSectionFields.profiles[0], samples: [{ positionRatio: 0.1, height: 100, valid: true, binSource: null }] }],
    }, "pit-01")).toThrow("Unexpected v2 LiDAR profile sample contract.");
  });

  test("최상위 meanSectionReasonCodes를 각 profile.reasonCodes에 병합하고 잘못된 형식은 거부한다", () => {
    const base = lidarProfilesFixture();
    const withMeanReasons = {
      ...base,
      meanSectionReasonCodes: ["HEIGHT_PAIR_UNMATCHED", "HEIGHT_TEMPORAL_WARMING"],
      profiles: [
        { ...base.profiles[0], sensorId: "lidar-a", reasonCodes: ["HEIGHT_PAIR_UNMATCHED"] },
        { ...base.profiles[1], sensorId: "lidar-b", reasonCodes: [] },
      ],
    };
    const [first, second] = parseLidarProfilesV2(withMeanReasons, "pit-01");
    expect(first.reasonCodes).toEqual(["HEIGHT_PAIR_UNMATCHED", "HEIGHT_TEMPORAL_WARMING"]);
    expect(second.reasonCodes).toEqual(["HEIGHT_PAIR_UNMATCHED", "HEIGHT_TEMPORAL_WARMING"]);

    expect(() => parseLidarProfilesV2({ ...base, meanSectionReasonCodes: "HEIGHT_PAIR_UNMATCHED" }, "pit-01"))
      .toThrow("Unexpected v2 LiDAR profile contract.");
  });
});

describe("calculateUnmeasuredRanges", () => {
  test("가로축 길이의 1% 미만인 앞쪽 또는 뒤쪽 구간은 만들지 않는다 (경계 값 0.009, 0.01, 0.99, 0.991)", () => {
    expect(calculateUnmeasuredRanges([{ positionRatio: 0.009 }, { positionRatio: 1.0 }])).toEqual([]);
    expect(calculateUnmeasuredRanges([{ positionRatio: 0.01 }, { positionRatio: 1.0 }])).toEqual([
      { side: "start", startRatio: 0, endRatio: 0.01, label: "미측정 A 0%~1%" },
    ]);
    expect(calculateUnmeasuredRanges([{ positionRatio: 0.0 }, { positionRatio: 0.99 }])).toEqual([
      { side: "end", startRatio: 0.99, endRatio: 1, label: "미측정 B 99%~100%" },
    ]);
    expect(calculateUnmeasuredRanges([{ positionRatio: 0.0 }, { positionRatio: 0.991 }])).toEqual([]);
  });

  test("중간 결손(positionRatio null 또는 height null) 구간은 1% 미만 짧은 결손까지 모두 빗금 구간으로 생성한다", () => {
    expect(calculateUnmeasuredRanges([
      { positionRatio: 0.0, height: 1.0 },
      { positionRatio: 0.2, height: 1.5 },
      { positionRatio: 0.35, height: null },
      { positionRatio: null, height: null },
      { positionRatio: 0.5, height: 1.8 },
      { positionRatio: 0.7, height: null },
      { positionRatio: 0.85, height: 2.0 },
      { positionRatio: 1.0, height: 2.2 },
    ])).toEqual([
      { side: "middle", startRatio: 0.2, endRatio: 0.5, label: "미측정 20%~50%" },
      { side: "middle", startRatio: 0.5, endRatio: 0.85, label: "미측정 50%~85%" },
    ]);

    expect(calculateUnmeasuredRanges([
      { positionRatio: 0.0, height: 1.0 },
      { positionRatio: 0.495, height: 1.5 },
      { positionRatio: 0.5, height: null },
      { positionRatio: 0.504, height: 1.6 },
      { positionRatio: 1.0, height: 2.0 },
    ])).toEqual([
      { side: "middle", startRatio: 0.495, endRatio: 0.504, label: "미측정 50%~50%" },
    ]);

    // 역순 표본과 양끝 무효 표본 처리
    expect(calculateUnmeasuredRanges([
      { positionRatio: 0.95, height: null },
      { positionRatio: 0.85, height: 2.0 },
      { positionRatio: 0.6, height: 1.8 },
      { positionRatio: 0.4, height: null },
      { positionRatio: 0.2, height: 1.2 },
      { positionRatio: 0.05, height: null },
    ])).toEqual([
      { side: "start", startRatio: 0, endRatio: 0.2, label: "미측정 A 0%~20%" },
      { side: "middle", startRatio: 0.2, endRatio: 0.6, label: "미측정 20%~60%" },
      { side: "end", startRatio: 0.85, endRatio: 1, label: "미측정 B 85%~100%" },
    ]);
  });
});
