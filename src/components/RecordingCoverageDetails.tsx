import { useEffect, useState } from "react";

import { wallClock } from "../data/contract-values";
import type { DashboardDataSource } from "../data/dashboard-data-source";
import type { Recording, RecordingCoverageDetail } from "../domain/dashboard";
import { replayClock } from "../data/event-recordings";
import { DetailFields } from "./DetailFields";
import { recordingErrorCode } from "../recording-status";

const intervalKindLabels: Record<string, string> = {
  GAP: "확인된 누락",
  UNCONFIRMED: "확보 여부 미확인",
  FUTURE: "아직 오지 않은 구간",
  MISSING: "영상 없음",
  EXPIRED: "보관 만료",
};

export default function RecordingCoverageDetails({
  dataSource,
  recordingId,
  recording,
}: {
  dataSource?: DashboardDataSource;
  recordingId?: string;
  recording?: Recording;
}) {
  const isEvent = Boolean(recording?.replay && recording.replay.unavailableIntervals.length > 0);
  const isDaily = Boolean(recording?.daily && recording.daily.gaps.length > 0);

  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; source?: DashboardDataSource; recordingId?: string; detail?: RecordingCoverageDetail; error?: string }>();

  useEffect(() => {
    if (isEvent || isDaily || !recordingId || !dataSource) return;
    const controller = new AbortController();
    void dataSource.getRecordingCoverage?.(recordingId, controller.signal).then(detail => {
      if (!controller.signal.aborted) setResult({ attempt, source: dataSource, recordingId, detail });
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ attempt, source: dataSource, recordingId, error: "녹화 범위를 조회하지 못했습니다." });
    });
    return () => controller.abort();
  }, [attempt, dataSource, recordingId, isEvent, isDaily]);

  if (isEvent && recording?.replay) {
    const replay = recording.replay;
    const windowFrom = recording.eventWindow?.windowFrom ?? recording.windowFrom ?? recording.start;
    const windowTo = recording.eventWindow?.windowTo ?? recording.windowTo;
    const startText = wallClock(windowFrom, true);
    const endText = windowTo ? wallClock(windowTo, true) : "정보 없음";
    return <>
      <DetailFields fields={[
        ["요청 구간", `${startText} ~ ${endText}`],
        ["요청 길이", typeof replay.requestedSeconds === "number" ? replayClock(replay.requestedSeconds) : "정보 없음"],
        ["확보 길이", replayClock(replay.coveredSeconds)],
        ["재생 길이", replayClock(replay.playbackSeconds)],
      ]} />
      <h3>누락 구간</h3>
      <ul>
        {replay.unavailableIntervals.map((interval, index) => {
          const kindLabel = intervalKindLabels[interval.kind] ?? interval.kind;
          const start = wallClock(interval.startsAt, true);
          const end = wallClock(interval.endsAt, true);
          const reason = interval.reasonCode || "정보 없음";
          return <li key={`${index}-${interval.startsAt}`}>{start} ~ {end}, {kindLabel}, {reason}</li>;
        })}
      </ul>
    </>;
  }

  if (isDaily && recording?.daily) {
    const daily = recording.daily;
    return <>
      <DetailFields fields={[
        ["녹화 날짜", daily.recordingDate],
      ]} />
      <h3>누락 구간</h3>
      <ul>
        {daily.gaps.map((gap, index) => {
          const start = wallClock(gap.startsAt, true);
          const end = wallClock(gap.endsAt, true);
          const reason = gap.reasonCode || "정보 없음";
          return <li key={`${index}-${gap.startsAt}`}>{start} ~ {end}, {reason}</li>;
        })}
      </ul>
    </>;
  }

  const current = result?.attempt === attempt && result.source === dataSource && result.recordingId === recordingId ? result : undefined;
  if (!dataSource?.getRecordingCoverage) return <p>녹화 범위 상세 조회 미지원</p>;
  if (current?.error) return <><p role="alert">녹화 범위 조회 실패: {current.error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>다시 조회</button></>;
  if (!current?.detail) return <p role="status">녹화 범위 확인 중</p>;
  const detail = current.detail;
  return <>
    <DetailFields fields={[
      ["요청 시작", detail.requestedStart],
      ["요청 종료", detail.requestedEnd],
      ["확보 시작", detail.actualStart ?? "정보 없음"],
      ["확보 종료", detail.actualEnd ?? "정보 없음"],
      ["녹화 범위", detail.coverage === "complete" ? "전체 구간" : detail.coverage === "partial" ? "부분 저장" : detail.coverage === "none" ? "영상 없음" : "정보 없음"],
    ]} />
    <h3>누락 구간</h3>
    {detail.gaps.length ? <ul>{detail.gaps.map((gap, index) => <li key={`${index}-${gap.start}`}>{gap.start} ~ {gap.end}</li>)}</ul> : <p>서버 응답에 누락 구간 없음</p>}
    <p>구간별 누락 원인은 API에서 제공하지 않습니다.</p>
    {detail.errorCode && <p>녹화 처리 오류 코드 {recordingErrorCode(detail.errorCode) ?? "확인 불가"}</p>}
  </>;
}
