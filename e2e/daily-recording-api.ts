import type { Page, Request } from "@playwright/test";

import type { components } from "../src/generated/backend-contract.js";
import { sessionFixture } from "../src/test/api-contract-fixtures.js";
import { dailyRecordingFixture } from "../src/test/daily-recording-fixtures.js";

import { syntheticMp4 } from "./contract-api.js";

export type DailyRecordingResponse = components["schemas"]["DailyRecording"];
export const syntheticDailyRecording: DailyRecordingResponse = {
  ...dailyRecordingFixture,
  recorded_seconds: 2,
  coverage_as_of_at: "2026-10-12T15:00:00Z",
  playable_until_at: "2026-10-11T15:00:12Z",
  gaps: [{ start_at: "2026-10-11T15:00:01Z", end_at: "2026-10-11T15:00:11Z", reason_code: "CAMERA_DISCONNECTED" }],
  available_intervals: [
    { start_at: "2026-10-11T15:00:00Z", end_at: "2026-10-11T15:00:01Z", playback_start_seconds: 0, playback_end_seconds: 1 },
    { start_at: "2026-10-11T15:00:11Z", end_at: "2026-10-11T15:00:12Z", playback_start_seconds: 1, playback_end_seconds: 2 },
  ],
};

// FFmpeg encodes a public synthetic blue frame sequence as one second of H.264 MPEG-TS.
const syntheticTs = Buffer.from("R0AREABC8CUAAcEAAP8B/wAB/IAUSBIBBkZGbXBlZwlTZXJ2aWNlMDF3fEPK//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////9HQAAQAACwDQABwQAAAAHwACqxBLL//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////0dQABAAArASAAHBAADhAPAAG+EA8AAVvU1W////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////R0EAMAdQAAB7DH4AAAAB4AAAgIAFIQAH2GEAAAABCfAAAAABZ0LAC9oFB+wEQAAAAwBAAAADAoPFCqgAAAABaM4PyAAAAQYF//8/3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjUgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWxHAQARIC0gb3B0aW9uczogY2FiYWM9MCByZWY9MSBkZWJsb2NrPTA6MDowIGFuYWx5c2U9MDowIG1lPWRpYSBzdWJtZT0wIHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTAgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0wIDh4OGRjdD0wIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbUcBABJhX3FwX29mZnNldD0wIHRocmVhZHM9NyBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTAgd2VpZ2h0cD0wIGtleWludD01IGtleWludF9taW49MSBzY2VuZWN1dD0wIGludHJhRwEAE19yZWZyZXNoPTAgcmM9Y3JmIG1idHJlZT0wIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTAAgAAAAWWIhDoRigACMXHAAEPKOAAIBcnJycnJycnJycnJycnJycnJycnXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXVHAQA0FwD/////////////////////////////111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111114EdAABEAALANAAHBAAAAAfAAKrEEsv//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////R1AAEQACsBIAAcEAAOEA8AAb4QDwABW9TVb///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////9HQQA1mBAAAJ40fgD/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AAAB4AAAgIAFIQAJZQEAAAABCfAAAAABQZogEKAJbEdAABIAALANAAHBAAAAAfAAKrEEsv//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////R1AAEgACsBIAAcEAAOEA8AAb4QDwABW9TVb///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////9HQQA2mBAAAMFcfgD/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AAAB4AAAgIAFIQAJ8aEAAAABCfAAAAABQZpAEKAJbEdAEREAQvAlAAHBAAD/Af8AAfyAFEgSAQZGRm1wZWcJU2VydmljZTAxd3xDyv//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////R0AAEwAAsA0AAcEAAAAB8AAqsQSy//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////9HUAATAAKwEgABwQAA4QDwABvhAPAAFb1NVv///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////0dBADeYEAAA5IR+AP////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AAAHgAACAgAUhAAt+QQAAAAEJ8AAAAAFBmmARoAlsR0AAFAAAsA0AAcEAAAAB8AAqsQSy//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////9HUAAUAAKwEgABwQAA4QDwABvhAPAAFb1NVv///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////0dBADiYEAABB6x+AP////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AAAHgAACAgAUhAA0K4QAAAAEJ8AAAAAFBmoARoAls", "base64");

function toMetadata(recording: DailyRecordingResponse, revision: number): components["schemas"]["DailyRecordingMetadata"] {
  const { gaps: _gaps, available_intervals: _available, ...rest } = recording;
  void _gaps;
  void _available;
  return { ...rest, revision };
}

export async function installDailyRecordingApi(page: Page, authenticated: () => boolean, onRequest: (url: URL) => void) {
  let recordings: readonly DailyRecordingResponse[] = [syntheticDailyRecording];
  let snapshotRevision = 1;
  let failedList = false;
  let deleteConflict = false;
  let exportPolls = 0;
  const requests: Request[] = [];
  const mediaRequests: Request[] = [];
  await page.route("**/api/v2/recordings/daily**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push(request);
    onRequest(url);
    if (!authenticated()) { await route.fulfill({ status: 401, json: { detail: "Unauthorized" } }); return; }
    if (url.pathname.endsWith("/media-info")) {
      await route.fallback();
      return;
    }
    if (url.pathname === "/api/v2/recordings/daily/summary") {
      if (failedList) { await route.fulfill({ status: 503, json: { detail: "Synthetic list failure" } }); return; }
      const from = url.searchParams.get("from_date") ?? "";
      const to = url.searchParams.get("to_date") ?? "";
      const items = recordings
        .filter(item => item.recording_date >= from && item.recording_date < to)
        .map(item => toMetadata(item, snapshotRevision));
      await route.fulfill({ json: { items, next_cursor: null } });
      return;
    }
    const parts = url.pathname.split("/");
    const id = parts[5];
    const sub = parts[6];
    const recording = recordings.find(item => item.recording_id === id);
    if (!recording) { await route.fulfill({ status: 404, json: { detail: "Not found" } }); return; }
    if (request.method() === "DELETE" && !sub) {
      if (request.headers()["x-csrf-token"] !== sessionFixture.csrfToken) { await route.fulfill({ status: 403, json: { detail: "Invalid or missing CSRF token" } }); return; }
      if (deleteConflict || recording.status !== "closed" || recording.export_state === "processing") { await route.fulfill({ status: 409, json: { detail: "Daily recording is not deletable" } }); return; }
      recordings = recordings.filter(item => item.recording_id !== id);
      snapshotRevision += 1;
      await route.fulfill({ status: 204 });
      return;
    }
    if (sub === "exports") {
      if (request.method() !== "POST") { await route.fulfill({ status: 405 }); return; }
      if (request.headers()["x-csrf-token"] !== sessionFixture.csrfToken) { await route.fulfill({ status: 403, json: { detail: "Invalid or missing CSRF token" } }); return; }
      if (!recording.export_allowed || recording.status !== "closed") { await route.fulfill({ status: 409, json: { detail: "Daily recording is not closed" } }); return; }
      const next = { ...recording, export_state: "processing" as const };
      recordings = recordings.map(item => item.recording_id === id ? next : item);
      exportPolls = 0;
      await route.fulfill({ status: 202, json: next, headers: { Location: `/api/v2/recordings/daily/${id}` } });
      return;
    }
    if (sub === "summary") {
      let current = recording;
      if (recording.export_state === "processing" && ++exportPolls >= 2) {
        current = { ...recording, export_state: "ready", download_path: `/media/daily-recordings/${id}/content?download=true`, size_bytes: syntheticMp4.length, export_expires_at: "2026-11-12T15:00:00Z" };
        recordings = recordings.map(item => item.recording_id === id ? current : item);
      }
      await route.fulfill({ json: toMetadata(current, snapshotRevision) });
      return;
    }
    if (sub === "gaps" || sub === "available-intervals") {
      const source = sub === "gaps" ? recording.gaps : recording.available_intervals;
      const limitParam = Number(url.searchParams.get("limit") ?? "100");
      const limit = Number.isSafeInteger(limitParam) && limitParam > 0 ? limitParam : 100;
      const cursor = url.searchParams.get("cursor");
      let offset = 0;
      if (cursor !== null) {
        const match = new RegExp(`^${sub}-offset-(\\d+)$`).exec(cursor);
        if (!match) {
          await route.fulfill({ status: 400, json: { error: { code: "INVALID_CURSOR", message: "Invalid cursor" } } });
          return;
        }
        offset = Number(match[1]);
      }
      const items = source.slice(offset, offset + limit);
      const nextOffset = offset + items.length;
      const next_cursor = nextOffset < source.length ? `${sub}-offset-${nextOffset}` : null;
      await route.fulfill({
        json: {
          recording_id: id,
          revision: snapshotRevision,
          snapshot: `snap-${snapshotRevision}`,
          items,
          total: source.length,
          next_cursor,
        },
      });
      return;
    }
    await route.fulfill({ status: 404, json: { error: { code: "DEPRECATED_ENDPOINT", message: "Legacy daily endpoint disabled" } } });
  });
  await page.context().route("**/media/daily-recordings/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    mediaRequests.push(request);
    if (!authenticated()) { await route.fulfill({ status: 401 }); return; }
    const id = url.pathname.split("/")[3];
    const recording = recordings.find(item => item.recording_id === id);
    if (!recording) { await route.fulfill({ status: 404 }); return; }
    if (url.pathname.endsWith("/hls/index.m3u8")) {
      const prefix = `/media/daily-recordings/${id}/media`;
      await route.fulfill({ contentType: "application/vnd.apple.mpegurl", body: `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:1
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-INDEPENDENT-SEGMENTS
#EXTINF:1.000,
${prefix}/segment-1.ts
#EXT-X-DISCONTINUITY
#EXTINF:1.000,
${prefix}/segment-2.ts
#EXT-X-ENDLIST
` });
    } else if (url.pathname.endsWith(".ts")) {
      await route.fulfill({ contentType: "video/mp2t", body: syntheticTs });
    } else if (url.pathname.endsWith("/content") && url.searchParams.get("download") === "true") {
      if (recording.export_state !== "ready" || !recording.download_path) { await route.fulfill({ status: 409 }); return; }
      await route.fulfill({ contentType: "video/mp4", body: syntheticMp4, headers: { "Content-Disposition": "attachment; filename=synthetic-daily.mp4" } });
    } else await route.fulfill({ status: 404 });
  });
  return {
    requests,
    mediaRequests,
    setRecordings: (next: readonly DailyRecordingResponse[]) => {
      recordings = next;
      snapshotRevision += 1;
    },
    bumpRevision: () => { snapshotRevision += 1; return snapshotRevision; },
    failList: (failed: boolean) => { failedList = failed; },
    conflictOnDelete: (conflict: boolean) => { deleteConflict = conflict; },
  };
}
