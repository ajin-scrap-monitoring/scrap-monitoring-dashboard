# 프로젝트 상태

## 구현 상태

- 완료: 읽기 전용 프로젝트 명세, 저장소 단일 지침, 시작 문서, 구현 결정, 상태 및 Git 협업 문서
- 완료: 초기화 작업 추적용 GitHub Issue #1
- 미구현: React 애플리케이션, 패키지 설정, 의존성, 테스트, 배포 설정과 Continuous Integration (CI)
- 미구현: HTTP JSON, WebSocket, Web Real-Time Communication (WebRTC), 녹화 미디어와 관리자 인증 연동

## 검증 결과

- OK: `docs/project-spec.md` 미변경
- OK: 루트 `AGENTS.md`의 `.agents/AGENTS.md` 심링크 연결
- OK: 초기화 문서 구조, 내부 링크와 Git diff 검증
- OK: 자격 증명, 실제 사설 주소, 운영 데이터와 상위 로컬 경로 미포함
- N/A: 의존성과 실행 스크립트가 없어 ESLint, TypeScript, 테스트와 Vite 빌드 미실행

## 결정 필요

- `protect-main` ruleset의 필수 검사, 승인 요건과 관리자 우회 정책
- CodeQL 활성화 시점과 검사 구성
- 백엔드 및 미디어 역할과 합의할 API, WebSocket, WebRTC와 녹화 미디어 계약
- 외부 의존성 버전 선택과 라이선스 기록 형식

현재 GitHub 저장소에 ruleset이 없어 `main` 보호와 Pull Request 필수 검사를 강제하지 않는다. 이 초기화 작업은 해당 외부 설정을 변경하지 않는다.

## 다음 단계

1. Pull Request에서 초기화 문서 검토
2. `protect-main` ruleset과 CodeQL 정책 확정 및 적용
3. Node.js 24 LTS, npm, Vite, React와 TypeScript strict mode 기반 프로젝트 생성
4. 의존성 버전과 라이선스 기록 추가
5. 화면 골격, 합성 데이터, 외부 연결 어댑터와 인증 흐름의 순차 구현
6. ESLint, TypeScript, 테스트, Vite 빌드와 CI 검사 구성
