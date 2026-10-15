import { useEffect, useState } from "react";

import type { DashboardDataSource } from "../data/dashboard-data-source";
import type { RecordingCoverageDetail } from "../domain/dashboard";
import { DetailFields } from "./DetailFields";

export default function RecordingCoverageDetails({ dataSource, recordingId }: { dataSource: DashboardDataSource; recordingId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; source: DashboardDataSource; recordingId: string; detail?: RecordingCoverageDetail; error?: string }>();
  useEffect(() => {
    const controller = new AbortController();
    void dataSource.getRecordingCoverage?.(recordingId, controller.signal).then(detail => {
      if (!controller.signal.aborted) setResult({ attempt, source: dataSource, recordingId, detail });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setResult({ attempt, source: dataSource, recordingId, error: error instanceof Error ? error.message : "녹화 범위를 조회하지 못했습니다." });
    });
    return () => controller.abort();
  }, [attempt, dataSource, recordingId]);
  const current = result?.attempt === attempt && result.source === dataSource && result.recordingId === recordingId ? result : undefined;
  if (!dataSource.getRecordingCoverage) return <p>녹화 범위 상세 조회 미지원</p>;
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
    {detail.errorCode && <p>녹화 처리 오류 코드 {detail.errorCode}</p>}
  </>;
}
