import { useCallback, useState, type FormEvent } from "react";

import { DashboardPageShell } from "../components/DashboardShell";
import { SectionTitle } from "../components/DashboardPrimitives";
import { Pagination } from "../components/Pagination";
import { Dropdown } from "../components/Dropdown";
import type { DashboardDataSource } from "../data/dashboard-data-source";
import type { AlertSettings, DashboardData, DataAreaState, HeaderNotification, RecipientSettings, UserSession } from "../domain/dashboard";
import { useDelayedState } from "../use-delayed-state";
import { useModalFocus } from "../use-modal-focus";

const recipientsPerPage = 10;
const eventChoices = [["collection", "수거 필요"], ["error", "측정 오류"], ["device", "장비 장애"]] as const;
const channelChoices = [["email", "이메일"], ["sms", "문자"]] as const;
function newRecipientDefaults() { return { name: "", team: "", email: "", phone: "", emailChannel: true, smsChannel: false, enabled: true, useGlobal: true, collection: true, error: true, device: true }; }

function AdminCheck({ checked, children, disabled, onChange }: { checked: boolean; children: string; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <label className="admin-check"><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span aria-hidden="true" /><b>{children}</b></label>;
}

function AdminToggle({ checked, className = "admin-toggle", label, offLabel = "중지", onChange }: { checked: boolean; className?: string; label?: string; offLabel?: string; onChange: (checked: boolean) => void }) {
  return <label className={className}>{label && <span>{label}</span>}<input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /><b>{checked ? "사용" : offLabel}</b></label>;
}

function RecipientField({ label, onChange, placeholder, type, value }: { label: string; onChange: (value: string) => void; placeholder?: string; type?: "email" | "tel"; value: string }) {
  return <label><span>{label}</span><input type={type} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function AdminRule({ className = "admin-rule", label, onChange, options, value }: { className?: string; label: string; onChange: (value: string) => void; options: string[]; value: string }) {
  return <div className={className}><span>{label}</span><Dropdown label={label} value={value} onChange={onChange} options={options} /></div>;
}

function alertPolicyView(settings: AlertSettings) {
  return {
    events: {
      collection: settings.enabledEventTypes.includes("collection_required"),
      device: settings.enabledEventTypes.includes("device_error"),
      error: settings.enabledEventTypes.includes("measurement_error"),
    },
    recovery: settings.recoveryNotificationEnabled,
    rules: {
      maximum: `${settings.maximumRepeatCount}회`,
      repeat: settings.repeatIntervalMinutes === 0 ? "반복 안 함" : settings.repeatIntervalMinutes === 60 ? "1시간마다" : `${settings.repeatIntervalMinutes}분마다`,
      sendAt: settings.sendDelayMinutes === 0 ? "즉시" : `${settings.sendDelayMinutes}분 후`,
    },
  };
}

export function AdminPage({ admin, dataSource, headerNotifications, headerUnreadCount, headerNotificationState, session }: { admin: DashboardData["admin"]; dataSource?: DashboardDataSource; headerNotifications: HeaderNotification[]; headerUnreadCount?: number | null; headerNotificationState?: DataAreaState; session?: UserSession | null }) {
  const initialPolicy = alertPolicyView(admin.alertSettings);
  const [alertSettings, setAlertSettings] = useState(admin.alertSettings);
  const [recipients, setRecipients] = useState(admin.recipients);
  const [threshold, setThreshold] = useState(String(admin.alertSettings.collectionThreshold));
  const [currentThreshold, setCurrentThreshold] = useState(String(admin.alertSettings.collectionThreshold));
  const [preAlertThreshold, setPreAlertThreshold] = useState(String(admin.alertSettings.preCollectionAlert.threshold));
  const [preAlertEnabled, setPreAlertEnabled] = useState(admin.alertSettings.preCollectionAlert.enabled);
  const [savedPreAlertThreshold, setSavedPreAlertThreshold] = useState(String(admin.alertSettings.preCollectionAlert.threshold));
  const [savedPreAlertEnabled, setSavedPreAlertEnabled] = useState(admin.alertSettings.preCollectionAlert.enabled);
  const [thresholdMessage, setThresholdMessage] = useState("");
  const [thresholdError, setThresholdError] = useState("");
  const [policyEvents, setPolicyEvents] = useState(initialPolicy.events);
  const [recoveryNotice, setRecoveryNotice] = useState(initialPolicy.recovery);
  const [policyRules, setPolicyRules] = useState(initialPolicy.rules);
  const [savedPolicy, setSavedPolicy] = useState(initialPolicy);
  const [policyMessage, setPolicyMessage] = useState("");
  const [testChannels, setTestChannels] = useState({ email: true, sms: true });
  const [testRecipient, setTestRecipient] = useState(admin.recipients[0]?.email ?? "");
  const [testRecipientError, setTestRecipientError] = useState("");
  const [testAlertState, setTestAlertState, setTestAlertStateAfter] = useDelayedState<"idle" | "processing" | "complete" | "invalid">("idle");
  const [recipientPage, setRecipientPage] = useState(0);
  const [recipientSettings, setRecipientSettings] = useState(admin.recipientSettings);
  const [selectedRecipientEmail, setSelectedRecipientEmail] = useState<string | null>(null);
  const [recipientDraft, setRecipientDraft] = useState<RecipientSettings | null>(null);
  const [recipientSaveError, setRecipientSaveError] = useState("");
  const [addRecipientOpen, setAddRecipientOpen] = useState(false);
  const [addRecipientError, setAddRecipientError] = useState("");
  const [newRecipient, setNewRecipient] = useState(newRecipientDefaults);
  const recipientPages = Math.max(1, Math.ceil(recipients.length / recipientsPerPage));
  const visibleRecipients = recipients.slice(recipientPage * recipientsPerPage, (recipientPage + 1) * recipientsPerPage);
  const selectedRecipient = recipients.find((recipient) => recipient.email === selectedRecipientEmail);
  const selectedRecipientSettings = recipientDraft ?? undefined;
  const requestTestAlert = () => {
    const recipient = recipients.find((item) => item.email === testRecipient);
    if (!recipient) {
      setTestRecipientError("테스트 알림을 보낼 등록 대상을 선택하세요.");
      return;
    }
    setTestRecipientError("");
    if (!testChannels.email && !testChannels.sms) {
      setTestAlertState("invalid");
      return;
    }
    setTestAlertState("processing");
    const channels = [testChannels.email ? "email" : null, testChannels.sms ? "sms" : null].filter((channel): channel is "email" | "sms" => channel !== null);
    if (!dataSource?.sendTestNotification) {
      setTestAlertStateAfter("complete", 400);
      return;
    }
    void dataSource.sendTestNotification(recipient.id, channels)
      .then(() => setTestAlertState("complete"))
      .catch(() => {
        setTestAlertState("idle");
        setTestRecipientError("테스트 알림 요청을 처리하지 못했습니다.");
      });
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
    const nextSettings: AlertSettings = {
      ...alertSettings,
      collectionThreshold: next,
      preCollectionAlert: { enabled: preAlertEnabled, threshold: early },
    };
    setThresholdError("");
    setThresholdMessage("저장 중입니다.");
    void (dataSource?.replaceAlertSettings?.(nextSettings) ?? Promise.resolve(nextSettings))
      .then((saved) => {
        const savedPolicyView = alertPolicyView(saved);
        setAlertSettings(saved);
        setThreshold(String(saved.collectionThreshold));
        setCurrentThreshold(String(saved.collectionThreshold));
        setPreAlertThreshold(String(saved.preCollectionAlert.threshold));
        setPreAlertEnabled(saved.preCollectionAlert.enabled);
        setSavedPreAlertThreshold(String(saved.preCollectionAlert.threshold));
        setSavedPreAlertEnabled(saved.preCollectionAlert.enabled);
        setSavedPolicy(savedPolicyView);
        setThresholdMessage("수거 설정을 저장했습니다.");
      })
      .catch(() => {
        setThresholdMessage("");
        setThresholdError("수거 설정을 저장하지 못했습니다. 최신 설정을 확인한 뒤 다시 시도하세요.");
      });
  };

  const togglePolicyEvent = (key: keyof typeof policyEvents) => {
    setPolicyEvents((events) => ({ ...events, [key]: !events[key] }));
  };

  const updateRecipientSetting = (key: keyof RecipientSettings, value: boolean) => {
    setRecipientDraft((settings) => settings ? { ...settings, [key]: value } : settings);
  };

  const recipientEventSummary = (settings: RecipientSettings) => {
    if (settings.useGlobal) return "공통 정책";
    const events = [settings.collection ? "수거" : "", settings.error ? "오류" : "", settings.device ? "장비" : ""].filter(Boolean);
    return events.length ? events.join(", ") : "수신 안 함";
  };

  const closeRecipientPanel = useCallback(() => {
    setSelectedRecipientEmail(null);
    setRecipientDraft(null);
    setRecipientSaveError("");
  }, []);
  const openRecipientPanel = (email: string) => {
    setSelectedRecipientEmail(email);
    setRecipientDraft(structuredClone(recipientSettings[email]));
    setRecipientSaveError("");
  };
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
    if (!newRecipient.emailChannel && !newRecipient.smsChannel) {
      setAddRecipientError("수신 채널을 하나 이상 선택하세요.");
      return;
    }
    if (newRecipient.smsChannel && !newRecipient.phone.trim()) {
      setAddRecipientError("문자 수신을 사용하려면 전화번호를 입력하세요.");
      return;
    }
    const email = newRecipient.email.trim();
    const settings = { collection: newRecipient.collection, device: newRecipient.device, email: newRecipient.emailChannel, enabled: newRecipient.enabled, error: newRecipient.error, sms: newRecipient.smsChannel, useGlobal: newRecipient.useGlobal };
    const fallback = { recipient: { id: `recipient-${recipients.length + 1}`, version: '"local"', name: newRecipient.name.trim(), team: newRecipient.team.trim(), email, phone: newRecipient.phone.trim() || "-", channel: newRecipient.emailChannel && newRecipient.smsChannel ? "이메일, 문자" : newRecipient.emailChannel ? "이메일" : "문자", enabled: newRecipient.enabled }, settings };
    setAddRecipientError("");
    void (dataSource?.createNotificationRecipient?.({ recipient: { enabled: newRecipient.enabled, email, name: newRecipient.name.trim(), phone: newRecipient.phone.trim() || "-", team: newRecipient.team.trim() }, settings }) ?? Promise.resolve(fallback))
      .then((created) => {
        setRecipients((items) => [...items, created.recipient]);
        setRecipientSettings((items) => ({ ...items, [created.recipient.email]: structuredClone(created.settings) }));
        setRecipientPage(Math.floor(recipients.length / recipientsPerPage));
        setNewRecipient(newRecipientDefaults());
        closeAddRecipient();
      })
      .catch(() => setAddRecipientError("알림 대상을 추가하지 못했습니다."));
  };

  const saveRecipientSettings = () => {
    if (!selectedRecipient || !selectedRecipientSettings) return;
    if (!selectedRecipientSettings.email && !selectedRecipientSettings.sms) {
      setRecipientSaveError("수신 채널을 하나 이상 선택하세요.");
      return;
    }
    setRecipientSaveError("");
    void (dataSource?.updateNotificationRecipient?.(selectedRecipient, selectedRecipientSettings) ?? Promise.resolve({ recipient: selectedRecipient, settings: selectedRecipientSettings }))
      .then((updated) => {
        setRecipients((items) => items.map((item) => item.id === updated.recipient.id ? updated.recipient : item));
        setRecipientSettings((items) => ({ ...items, [updated.recipient.email]: structuredClone(updated.settings) }));
        closeRecipientPanel();
      })
      .catch(() => setRecipientSaveError("수신 설정을 저장하지 못했습니다. 최신 설정을 확인한 뒤 다시 시도하세요."));
  };

  const savePolicy = () => {
    const enabledEventTypes = [
      policyEvents.collection ? "collection_required" : null,
      policyEvents.error ? "measurement_error" : null,
      policyEvents.device ? "device_error" : null,
    ].filter((value): value is AlertSettings["enabledEventTypes"][number] => value !== null);
    if (enabledEventTypes.length === 0) {
      setPolicyMessage("알림 이벤트를 하나 이상 선택하세요.");
      return;
    }
    const nextSettings: AlertSettings = {
      ...alertSettings,
      enabledEventTypes,
      maximumRepeatCount: Number(policyRules.maximum.replace(/\D/g, "")),
      recoveryNotificationEnabled: recoveryNotice,
      repeatIntervalMinutes: policyRules.repeat === "1시간마다" ? 60 : policyRules.repeat === "반복 안 함" ? 0 : Number(policyRules.repeat.replace(/\D/g, "")),
      sendDelayMinutes: policyRules.sendAt === "즉시" ? 0 : Number(policyRules.sendAt.replace(/\D/g, "")),
    };
    setPolicyMessage("저장 중입니다.");
    void (dataSource?.replaceAlertSettings?.(nextSettings) ?? Promise.resolve(nextSettings))
      .then((saved) => {
        const savedPolicyView = alertPolicyView(saved);
        setAlertSettings(saved);
        setPolicyEvents(savedPolicyView.events);
        setRecoveryNotice(savedPolicyView.recovery);
        setPolicyRules(savedPolicyView.rules);
        setSavedPolicy(savedPolicyView);
        setPolicyMessage("알림 정책을 저장했습니다.");
      })
      .catch(() => setPolicyMessage("알림 정책을 저장하지 못했습니다. 최신 설정을 확인한 뒤 다시 시도하세요."));
  };

  return (
    <DashboardPageShell activePage="admin" dataSource={dataSource} headerNotifications={headerNotifications} headerUnreadCount={headerUnreadCount} notificationState={headerNotificationState} session={session}>
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
              <section className="threshold-alert-settings"><div className="threshold-alert-head"><div><h3>사전 수거 알림</h3><p>현재 대표 적재율이 지정한 기준에 도달하면 운영자에게 알림을 보냅니다.</p></div><AdminToggle className="admin-toggle threshold-alert-toggle" checked={preAlertEnabled} onChange={setPreAlertEnabled} /></div><label className="pre-alert-timing"><span>알림 기준 적재율</span><div className="pre-alert-setting-row"><div className="compact-percent-input"><input type="number" min="1" max="99" value={preAlertThreshold} disabled={!preAlertEnabled} onChange={(event) => setPreAlertThreshold(event.target.value)} /><b>%</b></div><small>현재 적용 {savedPreAlertEnabled ? `${savedPreAlertThreshold}%` : "중지"}</small></div></label></section>
            </section>
            <section className="card recipients-card">
              <div className="admin-card-head"><SectionTitle>알림 대상 관리</SectionTitle><div className="recipients-tools"><span>총 {recipients.length}명</span><button className="admin-primary compact" type="button" onClick={() => setAddRecipientOpen(true)}>알림 대상 추가</button></div></div>
              <div className="recipients-table-wrap"><table><thead><tr>{["이름", "소속", "이메일", "전화번호", "수신 채널", "수신 이벤트", "상태", "관리"].map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{visibleRecipients.length > 0 ? visibleRecipients.map((recipient) => { const settings = recipientSettings[recipient.email]; return <tr key={recipient.id}><td>{recipient.name}</td><td>{recipient.team}</td><td>{recipient.email}</td><td>{recipient.phone}</td><td>{settings.email && settings.sms ? "이메일, 문자" : settings.email ? "이메일" : settings.sms ? "문자" : "-"}</td><td>{recipientEventSummary(settings)}</td><td><span className={`status-text ${settings.enabled ? "ok" : "muted"}`}>{settings.enabled ? "사용" : "중지"}</span></td><td><button type="button" className="admin-small-button recipient-settings-button" onClick={() => openRecipientPanel(recipient.email)}>수신 설정</button></td></tr>; }) : <tr><td className="table-empty" colSpan={8}>등록된 알림 대상이 없습니다.</td></tr>}</tbody></table></div><Pagination ariaLabel="알림 대상 페이지" currentPage={recipientPage} itemLabel="알림 대상" onPageChange={setRecipientPage} totalPages={recipientPages} />
            </section>
          </div>
          <div className="admin-bottom">
            <section className="card policy-card">
              <SectionTitle>알림 정책</SectionTitle>
              <div className="policy-body">
                <div className="policy-column"><h3>전역 기본 이벤트</h3><p>공통 정책 사용으로 설정한 알림 대상에게 적용합니다.</p><div className="admin-check-list">{eventChoices.map(([key, label]) => <AdminCheck key={key} checked={policyEvents[key]} onChange={() => togglePolicyEvent(key)}>{label}</AdminCheck>)}</div></div>
                <div className="policy-column policy-rules"><h3>발송 규칙</h3><p>발송 시점과 반복 알림을 설정합니다.</p><AdminRule label="발송 시점" value={policyRules.sendAt} onChange={(sendAt) => { setPolicyRules({ ...policyRules, sendAt }); setPolicyMessage(""); }} options={["즉시", "5분 후"]} /><AdminRule label="반복 알림" value={policyRules.repeat} onChange={(repeat) => { setPolicyRules({ ...policyRules, repeat }); setPolicyMessage(""); }} options={["반복 안 함", "30분마다", "1시간마다"]} /><AdminToggle label="오류 및 장애 해소 알림" checked={recoveryNotice} onChange={setRecoveryNotice} /></div>
              </div>
              <div className="repeat-limit"><div><h3>반복 알림 제한</h3><p>최대 횟수에 도달하거나 이벤트가 해제되면 반복 발송을 종료합니다.</p></div><AdminRule className="repeat-limit-field" label="최대 반복 횟수" value={policyRules.maximum} onChange={(maximum) => { setPolicyRules({ ...policyRules, maximum }); setPolicyMessage(""); }} options={["1회", "3회", "5회"]} /></div>
              <div className="policy-actions">{policyMessage && <span className="policy-feedback" role="status">{policyMessage}</span>}<button className="admin-secondary" type="button" onClick={() => { setPolicyEvents(savedPolicy.events); setRecoveryNotice(savedPolicy.recovery); setPolicyRules(savedPolicy.rules); setPolicyMessage("변경을 취소했습니다."); }}>취소</button><button className="admin-primary compact" type="button" onClick={savePolicy}>정책 저장</button></div>
            </section>
            <section className="card test-alert-card">
              <SectionTitle>테스트 알림</SectionTitle><p className="test-alert-intro">선택한 대상과 채널로 고정 테스트 메시지를 발송합니다.</p><div className="admin-field"><span>등록 대상</span><Dropdown label="등록 대상" value={recipients.find((recipient) => recipient.email === testRecipient) ? `${recipients.find((recipient) => recipient.email === testRecipient)!.name} (${testRecipient})` : "대상 선택"} options={recipients.map((recipient) => `${recipient.name} (${recipient.email})`)} onChange={(value) => { setTestRecipient(recipients.find((recipient) => `${recipient.name} (${recipient.email})` === value)!.email); setTestRecipientError(""); setTestAlertState("idle"); }} /></div><div className="admin-field"><span>채널 선택</span><div className="test-channels">{channelChoices.map(([key, label]) => <AdminCheck key={key} checked={testChannels[key]} onChange={(checked) => setTestChannels((channels) => ({ ...channels, [key]: checked }))}>{label}</AdminCheck>)}</div></div><div className="test-message"><strong>발송 내용</strong><span>스크랩 모니터링 테스트 알림입니다. 이 메시지를 받았다면 알림 수신 설정이 정상입니다.</span></div><button className="admin-outline-button" type="button" disabled={testAlertState === "processing"} onClick={requestTestAlert}>{testAlertState === "processing" ? "테스트 알림 확인 중" : "테스트 알림 보내기"}</button>{testRecipientError && <p role="alert">{testRecipientError}</p>}{testAlertState === "invalid" && <p role="alert">테스트 알림을 보낼 채널을 하나 이상 선택하세요.</p>}{testAlertState === "complete" && <p role="status">테스트 알림 요청을 접수했습니다.</p>}
            </section>
          </div>
        </div>
      </main>
      {selectedRecipient && selectedRecipientSettings && <div className="recipient-panel-backdrop" role="presentation" onClick={closeRecipientPanel}><aside className="recipient-panel" role="dialog" aria-modal="true" aria-label={`${selectedRecipient.name} 수신 설정`} onClick={(event) => event.stopPropagation()}><div className="recipient-panel-head"><div><span>개별 수신 설정</span><h2>{selectedRecipient.name}</h2><p>{selectedRecipient.team} | {selectedRecipient.email}</p></div><button type="button" aria-label="수신 설정 닫기" onClick={closeRecipientPanel}>닫기</button></div><div className="recipient-panel-body"><AdminToggle className="admin-toggle recipient-toggle" label="수신 상태" checked={selectedRecipientSettings.enabled} onChange={(checked) => updateRecipientSetting("enabled", checked)} /><section><h3>수신 채널</h3><div className="panel-check-row">{channelChoices.map(([key, label]) => <AdminCheck key={key} checked={selectedRecipientSettings[key]} onChange={(checked) => updateRecipientSetting(key, checked)}>{label}</AdminCheck>)}</div></section><section><div className="recipient-events-head"><div><h3>수신 이벤트</h3><p>공통 정책을 사용하면 전역 알림 정책의 이벤트를 적용합니다.</p></div><AdminToggle className="admin-toggle recipient-global-toggle" label="공통 정책 사용" offLabel="해제" checked={selectedRecipientSettings.useGlobal} onChange={(checked) => updateRecipientSetting("useGlobal", checked)} /></div><div className={`recipient-events ${selectedRecipientSettings.useGlobal ? "disabled" : ""}`}>{eventChoices.map(([key, label]) => <AdminCheck key={key} disabled={selectedRecipientSettings.useGlobal} checked={selectedRecipientSettings[key]} onChange={(checked) => updateRecipientSetting(key, checked)}>{label}</AdminCheck>)}</div></section>{recipientSaveError && <p role="alert">{recipientSaveError}</p>}</div><div className="recipient-panel-actions"><button className="admin-secondary" type="button" onClick={closeRecipientPanel}>취소</button><button className="admin-primary compact" type="button" onClick={saveRecipientSettings}>수신 설정 저장</button></div></aside></div>}
      {addRecipientOpen && <div className="recipient-add-backdrop" role="presentation" onClick={closeAddRecipient}><form role="dialog" aria-modal="true" className="recipient-add-modal" aria-label="알림 대상 추가" onSubmit={addRecipient} onClick={(event) => event.stopPropagation()}><div className="recipient-add-head"><div><span>ALERT RECIPIENT</span><h2>알림 대상 추가</h2><p>대상 정보와 수신 정책을 설정합니다.</p></div><button type="button" aria-label="알림 대상 추가 닫기" onClick={closeAddRecipient}>닫기</button></div><div className="recipient-add-body"><div className="recipient-add-fields"><RecipientField label="이름" value={newRecipient.name} onChange={(value) => setNewRecipient((item) => ({ ...item, name: value }))} /><RecipientField label="소속" value={newRecipient.team} onChange={(value) => setNewRecipient((item) => ({ ...item, team: value }))} /><RecipientField label="이메일" type="email" value={newRecipient.email} onChange={(value) => setNewRecipient((item) => ({ ...item, email: value }))} /><RecipientField label="전화번호" type="tel" placeholder="010-0000-0000" value={newRecipient.phone} onChange={(value) => setNewRecipient((item) => ({ ...item, phone: value }))} /></div><section className="recipient-add-section"><div className="recipient-add-section-head"><h3>수신 상태</h3><AdminToggle className="admin-toggle recipient-global-toggle" label="수신 사용" checked={newRecipient.enabled} onChange={(checked) => setNewRecipient((item) => ({ ...item, enabled: checked }))} /></div><div className="panel-check-row">{channelChoices.map(([key, label]) => { const field = key === "email" ? "emailChannel" : "smsChannel"; return <AdminCheck key={key} checked={newRecipient[field]} onChange={(checked) => setNewRecipient((item) => ({ ...item, [field]: checked }))}>{label}</AdminCheck>; })}</div></section><section className="recipient-add-section"><h3>수신 이벤트 적용</h3><p>전역 정책을 사용하면 알림 정책 카드의 기본 이벤트를 적용합니다.</p><div className="policy-mode-options">{([[true, "전역 정책 사용", "공통 이벤트와 발송 규칙 적용"], [false, "개별 이벤트 설정", "이 대상에게만 별도 이벤트 적용"]] as const).map(([useGlobal, label, detail]) => <label key={label}><input type="radio" name="recipient-policy" checked={newRecipient.useGlobal === useGlobal} onChange={() => setNewRecipient((item) => ({ ...item, useGlobal }))} /><span><b>{label}</b><small>{detail}</small></span></label>)}</div><div className={`recipient-events add-recipient-events ${newRecipient.useGlobal ? "disabled" : ""}`}>{eventChoices.map(([key, label]) => <AdminCheck key={key} disabled={newRecipient.useGlobal} checked={newRecipient[key]} onChange={(checked) => setNewRecipient((item) => ({ ...item, [key]: checked }))}>{label}</AdminCheck>)}</div></section>{addRecipientError && <p className="recipient-add-error" role="alert">{addRecipientError}</p>}</div><div className="recipient-add-actions"><button className="admin-secondary" type="button" onClick={closeAddRecipient}>취소</button><button className="admin-primary compact" type="submit">알림 대상 추가</button></div></form></div>}
    </DashboardPageShell>
  );
}

export default AdminPage;
