import { describe, expect, it } from "vitest";

import {
  formatThumbnailStatusText,
  getThumbnailAdminAction,
  isCanonicalUuid,
  isValidThumbnailContentPath,
  parseThumbnailInfo,
  thumbnailErrorNotice,
  type ThumbnailTarget,
} from "./recording-thumbnail";

describe("recording-thumbnail", () => {
  const clipTarget: ThumbnailTarget = { kind: "clip", id: "018f4a30-9b4a-7b3b-8d3f-5c2b3a1a0001" };
  const dailyTarget: ThumbnailTarget = { kind: "daily", id: "018f4a30-9b4a-7b3b-8d3f-5c2b3a1a0002" };

  describe("isCanonicalUuid", () => {
    it("canonical 소문자 UUID만 통과하고 대문자나 잘못된 형식은 거부한다", () => {
      expect(isCanonicalUuid("018f4a30-9b4a-7b3b-8d3f-5c2b3a1a0001")).toBe(true);
      expect(isCanonicalUuid("018F4A30-9B4A-7B3B-8D3F-5C2B3A1A0001")).toBe(false);
      expect(isCanonicalUuid("018f4a309b4a7b3b8d3f5c2b3a1a0001")).toBe(false);
      expect(isCanonicalUuid("not-a-uuid")).toBe(false);
    });
  });

  describe("isValidThumbnailContentPath", () => {
    it("규격에 맞는 고정 경로만 허용하고 다른 경로는 거부한다", () => {
      expect(isValidThumbnailContentPath("clip", clipTarget.id, `/media/clips/${clipTarget.id}/thumbnail`)).toBe(true);
      expect(isValidThumbnailContentPath("daily", dailyTarget.id, `/media/daily-recordings/${dailyTarget.id}/thumbnail`)).toBe(true);
      expect(isValidThumbnailContentPath("clip", clipTarget.id, `/media/other/${clipTarget.id}/thumbnail`)).toBe(false);
      expect(isValidThumbnailContentPath("clip", clipTarget.id, `/media/clips/different-id/thumbnail`)).toBe(false);
      expect(isValidThumbnailContentPath("daily", dailyTarget.id, `/media/clips/${dailyTarget.id}/thumbnail`)).toBe(false);
      expect(isValidThumbnailContentPath("daily", dailyTarget.id, null)).toBe(false);
    });
  });

  describe("parseThumbnailInfo", () => {
    it("ready 상태의 정상 응답을 검증하고 변환한다", () => {
      const raw = {
        camera_id: "cam-1",
        clip_id: clipTarget.id,
        content_path: `/media/clips/${clipTarget.id}/thumbnail`,
        generated_at: "2026-11-05T08:00:00Z",
        height: 360,
        reason_code: null,
        representative_at: "2026-11-05T07:55:00Z",
        size_bytes: 45000,
        status: "ready",
        time_basis: "server_received_at",
        width: 640,
      };
      const parsed = parseThumbnailInfo(raw, clipTarget)!;
      expect(parsed.status).toBe("ready");
      expect(parsed.contentPath).toBe(`/media/clips/${clipTarget.id}/thumbnail`);
      expect(parsed.width).toBe(640);
      expect(parsed.height).toBe(360);
      expect(parsed.sizeBytes).toBe(45000);
      expect(parsed.representativeAt).toBe("2026-11-05T07:55:00Z");
      expect(parsed.timeBasis).toBe("server_received_at");
      expect(parsed.generatedAt).toBe("2026-11-05T08:00:00Z");
    });

    it("ready 상태에서 representative_at이 null이고 reason_code가 TIMELINE_UNAVAILABLE인 경우를 허용한다", () => {
      const raw = {
        camera_id: "cam-1",
        recording_id: dailyTarget.id,
        content_path: `/media/daily-recordings/${dailyTarget.id}/thumbnail`,
        generated_at: "2026-11-05T08:00:00Z",
        height: 360,
        reason_code: "TIMELINE_UNAVAILABLE",
        representative_at: null,
        size_bytes: 45000,
        status: "ready",
        time_basis: null,
        width: 640,
      };
      const parsed = parseThumbnailInfo(raw, dailyTarget)!;
      expect(parsed.status).toBe("ready");
      expect(parsed.representativeAt).toBeNull();
      expect(parsed.timeBasis).toBeNull();
      expect(parsed.reasonCode).toBe("TIMELINE_UNAVAILABLE");
    });

    it("ready 상태에서 치수나 바이트가 양수가 아니면 예외를 던진다", () => {
      const base = {
        camera_id: "cam-1",
        clip_id: clipTarget.id,
        content_path: `/media/clips/${clipTarget.id}/thumbnail`,
        generated_at: "2026-11-05T08:00:00Z",
        height: 360,
        reason_code: null,
        representative_at: null,
        size_bytes: 45000,
        status: "ready",
        time_basis: null,
        width: 0,
      };
      expect(() => parseThumbnailInfo(base, clipTarget)).toThrow("positive integer width");
      expect(() => parseThumbnailInfo({ ...base, width: 640, height: -1 }, clipTarget)).toThrow("positive integer height");
      expect(() => parseThumbnailInfo({ ...base, width: 640, size_bytes: 0 }, clipTarget)).toThrow("positive integer size_bytes");
    });

    it("ready 상태에서 content_path가 규칙과 다르면 예외를 던진다", () => {
      const raw = {
        camera_id: "cam-1",
        clip_id: clipTarget.id,
        content_path: "/static/different.jpg",
        generated_at: "2026-11-05T08:00:00Z",
        height: 360,
        reason_code: null,
        representative_at: null,
        size_bytes: 45000,
        status: "ready",
        time_basis: null,
        width: 640,
      };
      expect(() => parseThumbnailInfo(raw, clipTarget)).toThrow("matching the expected path pattern");
    });

    it("unsupported와 pending 상태는 이미지/시각/사유가 모두 null이어야 한다", () => {
      const raw = {
        camera_id: "cam-1",
        clip_id: clipTarget.id,
        content_path: null,
        generated_at: null,
        height: null,
        reason_code: null,
        representative_at: null,
        size_bytes: null,
        status: "pending",
        time_basis: null,
        width: null,
      };
      expect(parseThumbnailInfo(raw, clipTarget)!.status).toBe("pending");
      expect(() => parseThumbnailInfo({ ...raw, reason_code: "SOME_CODE" }, clipTarget)).toThrow("null reason_code");
      expect(() => parseThumbnailInfo({ ...raw, width: 100 }, clipTarget)).toThrow("null image properties");
    });

    it("unavailable과 failed 상태는 이미지/시각이 null이고 reason_code가 필수다", () => {
      const raw = {
        camera_id: "cam-1",
        recording_id: dailyTarget.id,
        content_path: null,
        generated_at: null,
        height: null,
        reason_code: "DAILY_MP4_REQUIRED",
        representative_at: null,
        size_bytes: null,
        status: "unavailable",
        time_basis: null,
        width: null,
      };
      expect(parseThumbnailInfo(raw, dailyTarget)!.status).toBe("unavailable");
      expect(() => parseThumbnailInfo({ ...raw, reason_code: null }, dailyTarget)).toThrow("non-empty reason_code");
      expect(() => parseThumbnailInfo({ ...raw, content_path: "/media/path" }, dailyTarget)).toThrow("null image properties");
    });

    it("식별자가 일치하지 않으면 예외를 던진다", () => {
      const raw = {
        camera_id: "cam-1",
        clip_id: "018f4a30-9b4a-7b3b-8d3f-5c2b3a1a9999",
        content_path: null,
        generated_at: null,
        height: null,
        reason_code: null,
        representative_at: null,
        size_bytes: null,
        status: "pending",
        time_basis: null,
        width: null,
      };
      expect(() => parseThumbnailInfo(raw, clipTarget)).toThrow("Clip ID mismatch");
    });

    it("이벤트 대상의 null 응답은 null을 반환한다", () => {
      const eventTarget: ThumbnailTarget = { kind: "event", eventId: "evt-1", path: "/api/v2/recordings/events/evt-1/thumbnail-info" };
      expect(parseThumbnailInfo(null, eventTarget)).toBeNull();
    });

    it("이벤트 대상의 응답에 canonical UUID clip_id가 없거나 형식이 다르면 예외를 던진다", () => {
      const eventTarget: ThumbnailTarget = { kind: "event", eventId: "evt-1", path: "/api/v2/recordings/events/evt-1/thumbnail-info" };
      expect(() => parseThumbnailInfo({ camera_id: "cam-1", clip_id: "invalid-uuid", status: "pending", content_path: null, reason_code: null, representative_at: null, time_basis: null, generated_at: null, width: null, height: null, size_bytes: null }, eventTarget)).toThrow("canonical UUID clip_id");
    });

    it("이벤트 대상의 ready 응답을 정상 변환하고 응답 clip_id를 보존한다", () => {
      const eventTarget: ThumbnailTarget = { kind: "event", eventId: "evt-1", path: "/api/v2/recordings/events/evt-1/thumbnail-info" };
      const raw = {
        camera_id: "cam-1",
        clip_id: "6412c932-abad-470e-ba71-c183874fad5a",
        content_path: "/media/clips/6412c932-abad-470e-ba71-c183874fad5a/thumbnail",
        generated_at: "2026-11-06T07:13:11Z",
        height: 360,
        reason_code: "TIMELINE_UNAVAILABLE",
        representative_at: null,
        size_bytes: 10221,
        status: "ready",
        time_basis: null,
        width: 640,
      };
      const parsed = parseThumbnailInfo(raw, eventTarget);
      expect(parsed).not.toBeNull();
      expect(parsed!.kind).toBe("event");
      expect(parsed!.id).toBe("evt-1");
      expect(parsed!.clipId).toBe("6412c932-abad-470e-ba71-c183874fad5a");
      expect(parsed!.contentPath).toBe("/media/clips/6412c932-abad-470e-ba71-c183874fad5a/thumbnail");
    });

    it("dailyDate 대상의 null 응답은 null을 반환한다", () => {
      const dailyDateTarget: ThumbnailTarget = {
        kind: "dailyDate",
        date: "2026-11-08",
        path: "/api/v2/recordings/daily/by-date/2026-11-08/thumbnail-info",
      };
      expect(parseThumbnailInfo(null, dailyDateTarget)).toBeNull();
    });

    it("dailyDate 대상의 응답에 canonical UUID recording_id가 없거나 대문자면 예외를 던진다", () => {
      const dailyDateTarget: ThumbnailTarget = {
        kind: "dailyDate",
        date: "2026-11-08",
        path: "/api/v2/recordings/daily/by-date/2026-11-08/thumbnail-info",
      };
      const base = {
        camera_id: "cam-1",
        status: "ready",
        content_path: "/media/daily-recordings/cb955a1c-88f3-403d-acc8-ea8361e05c46/thumbnail",
        width: 640,
        height: 360,
        size_bytes: 10000,
        generated_at: "2026-11-08T00:00:00Z",
        representative_at: null,
        time_basis: null,
        reason_code: null,
      };
      expect(() => parseThumbnailInfo({ ...base, recording_id: "not-a-uuid" }, dailyDateTarget)).toThrow("canonical UUID recording_id");
      expect(() => parseThumbnailInfo({ ...base, recording_id: "CB955A1C-88F3-403D-ACC8-EA8361E05C46" }, dailyDateTarget)).toThrow("canonical UUID recording_id");
    });

    it("dailyDate 대상의 ready 응답을 변환하고 응답 recording_id를 id와 recordingId에 보존한다", () => {
      const dailyDateTarget: ThumbnailTarget = {
        kind: "dailyDate",
        date: "2026-11-08",
        path: "/api/v2/recordings/daily/by-date/2026-11-08/thumbnail-info",
      };
      const recId = "cb955a1c-88f3-403d-acc8-ea8361e05c46";
      const raw = {
        camera_id: "cam-1",
        recording_id: recId,
        status: "ready",
        content_path: `/media/daily-recordings/${recId}/thumbnail`,
        width: 640,
        height: 360,
        size_bytes: 10609,
        reason_code: "TIMELINE_UNAVAILABLE",
        representative_at: null,
        time_basis: null,
        generated_at: "2026-11-08T00:00:22Z",
      };
      const parsed = parseThumbnailInfo(raw, dailyDateTarget);
      expect(parsed).not.toBeNull();
      expect(parsed!.kind).toBe("dailyDate");
      expect(parsed!.id).toBe(recId);
      expect(parsed!.recordingId).toBe(recId);
      expect(parsed!.contentPath).toBe(`/media/daily-recordings/${recId}/thumbnail`);
      expect(parsed!.reasonCode).toBe("TIMELINE_UNAVAILABLE");
    });

    it("dailyDate 대상의 content_path가 recording_id와 일치하지 않으면 예외를 던진다", () => {
      const dailyDateTarget: ThumbnailTarget = {
        kind: "dailyDate",
        date: "2026-11-08",
        path: "/api/v2/recordings/daily/by-date/2026-11-08/thumbnail-info",
      };
      const recId = "cb955a1c-88f3-403d-acc8-ea8361e05c46";
      const raw = {
        camera_id: "cam-1",
        recording_id: recId,
        status: "ready",
        content_path: "/media/daily-recordings/018f4a30-9b4a-7b3b-8d3f-5c2b3a1a0001/thumbnail",
        width: 640,
        height: 360,
        size_bytes: 10609,
        reason_code: null,
        representative_at: null,
        time_basis: null,
        generated_at: "2026-11-08T00:00:22Z",
      };
      expect(() => parseThumbnailInfo(raw, dailyDateTarget)).toThrow("matching the expected path pattern");
    });
  });

  describe("thumbnailErrorNotice", () => {
    it("HTTP 오류 코드별 짧은 안내를 반환한다", () => {
      expect(thumbnailErrorNotice(401)).toBe("로그인이 필요합니다.");
      expect(thumbnailErrorNotice(404)).toBe("이미지 없음");
      expect(thumbnailErrorNotice(409)).toBe("준비 중");
      expect(thumbnailErrorNotice(410)).toBe("파일 삭제 또는 만료");
      expect(thumbnailErrorNotice(422)).toBe("잘못된 요청");
      expect(thumbnailErrorNotice(502)).toBe("미디어 응답 오류");
      expect(thumbnailErrorNotice(503)).toBe("통신 실패");
      expect(thumbnailErrorNotice(504)).toBe("시간 초과");
      expect(thumbnailErrorNotice(500)).toBe("오류 (500)");
    });
  });

  describe("formatThumbnailStatusText", () => {
    it("ready 상태에서 representative_at이 있으면 서버 수신 기준 시각을 표시한다", () => {
      const info = {
        kind: "clip" as const,
        id: clipTarget.id,
        cameraId: "cam-1",
        status: "ready" as const,
        contentPath: `/media/clips/${clipTarget.id}/thumbnail`,
        width: 640,
        height: 360,
        sizeBytes: 1000,
        reasonCode: null,
        representativeAt: "2026-11-05T09:00:00Z",
        timeBasis: "server_received_at" as const,
        generatedAt: "2026-11-05T09:05:00Z",
      };
      const result = formatThumbnailStatusText(info);
      expect(result.text).toContain("서버 수신 기준");
      expect(result.text).not.toContain("촬영");
    });

    it("ready 상태에서 representative_at이 null이면 시각 정보 없음으로 표시한다", () => {
      const info = {
        kind: "daily" as const,
        id: dailyTarget.id,
        cameraId: "cam-1",
        status: "ready" as const,
        contentPath: `/media/daily-recordings/${dailyTarget.id}/thumbnail`,
        width: 640,
        height: 360,
        sizeBytes: 1000,
        reasonCode: "TIMELINE_UNAVAILABLE",
        representativeAt: null,
        timeBasis: null,
        generatedAt: "2026-11-05T09:05:00Z",
      };
      expect(formatThumbnailStatusText(info).text).toBe("시각 정보 없음");
    });

    it("pending, unsupported, unavailable, failed 상태별 문구를 검증한다", () => {
      expect(formatThumbnailStatusText({
        kind: "clip",
        id: clipTarget.id,
        cameraId: "cam-1",
        status: "pending",
        contentPath: null,
        width: null,
        height: null,
        sizeBytes: null,
        reasonCode: null,
        representativeAt: null,
        timeBasis: null,
        generatedAt: null,
      }).text).toBe("준비 중");

      expect(formatThumbnailStatusText({
        kind: "clip",
        id: clipTarget.id,
        cameraId: "cam-1",
        status: "unavailable",
        contentPath: null,
        width: null,
        height: null,
        sizeBytes: null,
        reasonCode: "NOT_PREPARED",
        representativeAt: null,
        timeBasis: null,
        generatedAt: null,
      }).text).toBe("제공 안 됨 (NOT_PREPARED)");

      expect(formatThumbnailStatusText({
        kind: "clip",
        id: clipTarget.id,
        cameraId: "cam-1",
        status: "failed",
        contentPath: null,
        width: null,
        height: null,
        sizeBytes: null,
        reasonCode: "GENERATION_TIMEOUT",
        representativeAt: null,
        timeBasis: null,
        generatedAt: null,
      }).text).toBe("실패 (GENERATION_TIMEOUT)");
    });

    it("오류 상태가 전달되면 오류 안내 문구와 alert role을 반환한다", () => {
      const result = formatThumbnailStatusText(null, 404);
      expect(result.text).toBe("이미지 없음");
      expect(result.role).toBe("alert");
    });

    it("info가 null이면 '연결된 구간 파일 없음'을 반환한다", () => {
      expect(formatThumbnailStatusText(null).text).toBe("연결된 구간 파일 없음");
    });

    it("info가 undefined이면 '확인 중'을 반환한다", () => {
      expect(formatThumbnailStatusText(undefined).text).toBe("확인 중");
    });

    it("RECORDING_BUSY는 보류로 '녹화 중 생성 보류'를 반환한다", () => {
      const busy = {
        kind: "dailyDate" as const,
        id: "cb955a1c-88f3-403d-acc8-ea8361e05c46",
        cameraId: "cam-1",
        status: "unavailable" as const,
        contentPath: null,
        width: null,
        height: null,
        sizeBytes: null,
        reasonCode: "RECORDING_BUSY",
        representativeAt: null,
        timeBasis: null,
        generatedAt: null,
      };
      expect(formatThumbnailStatusText(busy).text).toBe("녹화 중 생성 보류");
    });

    it("dailyDate 대상의 null 응답은 '날짜 대표 이미지 없음'을 반환한다", () => {
      expect(formatThumbnailStatusText(null, null, "dailyDate").text).toBe("날짜 대표 이미지 없음");
    });

    it("dailyDate ready 응답은 문구 앞에 '날짜 대표 이미지'를 붙인다", () => {
      const readyWithTime = {
        kind: "dailyDate" as const,
        id: "cb955a1c-88f3-403d-acc8-ea8361e05c46",
        cameraId: "cam-1",
        status: "ready" as const,
        contentPath: "/media/daily-recordings/cb955a1c-88f3-403d-acc8-ea8361e05c46/thumbnail",
        width: 640,
        height: 360,
        sizeBytes: 1000,
        reasonCode: null,
        representativeAt: "2026-11-08T00:00:00Z",
        timeBasis: "server_received_at" as const,
        generatedAt: "2026-11-08T00:05:00Z",
      };
      const resultTime = formatThumbnailStatusText(readyWithTime);
      expect(resultTime.text).toContain("날짜 대표 이미지, 서버 수신 기준");

      const readyWithoutTime = {
        ...readyWithTime,
        representativeAt: null,
        timeBasis: null,
        reasonCode: "TIMELINE_UNAVAILABLE",
      };
      const resultNoTime = formatThumbnailStatusText(readyWithoutTime);
      expect(resultNoTime.text).toBe("날짜 대표 이미지, 시각 정보 없음");
    });
  });

  describe("getThumbnailAdminAction", () => {
    it("조회 사용자(viewer)에게는 버튼을 표시하지 않는다", () => {
      expect(getThumbnailAdminAction(false, null).canPrepare).toBe(false);
      expect(getThumbnailAdminAction(false, {
        kind: "clip",
        id: clipTarget.id,
        cameraId: "cam-1",
        status: "failed",
        contentPath: null,
        width: null,
        height: null,
        sizeBytes: null,
        reasonCode: "ERROR",
        representativeAt: null,
        timeBasis: null,
        generatedAt: null,
      }).canPrepare).toBe(false);
    });

    it("관리자에게 상태별로 버튼 표시와 재시도 구분을 반환한다", () => {
      // info 없음 또는 404
      // 조회 중과 오류 상태에는 준비 가능 여부를 알 수 없어 버튼을 표시하지 않는다.
      expect(getThumbnailAdminAction(true, null)).toEqual({ canPrepare: false, isRetry: false });
      expect(getThumbnailAdminAction(true, null, 404)).toEqual({ canPrepare: false, isRetry: false });
      expect(getThumbnailAdminAction(true, null, 504)).toEqual({ canPrepare: false, isRetry: false });

      // failed
      const failedInfo = {
        kind: "clip" as const,
        id: clipTarget.id,
        cameraId: "cam-1",
        status: "failed" as const,
        contentPath: null,
        width: null,
        height: null,
        sizeBytes: null,
        reasonCode: "TIMEOUT",
        representativeAt: null,
        timeBasis: null,
        generatedAt: null,
      };
      expect(getThumbnailAdminAction(true, failedInfo)).toEqual({ canPrepare: true, isRetry: true });

      // unavailable NOT_PREPARED
      const notPreparedInfo = { ...failedInfo, status: "unavailable" as const, reasonCode: "NOT_PREPARED" };
      expect(getThumbnailAdminAction(true, notPreparedInfo)).toEqual({ canPrepare: true, isRetry: false });

      // unsupported, ready, pending, 기타 unavailable
      expect(getThumbnailAdminAction(true, { ...failedInfo, status: "unsupported" as const, reasonCode: null }).canPrepare).toBe(false);
      expect(getThumbnailAdminAction(true, { ...failedInfo, status: "ready" as const, reasonCode: null }).canPrepare).toBe(false);
      expect(getThumbnailAdminAction(true, { ...failedInfo, status: "pending" as const, reasonCode: null }).canPrepare).toBe(false);
      expect(getThumbnailAdminAction(true, { ...failedInfo, status: "unavailable" as const, reasonCode: "DAILY_MP4_REQUIRED" }).canPrepare).toBe(false);

      // dailyDate 대상은 준비 버튼을 주지 않는다
      expect(getThumbnailAdminAction(true, failedInfo, null, "dailyDate").canPrepare).toBe(false);
      expect(getThumbnailAdminAction(true, { ...failedInfo, kind: "dailyDate" }).canPrepare).toBe(false);
    });
  });
});
