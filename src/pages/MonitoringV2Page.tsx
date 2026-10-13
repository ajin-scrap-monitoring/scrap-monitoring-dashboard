import { useCallback, useState } from "react";

import cameraFrame from "../assets/camera-frame.png";
import { DashboardPageShell } from "../components/DashboardShell";
import { DashboardStatusLabel, ExpandIcon, SectionTitle } from "../components/DashboardPrimitives";
import { LiveVideo } from "../components/LiveVideo";
import type { DashboardDataSource } from "../data/dashboard-data-source";
import type { DashboardData } from "../domain/dashboard";
import { useModalFocus } from "../use-modal-focus";

const capabilityLabels = { fill: "적재율", occlusion: "가림", collection: "수거", vision: "영상 판단" };
const capabilityStates = { NOT_IMPLEMENTED: "미구현", NOT_VALIDATED: "미검증", ENABLED: "활성화" };

export default function MonitoringV2Page({ data, dataSource }: { data: DashboardData; dataSource: DashboardDataSource }) {
  const { monitoring, session } = data;
  const state = monitoring.v2;
  const [videoOpen, setVideoOpen] = useState(false);
  const closeVideo = useCallback(() => setVideoOpen(false), []);
  const modalRef = useModalFocus<HTMLDivElement>(videoOpen, closeVideo);
  if (!state) return null;
  return <DashboardPageShell activePage="monitoring" dataSource={dataSource} headerNotifications={monitoring.headerNotifications} headerUnreadCount={monitoring.unreadNotificationCount} session={session}>
    <main className="monitoring-page monitoring-v2" aria-label="스크랩 모니터링 대시보드">
      <div className="page-heading">
        <h1>스크랩 모니터링</h1>
        <div className="page-meta"><DashboardStatusLabel status={monitoring.status} /><span>pit {state.pitId}</span><span>관측 시각 {state.measuredAt ?? "정보 없음"}</span></div>
      </div>
      <div className="monitoring-grid">
        <section className="card span-4 kpi-card">
          <SectionTitle>현재 판단</SectionTitle>
          <p>대표 적재율</p>
          <div className="kpi-value">{monitoring.summary.loadPercent === null ? "판단 불가" : <>{monitoring.summary.loadPercent}<span>%</span></>}</div>
          {monitoring.summary.loadPercent !== null && <div className="progress" aria-label={`대표 적재율 ${monitoring.summary.loadPercent}%`}><div style={{ width: `${monitoring.summary.loadPercent}%` }} /></div>}
          <dl className="v2-details">
            <div><dt>경고 임계율</dt><dd>{state.warningThreshold}%</dd></div>
            <div><dt>수거 임계율</dt><dd>{monitoring.summary.collectionThreshold}%</dd></div>
            <div><dt>데이터 상태</dt><dd>{state.dataState}</dd></div>
            <div><dt>STATE 판단</dt><dd>{state.fillState ?? "정보 없음"}</dd></div>
            <div><dt>판단 수신 시각</dt><dd>{state.assessmentReceivedAt ?? "정보 없음"}</dd></div>
            <div><dt>설정 revision</dt><dd>{state.configRevision ?? "정보 없음"}</dd></div>
          </dl>
          {state.streamState === "reconnecting" && <p role="status">실시간 연결이 끊겨 현재 수치를 표시하지 않습니다. 재연결을 기다립니다.</p>}
          {state.reasonCodes.length > 0 && <ul aria-label="판단 사유">{state.reasonCodes.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
        </section>
        <section className="card span-8 video-card">
          <SectionTitle>실시간 영상</SectionTitle>
          <div className="live-frame">
            {!videoOpen && <LiveVideo alt="스크랩 적재 공간 실시간 영상" fallbackImage={cameraFrame} monitoring={monitoring} />}
            <button className="fullscreen" type="button" aria-label="실시간 영상 크게 보기" onClick={() => setVideoOpen(true)}><ExpandIcon /></button>
          </div>
          <p>Media Service는 프레임 촬영 시각을 제공하지 않습니다.</p>
        </section>
        <section className="card span-8">
          <SectionTitle>장비 상태</SectionTitle>
          <dl className="v2-details">
            <div><dt>site / edge</dt><dd>{state.siteId} / {state.edgeId}</dd></div>
            <div><dt>연결 상태</dt><dd>{state.connectionState}</dd></div>
            <div><dt>장비 상태</dt><dd>{state.effectiveState}</dd></div>
            <div><dt>장비 상태 수신 시각</dt><dd>{state.deviceReceivedAt ?? "정보 없음"}</dd></div>
          </dl>
          <ul aria-label="센서 상태">{state.sensors.length ? state.sensors.map((sensor) => <li key={sensor.id}>{sensor.id}: {sensor.state}, 마지막 scan {sensor.lastScanAt ?? "정보 없음"}{sensor.reasonCodes.length ? ` (${sensor.reasonCodes.join(", ")})` : ""}</li>) : <li>센서 상태 정보 없음</li>}</ul>
          {state.deviceReasons.length > 0 && <p>{state.deviceReasons.join(", ")}</p>}
        </section>
        <section className="card span-4">
          <SectionTitle>판단 기능</SectionTitle>
          <dl className="v2-details">{Object.entries(capabilityLabels).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{state.capabilities ? capabilityStates[state.capabilities[key as keyof typeof capabilityLabels]] : "정보 없음"}</dd></div>)}</dl>
          <p>v2는 LiDAR profile, 적재율 추이, 예상 도달 시각과 자동 알림을 제공하지 않습니다.</p>
        </section>
      </div>
    </main>
    {videoOpen && <div ref={modalRef} className="video-modal" role="dialog" aria-modal="true" aria-label="실시간 영상 크게 보기" onClick={closeVideo}>
      <div className="video-modal-panel" onClick={(event) => event.stopPropagation()}><button className="video-modal-close" type="button" onClick={closeVideo}>닫기</button><div className="video-modal-frame"><LiveVideo alt="스크랩 적재 공간 실시간 영상 확대" fallbackImage={cameraFrame} monitoring={monitoring} /></div></div>
    </div>}
  </DashboardPageShell>;
}
