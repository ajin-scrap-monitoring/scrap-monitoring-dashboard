import { useCallback, useState, type FormEvent } from "react";

import { DashboardPageShell } from "../components/DashboardShell";
import { SectionTitle } from "../components/DashboardPrimitives";
import { Pagination } from "../components/Pagination";
import { Dropdown } from "../components/Dropdown";
import type { DashboardData, HeaderNotification, RecipientSettings } from "../domain/dashboard";
import { useDelayedState } from "../use-delayed-state";
import { useModalFocus } from "../use-modal-focus";

const recipientsPerPage = 10;
export function AdminPage({ admin, headerNotifications }: { admin: DashboardData["admin"]; headerNotifications: HeaderNotification[] }) {
  const [recipients, setRecipients] = useState(admin.recipients);
  const [threshold, setThreshold] = useState("85");
  const [currentThreshold, setCurrentThreshold] = useState("80");
  const [preAlertThreshold, setPreAlertThreshold] = useState(String(admin.preCollectionAlert.threshold));
  const [preAlertEnabled, setPreAlertEnabled] = useState(admin.preCollectionAlert.enabled);
  const [savedPreAlertThreshold, setSavedPreAlertThreshold] = useState(String(admin.preCollectionAlert.threshold));
  const [savedPreAlertEnabled, setSavedPreAlertEnabled] = useState(admin.preCollectionAlert.enabled);
  const [thresholdMessage, setThresholdMessage] = useState("");
  const [thresholdError, setThresholdError] = useState("");
  const [policyEvents, setPolicyEvents] = useState({ collection: true, device: true, error: true });
  const [recoveryNotice, setRecoveryNotice] = useState(true);
  const [policyRules, setPolicyRules] = useState({ sendAt: "즉시", repeat: "30분마다", maximum: "3회" });
  const [savedPolicy, setSavedPolicy] = useState({ events: policyEvents, recovery: recoveryNotice, rules: policyRules });
  const [policyMessage, setPolicyMessage] = useState("");
  const [testChannels, setTestChannels] = useState({ email: true, sms: true });
  const [testRecipient, setTestRecipient] = useState(admin.recipients[0]?.email ?? "");
  const [testRecipientError, setTestRecipientError] = useState("");
  const [testAlertState, setTestAlertState, setTestAlertStateAfter] = useDelayedState<"idle" | "processing" | "complete" | "invalid">("idle");
  const [recipientPage, setRecipientPage] = useState(0);
  const [recipientSettings, setRecipientSettings] = useState(admin.recipientSettings);
  const [selectedRecipientEmail, setSelectedRecipientEmail] = useState<string | null>(null);
  const [addRecipientOpen, setAddRecipientOpen] = useState(false);
  const [addRecipientError, setAddRecipientError] = useState("");
  const [newRecipient, setNewRecipient] = useState({ name: "", team: "", email: "", phone: "", emailChannel: true, smsChannel: false, enabled: true, useGlobal: true, collection: true, error: true, device: true });
  const recipientPages = Math.max(1, Math.ceil(recipients.length / recipientsPerPage));
  const visibleRecipients = recipients.slice(recipientPage * recipientsPerPage, (recipientPage + 1) * recipientsPerPage);
  const selectedRecipient = recipients.find((recipient) => recipient.email === selectedRecipientEmail);
  const selectedRecipientSettings = selectedRecipientEmail ? recipientSettings[selectedRecipientEmail] : undefined;
  const requestTestAlert = () => {
    if (!recipients.some((recipient) => recipient.email === testRecipient)) {
      setTestRecipientError("테스트 알림을 보낼 등록 대상을 선택하세요.");
      return;
    }
    setTestRecipientError("");
    if (!testChannels.email && !testChannels.sms) {
      setTestAlertState("invalid");
      return;
    }
    setTestAlertState("processing");
    setTestAlertStateAfter("complete", 400);
  };

  const saveThreshold = () => {
    const next = Number(threshold);
    const early = Number(preAlertThreshold);
    setThresholdMessage("");
    if (!threshold.trim() || !Number.isInteger(next) || next < 1 || next > 100) {
      setThresholdError("수거 임계율은 1~100 사이의 정수로 입력하세요.");
      return;
    }
    if (preAlertEnabled && (!preAlertThreshold.trim() || !Number.isInteger(early) || early < 1 || early >= next)) {
      setThresholdError("사전 알림 기준은 1 이상, 수거 임계율 미만의 정수로 입력하세요.");
      return;
    }
    setCurrentThreshold(String(next));
    setSavedPreAlertThreshold(preAlertThreshold);
    setSavedPreAlertEnabled(preAlertEnabled);
    setThresholdError("");
    setThresholdMessage("예시 설정을 적용했습니다. 서버에는 저장되지 않습니다.");
  };

  const togglePolicyEvent = (key: keyof typeof policyEvents) => {
    setPolicyEvents((events) => ({ ...events, [key]: !events[key] }));
  };

  const updateRecipientSetting = (key: keyof RecipientSettings, value: boolean) => {
    if (!selectedRecipientEmail) return;
    setRecipientSettings((settings) => ({ ...settings, [selectedRecipientEmail]: { ...settings[selectedRecipientEmail], [key]: value } }));
  };

  const recipientEventSummary = (settings: RecipientSettings) => {
    if (settings.useGlobal) return "공통 정책";
    const events = [settings.collection ? "수거" : "", settings.error ? "오류" : "", settings.device ? "장비" : ""].filter(Boolean);
    return events.length ? events.join(", ") : "수신 안 함";
  };

  const closeRecipientPanel = useCallback(() => setSelectedRecipientEmail(null), []);
  const closeAddRecipient = useCallback(() => {
    setAddRecipientOpen(false);
    setAddRecipientError("");
  }, []);
  useModalFocus<HTMLElement>(selectedRecipient !== undefined && selectedRecipientSettings !== undefined, closeRecipientPanel, ".recipient-panel");
  useModalFocus<HTMLElement>(addRecipientOpen, closeAddRecipient, ".recipient-add-modal");

  const addRecipient = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newRecipient.name.trim() || !newRecipient.team.trim() || !newRecipient.email.trim()) {
      setAddRecipientError("이름, 소속, 이메일을 입력하세요.");
      return;
    }
    if (recipients.some((recipient) => recipient.email.toLowerCase() === newRecipient.email.trim().toLowerCase())) {
      setAddRecipientError("이미 등록된 이메일입니다.");
      return;
    }
    const email = newRecipient.email.trim();
    setRecipients((items) => [...items, { name: newRecipient.name.trim(), team: newRecipient.team.trim(), email, phone: newRecipient.phone.trim() || "-", channel: newRecipient.emailChannel && newRecipient.smsChannel ? "이메일, 문자" : newRecipient.emailChannel ? "이메일" : newRecipient.smsChannel ? "문자" : "-", enabled: newRecipient.enabled }]);
    setRecipientSettings((settings) => ({ ...settings, [email]: { collection: newRecipient.collection, device: newRecipient.device, email: newRecipient.emailChannel, enabled: newRecipient.enabled, error: newRecipient.error, sms: newRecipient.smsChannel, useGlobal: newRecipient.useGlobal } }));
    setRecipientPage(Math.floor(recipients.length / recipientsPerPage));
    setNewRecipient({ name: "", team: "", email: "", phone: "", emailChannel: true, smsChannel: false, enabled: true, useGlobal: true, collection: true, error: true, device: true });
    closeAddRecipient();
  };

  return (
    <DashboardPageShell activePage="admin" headerNotifications={headerNotifications}>
      <main className="admin-page" aria-label="관리자 설정">
        <div className="page-heading"><h1>관리자 설정</h1></div>
        <div className="admin-content">
          <div className="admin-top">
            <section className="card threshold-card">
              <SectionTitle>수거 임계율</SectionTitle>
              <div className="threshold-editor">
                <div className="threshold-change"><label htmlFor="threshold-input" className="admin-label">변경값</label><div className="threshold-input"><input id="threshold-input" type="number" min="1" max="100" value={threshold} onChange={(event) => setThreshold(event.target.value)} /><span>%</span></div><p>허용 범위는 서버 설정을 따릅니다.</p>{thresholdError && <p role="alert">{thresholdError}</p>}{thresholdMessage && <p role="status">{thresholdMessage}</p>}<button className="admin-primary" type="button" onClick={saveThreshold}>수거 설정 저장</button></div>
                <div className="threshold-applied"><span>현재 적용값</span><strong>{currentThreshold}<small>%</small></strong></div>
              </div>
              <section className="threshold-alert-settings"><div className="threshold-alert-head"><div><h3>사전 수거 알림</h3><p>현재 대표 적재율이 지정한 기준에 도달하면 운영자에게 알림을 보냅니다.</p></div><label className="admin-toggle threshold-alert-toggle"><input type="checkbox" checked={preAlertEnabled} onChange={(event) => setPreAlertEnabled(event.target.checked)} /><i aria-hidden="true" /><b>{preAlertEnabled ? "사용" : "중지"}</b></label></div><label className="pre-alert-timing"><span>알림 기준 적재율</span><div className="pre-alert-setting-row"><div className="compact-percent-input"><input type="number" min="1" max="99" value={preAlertThreshold} disabled={!preAlertEnabled} onChange={(event) => setPreAlertThreshold(event.target.value)} /><b>%</b></div><small>현재 적용 {savedPreAlertEnabled ? `${savedPreAlertThreshold}%` : "중지"}</small></div></label></section>
            </section>
            <section className="card recipients-card">
              <div className="admin-card-head"><SectionTitle>알림 대상 관리</SectionTitle><div className="recipients-tools"><span>총 {recipients.length}명</span><button className="admin-primary compact" type="button" onClick={() => setAddRecipientOpen(true)}>알림 대상 추가</button></div></div>
              <div className="recipients-table-wrap"><table><thead><tr><th>이름</th><th>소속</th><th>이메일</th><th>전화번호</th><th>수신 채널</th><th>수신 이벤트</th><th>상태</th><th>관리</th></tr></thead><tbody>{visibleRecipients.length > 0 ? visibleRecipients.map((recipient) => { const settings = recipientSettings[recipient.email]; return <tr key={recipient.email}><td>{recipient.name}</td><td>{recipient.team}</td><td>{recipient.email}</td><td>{recipient.phone}</td><td>{settings.email && settings.sms ? "이메일, 문자" : settings.email ? "이메일" : settings.sms ? "문자" : "-"}</td><td>{recipientEventSummary(settings)}</td><td><span className={`status-text ${settings.enabled ? "ok" : "muted"}`}>{settings.enabled ? "사용" : "중지"}</span></td><td><button type="button" className="admin-small-button recipient-settings-button" onClick={() => setSelectedRecipientEmail(recipient.email)}>수신 설정</button></td></tr>; }) : <tr><td className="table-empty" colSpan={8}>등록된 알림 대상이 없습니다.</td></tr>}</tbody></table></div><Pagination ariaLabel="알림 대상 페이지" currentPage={recipientPage} itemLabel="알림 대상" onPageChange={setRecipientPage} totalPages={recipientPages} />
            </section>
          </div>
          <div className="admin-bottom">
            <section className="card policy-card">
              <SectionTitle>알림 정책</SectionTitle>
              <div className="policy-body">
                <div className="policy-column"><h3>전역 기본 이벤트</h3><p>공통 정책 사용으로 설정한 알림 대상에게 적용합니다.</p><div className="admin-check-list"><label className="admin-check"><input type="checkbox" checked={policyEvents.collection} onChange={() => togglePolicyEvent("collection")} /><span aria-hidden="true" /><b>수거 필요</b></label><label className="admin-check"><input type="checkbox" checked={policyEvents.error} onChange={() => togglePolicyEvent("error")} /><span aria-hidden="true" /><b>측정 오류</b></label><label className="admin-check"><input type="checkbox" checked={policyEvents.device} onChange={() => togglePolicyEvent("device")} /><span aria-hidden="true" /><b>장비 장애</b></label></div></div>
                <div className="policy-column policy-rules"><h3>발송 규칙</h3><p>발송 시점과 반복 알림을 설정합니다.</p><div className="admin-rule"><span>발송 시점</span><Dropdown label="발송 시점" value={policyRules.sendAt} onChange={(sendAt) => { setPolicyRules({ ...policyRules, sendAt }); setPolicyMessage(""); }} options={["즉시", "5분 후"]} /></div><div className="admin-rule"><span>반복 알림</span><Dropdown label="반복 알림" value={policyRules.repeat} onChange={(repeat) => { setPolicyRules({ ...policyRules, repeat }); setPolicyMessage(""); }} options={["반복 안 함", "30분마다", "1시간마다"]} /></div><label className="admin-toggle"><span>오류 및 장애 해소 알림</span><input type="checkbox" checked={recoveryNotice} onChange={(event) => setRecoveryNotice(event.target.checked)} /><i aria-hidden="true" /><b>{recoveryNotice ? "사용" : "중지"}</b></label></div>
              </div>
              <div className="repeat-limit"><div><h3>반복 알림 제한</h3><p>최대 횟수에 도달하거나 이벤트가 해제되면 반복 발송을 종료합니다.</p></div><div className="repeat-limit-field"><span>최대 반복 횟수</span><Dropdown label="최대 반복 횟수" value={policyRules.maximum} onChange={(maximum) => { setPolicyRules({ ...policyRules, maximum }); setPolicyMessage(""); }} options={["1회", "3회", "5회"]} /></div></div>
              <div className="policy-actions">{policyMessage && <span className="policy-feedback" role="status">{policyMessage}</span>}<button className="admin-secondary" type="button" onClick={() => { setPolicyEvents(savedPolicy.events); setRecoveryNotice(savedPolicy.recovery); setPolicyRules(savedPolicy.rules); setPolicyMessage("변경을 취소했습니다."); }}>취소</button><button className="admin-primary compact" type="button" onClick={() => { setSavedPolicy({ events: policyEvents, recovery: recoveryNotice, rules: policyRules }); setPolicyMessage("예시 정책을 적용했습니다. 서버에는 저장되지 않습니다."); }}>정책 저장</button></div>
            </section>
            <section className="card test-alert-card">
              <SectionTitle>테스트 알림</SectionTitle><p className="test-alert-intro">선택한 대상과 채널로 고정 테스트 메시지를 발송합니다.</p><div className="admin-field"><span>등록 대상</span><Dropdown label="등록 대상" value={recipients.find((recipient) => recipient.email === testRecipient) ? `${recipients.find((recipient) => recipient.email === testRecipient)!.name} (${testRecipient})` : "대상 선택"} options={recipients.map((recipient) => `${recipient.name} (${recipient.email})`)} onChange={(value) => { setTestRecipient(recipients.find((recipient) => `${recipient.name} (${recipient.email})` === value)!.email); setTestRecipientError(""); setTestAlertState("idle"); }} /></div><div className="admin-field"><span>채널 선택</span><div className="test-channels"><label className="admin-check"><input type="checkbox" checked={testChannels.email} onChange={(event) => setTestChannels((channels) => ({ ...channels, email: event.target.checked }))} /><span aria-hidden="true" /><b>이메일</b></label><label className="admin-check"><input type="checkbox" checked={testChannels.sms} onChange={(event) => setTestChannels((channels) => ({ ...channels, sms: event.target.checked }))} /><span aria-hidden="true" /><b>문자</b></label></div></div><div className="test-message"><strong>발송 내용</strong><span>스크랩 모니터링 테스트 알림입니다. 이 메시지를 받았다면 알림 수신 설정이 정상입니다.</span></div><button className="admin-outline-button" type="button" disabled={testAlertState === "processing"} onClick={requestTestAlert}>{testAlertState === "processing" ? "테스트 알림 확인 중" : "테스트 알림 보내기"}</button>{testRecipientError && <p role="alert">{testRecipientError}</p>}{testAlertState === "invalid" && <p role="alert">테스트 알림을 보낼 채널을 하나 이상 선택하세요.</p>}{testAlertState === "complete" && <p role="status">테스트 알림은 서버 연동 후 실제 발송됩니다.</p>}
            </section>
          </div>
        </div>
      </main>
      {selectedRecipient && selectedRecipientSettings && <div className="recipient-panel-backdrop" role="presentation" onClick={() => setSelectedRecipientEmail(null)}><aside className="recipient-panel" role="dialog" aria-modal="true" aria-label={`${selectedRecipient.name} 수신 설정`} onClick={(event) => event.stopPropagation()}><div className="recipient-panel-head"><div><span>개별 수신 설정</span><h2>{selectedRecipient.name}</h2><p>{selectedRecipient.team} | {selectedRecipient.email}</p></div><button type="button" aria-label="수신 설정 닫기" onClick={() => setSelectedRecipientEmail(null)}>닫기</button></div><div className="recipient-panel-body"><label className="admin-toggle recipient-toggle"><span>수신 상태</span><input type="checkbox" checked={selectedRecipientSettings.enabled} onChange={(event) => updateRecipientSetting("enabled", event.target.checked)} /><i aria-hidden="true" /><b>{selectedRecipientSettings.enabled ? "사용" : "중지"}</b></label><section><h3>수신 채널</h3><div className="panel-check-row"><label className="admin-check"><input type="checkbox" checked={selectedRecipientSettings.email} onChange={(event) => updateRecipientSetting("email", event.target.checked)} /><span aria-hidden="true" /><b>이메일</b></label><label className="admin-check"><input type="checkbox" checked={selectedRecipientSettings.sms} onChange={(event) => updateRecipientSetting("sms", event.target.checked)} /><span aria-hidden="true" /><b>문자</b></label></div></section><section><div className="recipient-events-head"><div><h3>수신 이벤트</h3><p>공통 정책을 사용하면 전역 알림 정책의 이벤트를 적용합니다.</p></div><label className="admin-toggle recipient-global-toggle"><span>공통 정책 사용</span><input type="checkbox" checked={selectedRecipientSettings.useGlobal} onChange={(event) => updateRecipientSetting("useGlobal", event.target.checked)} /><i aria-hidden="true" /><b>{selectedRecipientSettings.useGlobal ? "사용" : "해제"}</b></label></div><div className={`recipient-events ${selectedRecipientSettings.useGlobal ? "disabled" : ""}`}><label className="admin-check"><input type="checkbox" disabled={selectedRecipientSettings.useGlobal} checked={selectedRecipientSettings.collection} onChange={(event) => updateRecipientSetting("collection", event.target.checked)} /><span aria-hidden="true" /><b>수거 필요</b></label><label className="admin-check"><input type="checkbox" disabled={selectedRecipientSettings.useGlobal} checked={selectedRecipientSettings.error} onChange={(event) => updateRecipientSetting("error", event.target.checked)} /><span aria-hidden="true" /><b>측정 오류</b></label><label className="admin-check"><input type="checkbox" disabled={selectedRecipientSettings.useGlobal} checked={selectedRecipientSettings.device} onChange={(event) => updateRecipientSetting("device", event.target.checked)} /><span aria-hidden="true" /><b>장비 장애</b></label></div></section></div><div className="recipient-panel-actions"><button className="admin-secondary" type="button" onClick={() => setSelectedRecipientEmail(null)}>취소</button><button className="admin-primary compact" type="button" onClick={() => setSelectedRecipientEmail(null)}>수신 설정 저장</button></div></aside></div>}
      {addRecipientOpen && <div className="recipient-add-backdrop" role="presentation" onClick={closeAddRecipient}><form role="dialog" aria-modal="true" className="recipient-add-modal" aria-label="알림 대상 추가" onSubmit={addRecipient} onClick={(event) => event.stopPropagation()}><div className="recipient-add-head"><div><span>ALERT RECIPIENT</span><h2>알림 대상 추가</h2><p>대상 정보와 수신 정책을 설정합니다.</p></div><button type="button" aria-label="알림 대상 추가 닫기" onClick={closeAddRecipient}>닫기</button></div><div className="recipient-add-body"><div className="recipient-add-fields"><label><span>이름</span><input value={newRecipient.name} onChange={(event) => setNewRecipient((item) => ({ ...item, name: event.target.value }))} /></label><label><span>소속</span><input value={newRecipient.team} onChange={(event) => setNewRecipient((item) => ({ ...item, team: event.target.value }))} /></label><label><span>이메일</span><input type="email" value={newRecipient.email} onChange={(event) => setNewRecipient((item) => ({ ...item, email: event.target.value }))} /></label><label><span>전화번호</span><input type="tel" placeholder="010-0000-0000" value={newRecipient.phone} onChange={(event) => setNewRecipient((item) => ({ ...item, phone: event.target.value }))} /></label></div><section className="recipient-add-section"><div className="recipient-add-section-head"><h3>수신 상태</h3><label className="admin-toggle recipient-global-toggle"><span>수신 사용</span><input type="checkbox" checked={newRecipient.enabled} onChange={(event) => setNewRecipient((item) => ({ ...item, enabled: event.target.checked }))} /><i aria-hidden="true" /><b>{newRecipient.enabled ? "사용" : "중지"}</b></label></div><div className="panel-check-row"><label className="admin-check"><input type="checkbox" checked={newRecipient.emailChannel} onChange={(event) => setNewRecipient((item) => ({ ...item, emailChannel: event.target.checked }))} /><span aria-hidden="true" /><b>이메일</b></label><label className="admin-check"><input type="checkbox" checked={newRecipient.smsChannel} onChange={(event) => setNewRecipient((item) => ({ ...item, smsChannel: event.target.checked }))} /><span aria-hidden="true" /><b>문자</b></label></div></section><section className="recipient-add-section"><h3>수신 이벤트 적용</h3><p>전역 정책을 사용하면 알림 정책 카드의 기본 이벤트를 적용합니다.</p><div className="policy-mode-options"><label><input type="radio" name="recipient-policy" checked={newRecipient.useGlobal} onChange={() => setNewRecipient((item) => ({ ...item, useGlobal: true }))} /><span><b>전역 정책 사용</b><small>공통 이벤트와 발송 규칙 적용</small></span></label><label><input type="radio" name="recipient-policy" checked={!newRecipient.useGlobal} onChange={() => setNewRecipient((item) => ({ ...item, useGlobal: false }))} /><span><b>개별 이벤트 설정</b><small>이 대상에게만 별도 이벤트 적용</small></span></label></div><div className={`recipient-events add-recipient-events ${newRecipient.useGlobal ? "disabled" : ""}`}><label className="admin-check"><input type="checkbox" disabled={newRecipient.useGlobal} checked={newRecipient.collection} onChange={(event) => setNewRecipient((item) => ({ ...item, collection: event.target.checked }))} /><span aria-hidden="true" /><b>수거 필요</b></label><label className="admin-check"><input type="checkbox" disabled={newRecipient.useGlobal} checked={newRecipient.error} onChange={(event) => setNewRecipient((item) => ({ ...item, error: event.target.checked }))} /><span aria-hidden="true" /><b>측정 오류</b></label><label className="admin-check"><input type="checkbox" disabled={newRecipient.useGlobal} checked={newRecipient.device} onChange={(event) => setNewRecipient((item) => ({ ...item, device: event.target.checked }))} /><span aria-hidden="true" /><b>장비 장애</b></label></div></section>{addRecipientError && <p className="recipient-add-error" role="alert">{addRecipientError}</p>}</div><div className="recipient-add-actions"><button className="admin-secondary" type="button" onClick={closeAddRecipient}>취소</button><button className="admin-primary compact" type="submit">알림 대상 추가</button></div></form></div>}
    </DashboardPageShell>
  );
}

export default AdminPage;
