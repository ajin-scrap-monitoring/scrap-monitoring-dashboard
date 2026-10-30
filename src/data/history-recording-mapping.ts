import type { components as BackendComponents } from "../generated/backend-contract";
import type { DashboardData, EventCategory, EventTone, HistoryEvent, Recording } from "../domain/dashboard";
import { missingValue, rfc3339AtOffset, timeOnly, wallClock } from "./contract-values";
import { byteSize, clockDuration, eventRecordingIdentifier } from "./recording-values";

type ApiEvent = BackendComponents["schemas"]["EventPage"]["items"][number];
type ApiLoadHistory = BackendComponents["schemas"]["LoadHistory"];
type ApiRecording = BackendComponents["schemas"]["Recording"];

function toDateTimeInput(value: string) {
  return wallClock(value).replace(" ", "T").slice(0, 16);
}

function sameOriginResourcePath(value: string | null | undefined) {
  if (value == null) return undefined;
  const resource = new URL(value, window.location.origin);
  if (!value.startsWith("/") || resource.origin !== window.location.origin) {
    throw new Error("Recording resource path must use the dashboard origin");
  }
  return `${resource.pathname}${resource.search}${resource.hash}`;
}

function eventCategoryLabel(category: EventCategory) {
  return category === "collection" ? "수거" as const : category === "alert" ? "알림" as const : "오류" as const;
}

function eventTone(category: EventCategory, status?: ApiEvent["status"]): EventTone {
  if (category === "error") return "error";
  if (category === "collection" || status === "completed") return "complete";
  return "warning";
}

function historyMarkerPresentation(type: ApiLoadHistory["eventMarkers"][number]["type"]) {
  if (type === "collection_required") return { color: "#f58a07", label: "수거 필요" as const };
  if (type === "collection_completed") return { color: "#0aa45b", label: "수거 완료" as const };
  return { color: "#e83232", label: "오류" as const };
}

function eventStatus(status: ApiEvent["status"]) {
  if (status === "completed") return "완료";
  if (status === "resolved") return "해제";
  return "발생";
}

const errorStateLabels: Record<string, string> = {
  UNAVAILABLE: "사용 불가", RECOVERED: "복구", PREPARING: "준비 중", DEGRADED: "성능 저하", UNKNOWN: "확인 불가",
};

function backendEventStatus(event: ApiEvent) {
  if (event.category === "collection") {
    if (event.type !== "collection_completed" || event.status !== "completed") return null;
    return event.confirmedCompletion === false ? "종료 감지" : "완료";
  }
  if (event.category === "alert") {
    if (event.status === "active" && event.statusBasis === "CURRENT_EVALUATION") return "활성";
    if (event.status === "resolved" && event.statusBasis === "PERSISTED_RESOLUTION") return "해제";
    if (event.status === "unknown") return "확인 불가";
    return null;
  }
  return event.statusBasis === "AT_OCCURRENCE" && event.stateAtOccurrence ? errorStateLabels[event.stateAtOccurrence] ?? null : null;
}

function backendEventFields(event: ApiEvent): [string, string][] {
  const fields: [string, string][] = [];
  if (event.category === "collection" && event.collectionSource === "HEIGHT_SETTLED") {
    fields.push(["수거 확인", "자동 종료 감지이며 작업자 완료 확인이 아닙니다."]);
  }
  if (event.collectionCriteria?.matchesCurrentScope === false) fields.push(["감지 기준", "현재와 다른 이전 감지 기준"]);
  if (event.category === "alert" && event.status === "resolved" && event.statusBasis === "PERSISTED_RESOLUTION") {
    if (event.resolvedAt) fields.push(["해제 시각", wallClock(event.resolvedAt)]);
    if (event.resolutionObservedAt) fields.push(["해제 근거 측정 시각", wallClock(event.resolutionObservedAt)]);
  }
  if (event.category === "alert" && event.status === "unknown") fields.push(["상태 근거", "해제 여부를 확인할 근거가 보관되지 않았습니다."]);
  if (event.category === "error" && event.statusBasis === "AT_OCCURRENCE" && event.stateAtOccurrence) {
    fields.push(["상태 기준", "기록 당시 상태이며 현재 장치 상태가 아닙니다."]);
  }
  if (event.simulated === true) fields.push(["출처", "시뮬레이션"]);
  if (event.pitAttribution === "CURRENT_ASSIGNMENT") fields.push(["피트 연결", "과거 연결이 보관되지 않아 현재 연결 기준"]);
  if (event.reasonCodes && event.reasonCodes.length > 0) fields.push(["사유 코드", event.reasonCodes.join(", ")]);
  return fields;
}

// 이벤트 녹화 상세는 이벤트 id가 아니라 Backend가 제공한 recordingEventId로만 연결한다. null이면 연결하지 않는다.
function backendEventRecordingId(event: ApiEvent) {
  const id = event.recordingEventId;
  return typeof id === "string" && eventRecordingIdentifier.test(id) ? id : null;
}

export function mapEvent(event: ApiEvent, backendRecords = false): HistoryEvent {
  return {
    content: event.detail || event.title,
    title: event.title,
    detail: event.detail,
    id: event.id,
    recordingId: backendRecords ? backendEventRecordingId(event) : event.recordingId ?? null,
    status: backendRecords ? backendEventStatus(event) : eventStatus(event.status),
    time: wallClock(event.occurredAt),
    tone: backendRecords && event.category !== "collection" ? event.severity === "error" ? "error" : "warning" : eventTone(event.category, event.status),
    type: eventCategoryLabel(event.category),
    ...(backendRecords && { extraFields: backendEventFields(event) }),
  };
}

export function mapRecording(recording: ApiRecording, offset?: string): Recording {
  const atOffset = (value: string | null) => value === null || offset === undefined ? value : rfc3339AtOffset(Date.parse(value), offset, true);
  const startedAt = atOffset(recording.startedAt);
  const endedAt = atOffset(recording.endedAt);
  const date = wallClock(startedAt, true).split(" ")[0];
  const status = recording.status ?? "unavailable";
  const available = status === "available" && (recording.mediaStatus == null || recording.mediaStatus === "ready");
  return {
    source: "event",
    codec: recording.videoCodec?.toUpperCase() || missingValue,
    contentUrl: available ? sameOriginResourcePath(recording.contentPath) : undefined,
    date,
    detail: recording.detail || recording.title,
    downloadUrl: available ? sameOriginResourcePath(recording.downloadPath) : undefined,
    duration: clockDuration(recording.durationSeconds),
    end: wallClock(endedAt, true),
    format: recording.containerFormat?.toUpperCase() || missingValue,
    frameRate: recording.frameRate ?? null,
    height: recording.heightPixels ?? null,
    id: recording.id,
    retentionEndsAt: wallClock(atOffset(recording.retainedUntil), true),
    retentionStartsAt: wallClock(atOffset(recording.retainedFrom), true),
    sample: false,
    size: byteSize(recording.sizeBytes),
    start: wallClock(startedAt, true),
    status: status === "available" && !available ? "unavailable" : status,
    thumbnailUrl: sameOriginResourcePath(recording.thumbnailPath),
    time: `${timeOnly(startedAt)} - ${timeOnly(endedAt)}`,
    tone: eventTone(recording.eventCategory),
    type: eventCategoryLabel(recording.eventCategory),
    width: recording.widthPixels ?? null,
    mediaStatus: recording.mediaStatus,
    coverage: recording.coverage,
    gaps: recording.gaps?.map((gap) => ({ start: wallClock(atOffset(gap.start_at), true), end: wallClock(atOffset(gap.end_at), true) })),
    errorCode: recording.errorCode,
  };
}

export function historyData(load: ApiLoadHistory, events: readonly ApiEvent[], backendRecords = false): DashboardData["history"] {
  const origin = new Date(load.from).getTime();
  const hour = (value: string) => (new Date(value).getTime() - origin) / 3_600_000;
  return {
    chartEvents: load.eventMarkers.map((event) => ({
      ...historyMarkerPresentation(event.type),
      detail: event.detail,
      hour: hour(event.occurredAt),
      id: event.id,
      time: wallClock(event.occurredAt),
      value: event.valuePercent,
    })),
    endsAt: toDateTimeInput(load.to),
    events: events.map(event => mapEvent(event, backendRecords)),
    loadSamples: load.samples.map((sample) => ({ hour: hour(sample.measuredAt),
      value: sample.valid && typeof sample.valuePercent === "number" && Number.isFinite(sample.valuePercent) ? sample.valuePercent : null })),
    startsAt: toDateTimeInput(load.from),
    thresholds: load.collectionThresholds.map((sample) => ({ hour: hour(sample.effectiveAt), value: sample.valuePercent })),
  };
}
