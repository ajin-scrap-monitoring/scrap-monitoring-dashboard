import { useState } from "react";

import { applicationVersion } from "../application-version";
import { ROUTES, setAuthenticated } from "../app-routing";
import { LockIcon, UserIcon } from "../components/DashboardPrimitives";
import type { DashboardDataSource } from "../data/dashboard-data-source";

export function LoginPage({ dataSource }: { dataSource?: DashboardDataSource }) {
  const [showPassword, setShowPassword] = useState(false);
  const [rememberLogin, setRememberLogin] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  return (
    <main className="login-page" aria-label="관리자 로그인">
      <section className="login-intro">
        <div className="login-brand" aria-label="AJIN SCRAP MONITORING"><span className="brand-mark" aria-hidden="true" /><span>AJIN SCRAP MONITORING</span></div>
        <div className="login-intro-copy">
          <span className="login-overline">AJIN INDUSTRIAL</span>
          <h1>스크랩 모니터링<br />관리자 시스템</h1>
        </div>
        <div className="login-intro-status">
          <span>Copyright 2026 AJIN INDUSTRIAL. All rights reserved.</span>
          <span>Version {applicationVersion}</span>
        </div>
      </section>
      <section className="login-form-area">
        <div className="login-form-wrap">
          <div className="login-form-heading">
            <span className="login-form-kicker">ADMINISTRATOR</span>
            <h2>로그인</h2>
            <p>관리자 계정 정보를 입력하세요.</p>
          </div>
          <form className="login-form" onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const usernameEntry = form.get("username");
            const passwordEntry = form.get("password");
            const username = typeof usernameEntry === "string" ? usernameEntry.trim() : "";
            const password = typeof passwordEntry === "string" ? passwordEntry : "";
            if (!username || !password) {
              setLoginError("아이디와 비밀번호를 입력하세요.");
              return;
            }
            setSubmitting(true);
            setLoginError("");
            void (dataSource?.createSession?.({ password, persistent: rememberLogin, username }) ?? Promise.resolve().then(setAuthenticated))
              .then(() => window.location.assign(ROUTES.monitoring))
              .catch(() => {
                setLoginError("아이디 또는 비밀번호를 확인하세요.");
                setSubmitting(false);
              });
          }}>
            <label htmlFor="login-id">아이디</label>
            <div className="login-field">
              <UserIcon />
              <input id="login-id" name="username" autoComplete="username" placeholder="관리자 아이디" required />
            </div>
            <label htmlFor="login-password">비밀번호</label>
            <div className="login-field">
              <LockIcon />
              <input id="login-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="비밀번호" required />
              <button type="button" className="password-visibility" onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? "숨기기" : "표시"}</button>
            </div>
            <label className="remember-login"><input type="checkbox" checked={rememberLogin} onChange={(event) => setRememberLogin(event.target.checked)} /><span>로그인 상태 유지</span></label>
            {loginError && <p role="alert">{loginError}</p>}
            <button className="login-submit" type="submit" disabled={submitting}>{submitting ? "로그인 중" : "로그인"}</button>
          </form>
          <p className="login-help">계정 또는 접근 권한 문의는 시스템 관리자에게 요청하세요.</p>
          <a className="login-dashboard-link" href={ROUTES.monitoring}>현황 보기</a>
        </div>
      </section>
    </main>
  );
}
