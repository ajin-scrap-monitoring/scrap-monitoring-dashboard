import { describe, expect, test } from "vitest";

import { lidarProfilesFixture } from "../test/backend-contract-fixtures";

import { parseLidarProfilesV2 } from "./lidar-profiles-v2";

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
});
