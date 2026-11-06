import type { components as BackendComponents } from "../generated/backend-contract";
import { timestamp, wallClock } from "./contract-values";

export type ClipThumbnailInfo = BackendComponents["schemas"]["ClipThumbnailInfo"];
export type DailyThumbnailInfo = BackendComponents["schemas"]["DailyThumbnailInfo"];
export type ThumbnailRequest = BackendComponents["schemas"]["ThumbnailRequest"];

export type ThumbnailStatus = "unsupported" | "unavailable" | "pending" | "failed" | "ready";

export type ThumbnailTarget =
  | { kind: "clip"; id: string }
  | { kind: "daily"; id: string }
  | { kind: "event"; eventId: string; path: string };

export type ThumbnailInfo = {
  kind: "clip" | "daily" | "event";
  id: string;
  clipId?: string | null;
  cameraId: string;
  status: ThumbnailStatus;
  contentPath: string | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  reasonCode: string | null;
  representativeAt: string | null;
  timeBasis: "server_received_at" | null;
  generatedAt: string | null;
};

export const canonicalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isCanonicalUuid(id: string): boolean {
  return canonicalUuidPattern.test(id);
}

export function isValidThumbnailContentPath(kind: "clip" | "daily", id: string, path: string | null): boolean {
  if (typeof path !== "string") return false;
  const expected = kind === "clip"
    ? `/media/clips/${id}/thumbnail`
    : `/media/daily-recordings/${id}/thumbnail`;
  return path === expected;
}

export function parseThumbnailInfo(raw: unknown, target: ThumbnailTarget): ThumbnailInfo | null {
  if (target.kind === "event" && raw === null) {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid thumbnail response body.");
  }
  const r = raw as Record<string, unknown>;

  let clipId: string | null = null;
  if (target.kind === "clip") {
    if (r.clip_id !== target.id) throw new Error("Clip ID mismatch in thumbnail info.");
    clipId = target.id;
  } else if (target.kind === "daily") {
    if (r.recording_id !== target.id) throw new Error("Recording ID mismatch in thumbnail info.");
  } else {
    // target.kind === "event"
    if (typeof r.clip_id !== "string" || !isCanonicalUuid(r.clip_id)) {
      throw new Error("Event thumbnail info requires canonical UUID clip_id.");
    }
    clipId = r.clip_id;
  }

  if (typeof r.camera_id !== "string" || !r.camera_id) {
    throw new Error("Invalid camera ID in thumbnail info.");
  }

  const status = r.status as ThumbnailStatus;
  const validStatuses: ThumbnailStatus[] = ["unsupported", "unavailable", "pending", "failed", "ready"];
  if (!validStatuses.includes(status)) {
    throw new Error(`Invalid thumbnail status: ${String(r.status)}`);
  }

  if (status === "ready") {
    const expectedTargetKind = target.kind === "daily" ? "daily" : "clip";
    const expectedId = target.kind === "daily" ? target.id : (clipId ?? "");
    if (typeof r.content_path !== "string" || !isValidThumbnailContentPath(expectedTargetKind, expectedId, r.content_path)) {
      throw new Error("Ready thumbnail must have a valid content_path matching the expected path pattern.");
    }
    if (typeof r.width !== "number" || r.width <= 0 || !Number.isInteger(r.width)) {
      throw new Error("Ready thumbnail must have positive integer width.");
    }
    if (typeof r.height !== "number" || r.height <= 0 || !Number.isInteger(r.height)) {
      throw new Error("Ready thumbnail must have positive integer height.");
    }
    if (typeof r.size_bytes !== "number" || r.size_bytes <= 0 || !Number.isInteger(r.size_bytes)) {
      throw new Error("Ready thumbnail must have positive integer size_bytes.");
    }
    if (typeof r.generated_at !== "string" || !timestamp(r.generated_at)) {
      throw new Error("Ready thumbnail must have valid generated_at timestamp.");
    }

    if (r.representative_at !== null) {
      if (typeof r.representative_at !== "string" || !timestamp(r.representative_at)) {
        throw new Error("Invalid representative_at timestamp.");
      }
      if (r.time_basis !== "server_received_at") {
        throw new Error("Ready thumbnail with representative_at must have time_basis server_received_at.");
      }
    } else {
      if (r.time_basis !== null) {
        throw new Error("Ready thumbnail without representative_at must have null time_basis.");
      }
    }
  } else {
    if (r.content_path !== null || r.width !== null || r.height !== null || r.size_bytes !== null) {
      throw new Error(`Non-ready thumbnail status ${status} must have null image properties.`);
    }
    if (r.representative_at !== null || r.time_basis !== null || r.generated_at !== null) {
      throw new Error(`Non-ready thumbnail status ${status} must have null timeline/generation properties.`);
    }

    if (status === "unsupported" || status === "pending") {
      if (r.reason_code !== null) {
        throw new Error(`${status} thumbnail must have null reason_code.`);
      }
    } else {
      if (typeof r.reason_code !== "string" || !r.reason_code) {
        throw new Error(`${status} thumbnail must have non-empty reason_code.`);
      }
    }
  }

  return {
    kind: target.kind,
    id: target.kind === "event" ? target.eventId : target.id,
    ...(clipId !== null && { clipId }),
    cameraId: r.camera_id,
    status,
    contentPath: status === "ready" && typeof r.content_path === "string" ? r.content_path : null,
    width: status === "ready" && typeof r.width === "number" ? r.width : null,
    height: status === "ready" && typeof r.height === "number" ? r.height : null,
    sizeBytes: status === "ready" && typeof r.size_bytes === "number" ? r.size_bytes : null,
    reasonCode: typeof r.reason_code === "string" ? r.reason_code : null,
    representativeAt: typeof r.representative_at === "string" ? r.representative_at : null,
    timeBasis: r.time_basis === "server_received_at" ? "server_received_at" : null,
    generatedAt: typeof r.generated_at === "string" ? r.generated_at : null,
  };
}

export function thumbnailErrorNotice(status: number): string {
  switch (status) {
    case 401:
      return "로그인이 필요합니다.";
    case 404:
      return "이미지 없음";
    case 409:
      return "준비 중";
    case 410:
      return "파일 삭제 또는 만료";
    case 422:
      return "잘못된 요청";
    case 502:
      return "미디어 응답 오류";
    case 503:
      return "통신 실패";
    case 504:
      return "시간 초과";
    default:
      return `오류 (${status})`;
  }
}

export function formatThumbnailStatusText(
  info?: ThumbnailInfo | null,
  errorStatus?: number | null,
): { text: string; role?: "alert" } {
  if (errorStatus) {
    return { text: thumbnailErrorNotice(errorStatus), role: "alert" };
  }
  if (info === undefined) {
    return { text: "확인 중" };
  }
  if (info === null) {
    return { text: "연결된 구간 파일 없음" };
  }

  switch (info.status) {
    case "unsupported":
    case "unavailable":
      return {
        text: info.reasonCode ? `제공 안 됨 (${info.reasonCode})` : "제공 안 됨",
      };
    case "pending":
      return { text: "준비 중" };
    case "failed":
      return {
        text: info.reasonCode ? `실패 (${info.reasonCode})` : "실패",
        role: "alert",
      };
    case "ready":
      if (info.representativeAt && info.timeBasis === "server_received_at") {
        return { text: `서버 수신 기준 ${wallClock(info.representativeAt, true)}` };
      }
      return { text: "시각 정보 없음" };
  }
}

export function getThumbnailAdminAction(
  isAdmin: boolean,
  info?: ThumbnailInfo | null,
  errorStatus?: number | null,
): { canPrepare: boolean; isRetry: boolean } {
  if (!isAdmin) return { canPrepare: false, isRetry: false };
  // 준비 가능 여부는 정보 응답으로 확인된 경우에만 판단한다. 조회 중과 오류 상태에는 버튼을 표시하지 않는다.
  if (errorStatus || !info) return { canPrepare: false, isRetry: false };
  if (info.status === "failed") {
    return { canPrepare: true, isRetry: true };
  }
  if (info.status === "unavailable" && info.reasonCode === "NOT_PREPARED") {
    return { canPrepare: true, isRetry: false };
  }
  return { canPrepare: false, isRetry: false };
}
