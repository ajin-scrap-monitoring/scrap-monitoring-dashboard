import type { EventPlaybackSummary, EventRecordingWindow, EventReplay, EventReplayPart, Recording } from "../domain/dashboard";
import { dailyRecordingIdentifier } from "./daily-recordings";
import { nullableTimestamp, record, strings, timestamp } from "./contract-values";
import { eventRecordingIdentifier } from "./recording-values";

export { eventRecordingIdentifier };

const categories = ["collection", "alert", "error"] as const;
const windowKinds = ["COLLECTION_CYCLE", "EVENT_CONTEXT"] as const;
const windowStates = ["CLOSED", "OPEN", "UNKNOWN", "POINT"] as const;
const replayStates = ["AVAILABLE", "PARTIAL", "PROCESSING", "UNAVAILABLE"] as const;
const playbackStates = [...replayStates, "UNKNOWN"] as const;
const intervalKinds = ["GAP", "UNCONFIRMED", "FUTURE", "MISSING", "EXPIRED"] as const;
const missingValue = "정보 없음";
const listStatus = { AVAILABLE: "available", PARTIAL: "available", PROCESSING: "processing", UNAVAILABLE: "unavailable", UNKNOWN: "processing" } as const;
const labels = { collection: "수거", alert: "알림", error: "오류" } as const;
const tones = { collection: "complete", alert: "warning", error: "error" } as const;

export type EventRecordingItem = {
  eventId: string;
  category: (typeof categories)[number];
  title: string;
  occurredAt: string;
  windowFrom: string;
  windowTo: string | null;
  window: EventRecordingWindow;
  playback: EventPlaybackSummary | null;
};

export type EventRecordingPage = {
  items: EventRecordingItem[];
  page: number;
  totalPages: number;
  totalItems: number;
  from: string;
  to: string;
  asOf: string;
};

function fail(): never { throw new Error("Unexpected event recording contract."); }

function choice<const T extends readonly string[]>(value: unknown, options: T): T[number] {
  return typeof value === "string" && (options as readonly string[]).includes(value) ? value : fail();
}

function playbackSummary(value: unknown): EventPlaybackSummary | null {
  if (value === undefined || value === null) return null;
  if (!record(value) || !(value.reasonCodes === undefined || strings(value.reasonCodes))
    || !(value.playbackSeconds === undefined || value.playbackSeconds === null || (typeof value.playbackSeconds === "number" && Number.isFinite(value.playbackSeconds) && value.playbackSeconds >= 0))) return fail();
  return { state: choice(value.state, playbackStates), playbackSeconds: value.playbackSeconds ?? null, reasonCodes: value.reasonCodes ?? [] };
}

function nonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fail();
}

function stamp(value: unknown): string { return timestamp(value) ? value : fail(); }
function optionalStamp(value: unknown): string | null { return value === undefined || value === null ? null : stamp(value); }

export function eventRecordingItem(value: unknown): EventRecordingItem {
  if (!record(value) || typeof value.eventId !== "string" || !eventRecordingIdentifier.test(value.eventId)
    || typeof value.title !== "string" || typeof value.eventType !== "string"
    || !(value.windowTo === undefined || nullableTimestamp(value.windowTo, true))
    || !(value.simulated === undefined || value.simulated === null || typeof value.simulated === "boolean")
    || !(value.stateAtOccurrence === undefined || value.stateAtOccurrence === null || typeof value.stateAtOccurrence === "string")
    || !(value.reasonCodes === undefined || strings(value.reasonCodes))) return fail();
  const category = choice(value.category, categories);
  return {
    eventId: value.eventId,
    category,
    title: value.title,
    occurredAt: stamp(value.occurredAt),
    windowFrom: stamp(value.windowFrom),
    windowTo: optionalStamp(value.windowTo),
    window: {
      windowKind: choice(value.windowKind, windowKinds),
      windowState: choice(value.windowState, windowStates),
      eventType: value.eventType,
      stateAtOccurrence: (value.stateAtOccurrence) ?? null,
      simulated: (value.simulated) ?? null,
      pitAttribution: value.pitAttribution === undefined ? "RECORDED" : choice(value.pitAttribution, ["RECORDED", "CURRENT_ASSIGNMENT"] as const),
      reasonCodes: (value.reasonCodes) ?? [],
      windowFrom: stamp(value.windowFrom),
      windowTo: optionalStamp(value.windowTo),
    },
    playback: playbackSummary(value.playback),
  };
}

export function eventRecordingPage(value: unknown): EventRecordingPage {
  if (!record(value) || !Array.isArray(value.items) || !record(value.page)) return fail();
  const page = value.page;
  if (!Number.isInteger(page.page) || (page.page as number) < 1 || !Number.isInteger(page.totalPages) || (page.totalPages as number) < 0) return fail();
  if (!Number.isInteger(page.totalItems) || (page.totalItems as number) < 0) return fail();
  const items = value.items.map(eventRecordingItem);
  if (new Set(items.map((item) => item.eventId)).size !== items.length) return fail();
  return { items, page: page.page as number, totalPages: page.totalPages as number, totalItems: page.totalItems as number, from: stamp(value.from), to: stamp(value.to), asOf: stamp(value.asOf) };
}

function replayPart(value: unknown): EventReplayPart {
  if (!record(value) || typeof value.recordingId !== "string" || !dailyRecordingIdentifier.test(value.recordingId)
    || typeof value.recordingDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.recordingDate)
    || value.playbackPath !== `/media/daily-recordings/${value.recordingId}/hls/index.m3u8`) return fail();
  const part: EventReplayPart = {
    recordingId: value.recordingId,
    recordingDate: value.recordingDate,
    playbackPath: value.playbackPath,
    fromAt: stamp(value.fromAt),
    toAt: stamp(value.toAt),
    startSeconds: nonNegative(value.startSeconds),
    endSeconds: nonNegative(value.endSeconds),
    relativeStartSeconds: nonNegative(value.relativeStartSeconds),
    relativeEndSeconds: nonNegative(value.relativeEndSeconds),
    mapping: choice(value.mapping, ["LINEAR", "POINT_TIMESTAMP"] as const),
  };
  if (part.endSeconds < part.startSeconds || part.relativeEndSeconds < part.relativeStartSeconds) return fail();
  return part;
}

export function eventReplay(value: unknown, eventId: string): { item: EventRecordingItem; replay: EventReplay } {
  if (!record(value) || value.source !== "DAILY_RECORDING" || (value.downloadPath !== undefined && value.downloadPath !== null) || !Array.isArray(value.parts) || !Array.isArray(value.unavailableIntervals)
    || !(value.reasonCodes === undefined || strings(value.reasonCodes))
    || !(value.requestedSeconds === undefined || value.requestedSeconds === null || nonNegative(value.requestedSeconds) >= 0)) return fail();
  const item = eventRecordingItem(value.event);
  if (item.eventId !== eventId) return fail();
  const parts = value.parts.map(replayPart);
  const playbackSeconds = nonNegative(value.playbackSeconds);
  let cursor = 0;
  for (const part of parts) {
    if (part.relativeStartSeconds < cursor - 0.001) return fail();
    cursor = part.relativeEndSeconds;
  }
  if (parts.length > 0 && (parts[0].relativeStartSeconds !== 0 || Math.abs(cursor - playbackSeconds) > 0.001)) return fail();
  if (parts.length === 0 && playbackSeconds !== 0) return fail();
  return {
    item,
    replay: {
      state: choice(value.state, replayStates),
      asOf: stamp(value.asOf),
      effectiveTo: optionalStamp(value.effectiveTo),
      requestedSeconds: typeof value.requestedSeconds === "number" ? value.requestedSeconds : null,
      coveredSeconds: nonNegative(value.coveredSeconds),
      playbackSeconds,
      parts,
      unavailableIntervals: value.unavailableIntervals.map((interval: unknown) => {
        if (!record(interval) || typeof interval.reasonCode !== "string") return fail();
        return { startsAt: stamp(interval.fromAt), endsAt: stamp(interval.toAt), kind: choice(interval.kind, intervalKinds), reasonCode: interval.reasonCode };
      }),
      reasonCodes: (value.reasonCodes) ?? [],
      downloadReasonCode: typeof value.downloadReasonCode === "string" ? value.downloadReasonCode : null,
    },
  };
}

function wallClock(value: string, offset: string) {
  const match = offset.match(/^([+-])(\d{2}):(\d{2})$/);
  const minutes = match ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
  return new Date(Date.parse(value) + minutes * 60_000).toISOString().slice(0, 19).replace("T", " ");
}

export function replayClock(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const rest = `${String(Math.floor((whole % 3600) / 60)).padStart(hours > 0 ? 2 : 1, "0")}:${String(whole % 60).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${rest}` : rest;
}

export function mapEventRecording(item: EventRecordingItem, replay?: EventReplay, retentionEndsAt?: string | null, asOf?: string, offset = "+09:00"): Recording {
  const endsAt = replay?.effectiveTo ?? item.windowTo ?? (item.window.windowState === "OPEN" ? asOf : undefined) ?? item.windowFrom;
  const startText = wallClock(item.windowFrom, offset);
  const summary = replay ? null : item.playback;
  const playable = Boolean(replay && (replay.state === "AVAILABLE" || replay.state === "PARTIAL") && replay.parts.length > 0);
  return {
    source: "event",
    eventWindow: item.window,
    windowFrom: item.windowFrom,
    windowTo: item.windowTo,
    ...(replay && { replay }),
    ...(summary && { playbackSummary: summary }),
    id: item.eventId,
    date: startText.slice(0, 10),
    time: `${startText.slice(11, 16)} - ${wallClock(endsAt, offset).slice(11, 16)}`,
    type: labels[item.category],
    tone: tones[item.category],
    detail: item.title,
    sample: false,
    start: startText,
    end: wallClock(endsAt, offset),
    duration: replay ? replayClock(replay.playbackSeconds) : summary?.playbackSeconds != null ? replayClock(summary.playbackSeconds) : missingValue,
    codec: missingValue,
    format: replay ? "HLS" : missingValue,
    frameRate: null,
    height: null,
    width: null,
    size: missingValue,
    retentionStartsAt: missingValue,
    retentionEndsAt: retentionEndsAt ? wallClock(retentionEndsAt, offset) : missingValue,
    status: playable ? "available" : replay?.state === "UNAVAILABLE" || (!summary && item.window.windowState === "UNKNOWN") ? "unavailable" : summary ? listStatus[summary.state] : "processing",
    mediaStatus: null,
    coverage: replay ? replay.state === "AVAILABLE" ? "complete" : replay.state === "PARTIAL" ? "partial" : null
      : summary?.state === "AVAILABLE" ? "complete" : summary?.state === "PARTIAL" ? "partial" : null,
  };
}
