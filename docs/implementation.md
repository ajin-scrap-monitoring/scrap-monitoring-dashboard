# 구현 결정

## 적용 상태

이 문서는 `docs/project-spec.md`의 제품 범위를 구현하기 위해 현재 채택한 내부 결정을 정의한다. 현재 저장소에는 애플리케이션 코드와 의존성이 없으며, 아래 결정은 후속 구현의 구조를 제약한다.

## 애플리케이션 구조

`src` 아래는 6개 상위 영역으로 구성한다.

| 영역 | 책임 |
| --- | --- |
| `app` | 시작 지점, 공통 Provider, 라우터와 전체 레이아웃 |
| `pages` | 경로별 화면 조합 |
| `features` | 인증, 적재 상태, 이력, 녹화 영상과 관리자 설정 기능 |
| `shared` | 외부 연결 어댑터, Zod 스키마, 공통 화면 요소, 스타일과 유틸리티 |
| `mocks` | Mock Service Worker (MSW) 처리기, 합성 데이터와 시험 미디어 정보 |
| `test` | Vitest 설정, 공통 렌더링과 테스트 도우미 |

`pages`는 통신 세부 구현을 포함하지 않는다. `features`는 `shared`의 외부 연결 어댑터와 스키마를 사용하고, `pages`는 기능 컴포넌트를 배치한다.

## 런타임과 화면

- Node.js 24 Long-Term Support (LTS)와 npm 기반 Vite 개발 및 정적 빌드
- React, TypeScript strict mode, CSS Modules와 공통 전역 CSS
- 네이티브 HTML 요소 기반 공통 화면 요소와 별도 화면 컴포넌트 프레임워크 미사용
- `react-router` 선언형 모드와 `BrowserRouter`를 사용한 `/`, `/history`, `/recordings`, `/admin` 경로
- 데스크톱 우선 레이아웃과 태블릿 및 모바일 화면 크기 대응
- 정적 파일 서버의 프론트엔드 경로에 대한 `index.html` 반환

## 데이터와 외부 연결

외부 연결은 HTTP 정적 파일, HTTP JSON, WebSocket, Web Real-Time Communication (WebRTC) 실시간 영상과 HTTP 녹화 미디어의 5개 경계로 분리한다. 정확한 주소, 필드명, 메시지 형식과 오류 형식을 임의로 고정하지 않는다.

- `@tanstack/react-query` 기반 HTTP 서버 상태 조회, 캐시와 변경 요청
- WebSocket 수신값의 실시간 데이터 클라이언트를 통한 조회 캐시 반영
- React 컴포넌트 상태, `useReducer`와 화면 범위 Context 기반 화면 내부 상태
- Redux와 Zustand 같은 범용 전역 상태 관리 라이브러리 미사용
- Zod 스키마를 통한 HTTP JSON 응답과 WebSocket 메시지 검증 및 스키마에서 TypeScript 형식 추론
- 브라우저 표준 `fetch`, `WebSocket`, `RTCPeerConnection`과 `HTMLVideoElement` 사용
- `recharts` 기반 적재 추이 시각화

## 인증과 보안

조회 기능은 로그인 없이 제공하고 관리자 설정 변경은 사전 생성된 개별 계정과 서버 세션으로 보호한다. 브라우저는 세션 식별자를 `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/` 속성의 쿠키로만 보관한다. 상태 변경 요청에 Cross-Site Request Forgery (CSRF) 방어를 적용하고, 운영 인증 통신은 Hypertext Transfer Protocol Secure (HTTPS)를 사용한다.

비밀번호, 세션 식별자와 장기 인증 토큰을 React 코드로 읽거나 `localStorage`와 `sessionStorage`에 저장하지 않는다. 세션 만료 후에도 조회 화면은 유지하고 관리자 기능만 잠긴다.

## 개발 대역과 검증

MSW의 같은 요청 처리기를 로컬 개발 화면과 Vitest에서 재사용한다. 정상, 데이터 없음, 지연, 연결 끊김, 인증 만료와 오류 응답을 재현하며 MSW는 개발과 테스트 환경에서만 시작한다. 영상 경계는 고정 시험 영상과 가짜 미디어 연결을 사용하는 대역과 실제 연결이 같은 클라이언트 인터페이스를 사용한다.

자동 검사는 ESLint, TypeScript 검사, Vitest와 Vite 배포용 빌드로 구성한다. 현재는 소스 코드, 패키지 설정, 테스트와 CI가 구현되지 않아 해당 검사를 실행할 수 없다.
