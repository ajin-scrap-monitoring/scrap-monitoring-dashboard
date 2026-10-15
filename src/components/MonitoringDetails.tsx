import { useEffect, useState } from "react";

import type { DashboardDataSource } from "../data/dashboard-data-source";
import type { MonitoringV2 } from "../domain/dashboard";
import { DetailFields } from "./DetailFields";

const missingValue = "정보 없음";
const capabilityLabels = { fill: "적재율", occlusion: "가림", collection: "수거", vision: "영상 판단" };
const capabilityStates = { NOT_IMPLEMENTED: "미구현", NOT_VALIDATED: "미검증", ENABLED: "활성화" };

function PitName({ dataSource, pitId }: { dataSource: DashboardDataSource; pitId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ source: DashboardDataSource; pitId: string; attempt: number; name?: string; error?: string }>();
  useEffect(() => {
    if (!dataSource.getPitName) return;
    const controller = new AbortController();
    void dataSource.getPitName(controller.signal).then(name => {
      if (!controller.signal.aborted) setResult({ source: dataSource, pitId, attempt, name });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setResult({ source: dataSource, pitId, attempt, error: error instanceof Error ? error.message : "pit 이름을 조회하지 못했습니다." });
    });
    return () => controller.abort();
  }, [attempt, dataSource, pitId]);
  const current = result?.source === dataSource && result.pitId === pitId && result.attempt === attempt ? result : undefined;
  if (!dataSource.getPitName) return <>{missingValue}</>;
  if (current?.error) return <><span role="alert">이름 조회 실패: {current.error}</span> <button type="button" onClick={() => setAttempt(value => value + 1)}>다시 조회</button></>;
  return current?.name ?? <span role="status">이름 확인 중</span>;
}

export default function MonitoringDetails({ dataSource, state }: { dataSource: DashboardDataSource; state: MonitoringV2 }) {
  return <>
    <DetailFields fields={[
      ["pit", state.pitId],
      ["pit 이름", <PitName dataSource={dataSource} pitId={state.pitId} />],
      ["site / edge", `${state.siteId} / ${state.edgeId}`],
      ["데이터 상태", state.dataState],
      ["STATE 판단", state.fillState ?? missingValue],
      ["판단 가용성", state.decisionState ?? missingValue],
      ["관측 시각", state.measuredAt ?? missingValue],
      ["판단 수신 시각", state.assessmentReceivedAt ?? missingValue],
      ["설정 revision", state.configRevision ?? missingValue],
      ["경고 임계율", `${state.warningThreshold}%`],
      ["경보 복귀 임계율", `${state.recoveryThreshold}%`],
      ["연결 상태", state.connectionState],
      ["장비 상태", state.effectiveState],
      ["장비 상태 수신 시각", state.deviceReceivedAt ?? missingValue],
    ]} />
    <h3>경보 평가</h3>
    {state.operations ? <DetailFields fields={[
      ["현재 경보 상태", state.streamState === "reconnecting" ? "UNKNOWN" : state.operations.effectiveState],
      ["마지막 유효 경보 상태", state.operations.lastKnownState ?? missingValue],
      ["마지막 평가 시각", state.operations.lastEvaluatedAt ?? missingValue],
      ["마지막 경보 시각", state.operations.lastAlertAt ?? missingValue],
      ["알림 ID", state.operations.notificationId ?? missingValue],
    ]} /> : <p>경보 평가 정보 미제공</p>}
    <h3>판단 사유</h3>
    {state.reasonCodes.length ? <ul aria-label="판단 사유">{state.reasonCodes.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}</ul> : <p>판단 사유 없음</p>}
    <h3>판단 기능</h3>
    <DetailFields fields={Object.entries(capabilityLabels).map(([key, label]) => [label, state.capabilities ? capabilityStates[state.capabilities[key as keyof typeof capabilityLabels]] : missingValue])} />
    <h3>센서 상태</h3>
    <ul aria-label="센서 상태">{state.sensors.length ? state.sensors.map((sensor, index) => <li key={`${index}-${sensor.id}`}>{sensor.id}: {sensor.state}, 마지막 scan {sensor.lastScanAt ?? missingValue}{sensor.reasonCodes.length ? ` (${sensor.reasonCodes.join(", ")})` : ""}</li>) : <li>센서 상태 정보 없음</li>}</ul>
    {state.deviceReasons.length > 0 && <p>{state.deviceReasons.join(", ")}</p>}
    <h3>장비 진단</h3>
    <DetailFields fields={[
      ["시계 상태", state.clock?.state ?? missingValue],
      ["시계 오차", state.clock?.offsetMs == null ? missingValue : `${state.clock.offsetMs} ms`],
    ]} />
    <ul aria-label="서비스 상태">{state.services?.length ? state.services.map((service, index) => <li key={`${index}-${service.name}`}>{service.name}: {service.state}, 마지막 진행 {service.lastProgressAt ?? missingValue}{service.reasonCodes.length ? ` (${service.reasonCodes.join(", ")})` : ""}</li>) : <li>서비스 상태 정보 없음</li>}</ul>
  </>;
}
