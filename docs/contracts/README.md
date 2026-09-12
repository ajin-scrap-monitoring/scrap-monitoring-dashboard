# 외부 연동 계약 작업

## 목적

이 문서는 대시보드와 외부 서비스 사이에서 확정해야 하는 계약 항목, 결정 순서와 완료
조건의 정본이다. 실제 작업 진행 상태와 검토 요청은 GitHub Issue와 Pull Request (PR)에서
관리한다.

제품 범위와 외부 경계는 `docs/project-spec.md`, 현재 구현과 채택한 기술은
`docs/implementation.md`, 개발 단계는 `docs/development-workflow.md`를 따른다. 확정한 계약
산출물은 이 디렉토리에 추가한다.

프론트엔드 관점의 초기 계약 제안은 `proposal/README.md`, 화면별 매핑은
`proposal/frontend-mapping.md`에서 확인한다. 제안에 포함된 경로, 인증 방식, 필드와 상태
코드는 백엔드 및 관련 담당자의 승인 전까지 확정값이 아니다.

## 계약 범위

외부 연동 계약은 9개 영역으로 구분한다.

| 영역 | 결정 내용 | 주요 결정 주체 |
| --- | --- | --- |
| 공통 데이터 규칙 | 식별자, 시각, 단위, 열거형, 결측값, 오류와 페이지 이동 | 프론트엔드와 FastAPI 담당자 |
| 인증과 세션 | 접근 범위, 로그인, 권한, 세션 수명과 요청 보호 | 프론트엔드, FastAPI와 운영 담당자 |
| 현재 상태 | 현재 적재 상태, 측정값, 장비 상태, 임계값과 활성 알림 | 프론트엔드, 측정과 FastAPI 담당자 |
| 실시간 상태 갱신 | 전송 방식, 이벤트 형식, 순서, 중복, 재연결과 재동기화 | 프론트엔드와 FastAPI 담당자 |
| 이력과 이벤트 | 조회 기간, 집계 간격, 정렬, 필터, 적재율 변화와 운영 이벤트 | 프론트엔드, 측정과 FastAPI 담당자 |
| 녹화 영상 | 녹화 목록, 메타데이터, 보관 기간, 재생과 다운로드 | 프론트엔드, FastAPI와 미디어 담당자 |
| 관리자 설정과 알림 | 임계율, 알림 정책, 수신 대상, 테스트 발송과 변경 충돌 | 프론트엔드, FastAPI와 운영 담당자 |
| WebRTC signaling | 세션 수명, offer, answer, ICE candidate, 연결 종료와 재연결 | 프론트엔드, FastAPI와 미디어 담당자 |
| 배포와 reverse proxy | 경로, upstream, DNS, readiness, timeout, 제한, TLS와 신뢰 경계 | FastAPI, 미디어, 배포와 보안 담당자 |

## 결정 순서

외부 계약은 6단계로 확정한다. 앞 단계의 결과를 다음 단계 입력으로 사용한다.

### 1. 계약 정본과 책임 확정

다음 항목을 먼저 결정한다.

- 계약 파일을 관리할 Repository와 변경 승인 주체
- Hypertext Transfer Protocol (HTTP) 계약 명세 형식과 버전
- 실시간 전송 계약 명세 형식과 버전
- 호환되지 않는 계약 변경의 버전 관리 방법
- 프론트엔드, FastAPI, 측정, 미디어와 배포 담당자의 검토 범위

HTTP 계약은 OpenAPI 사용을 우선 검토한다. 실시간 push 방식을 채택하면 메시지 envelope와
payload schema를 기계적으로 검사할 수 있는 형식을 우선 검토한다.

### 2. 공통 데이터 규칙 확정

모든 Application Programming Interface (API)에서 공통으로 사용할 규칙을 결정한다.

- 식별자 형식과 안정성
- 시각 표현, 기준 시간대와 정밀도
- 높이, 적재율과 기간의 단위
- 필수값, 선택값, `null`과 필드 부재의 의미
- 유효하지 않은 측정값, 오래된 측정값과 결측 구간의 표현
- 열거형 값과 알 수 없는 값의 호환 규칙
- 목록의 정렬, 필터와 페이지 이동 방식
- 오류 응답의 코드, 메시지, 상세 정보와 request ID
- 클라이언트 재시도가 가능한 오류와 불가능한 오류
- 응답과 실시간 이벤트의 schema 버전

### 3. HTTP API 확정

각 기능 그룹의 경로와 데이터 구조를 확정한다.

| 기능 그룹 | 필요한 계약 |
| --- | --- |
| 현재 상태 | 전체 snapshot 조회, 측정 시각, 운영 상태, LiDAR별 통계, 장비 상태, 임계값, 활성 알림과 수거 통계 |
| 이력 | 조회 시작과 종료 시각, 표본 간격, 대표 적재율 시계열, 이벤트 유형 필터와 페이지 이동 |
| 녹화 영상 | 조회 기간, 녹화 목록과 단건 조회, 영상 식별자, 시작과 종료 시각, 형식, 해상도, 크기, 보관 만료 시각과 다운로드 |
| 관리자 설정 | 현재 설정 조회, 임계율과 알림 정책 변경, 알림 대상 조회와 변경, 테스트 알림 발송 |
| 인증 | 로그인, 로그아웃, 현재 사용자와 세션 상태, 권한 부족과 세션 만료 응답 |

각 endpoint에는 다음 항목이 모두 있어야 한다.

- 외부 경로와 HTTP method
- 인증 및 권한 조건
- path, query, header와 body 입력
- 성공 응답 schema와 상태 코드
- 오류 응답 schema와 상태 코드
- 빈 결과와 데이터 없음의 표현
- 캐시 허용 여부
- 재시도와 멱등성 규칙
- 설정 변경의 동시성 충돌 처리

관리자 설정 변경에는 버전 번호, Entity Tag (ETag) 또는 이에 준하는 비교 조건을 사용하여
다른 관리자의 변경을 덮어쓰지 않는 방식을 결정한다.

### 4. 실시간 갱신과 WebRTC signaling 확정

실시간 상태 갱신은 다음 항목을 결정한다.

- 전송 방식과 연결 경로 및 인증 방식
- 최초 연결 이후 전체 snapshot 수신 여부
- 이벤트 envelope, 유형, 발생 시각과 순번
- 중복 이벤트 식별과 처리 규칙
- 순서가 바뀌거나 누락된 이벤트의 처리 규칙
- 장기 연결 채택 시 heartbeat와 연결 끊김 판정 기준
- 장기 연결 채택 시 재연결 간격, 최대 재시도와 backoff 규칙
- 재연결 뒤 누락 구간 복구 또는 전체 snapshot 재조회 규칙
- 세션 만료와 권한 변경 시 연결 종료 규칙

Web Real-Time Communication (WebRTC) signaling은 다음 항목을 결정한다.

- signaling 세션 생성과 종료
- 추측하기 어려운 signaling session 식별자
- Session Description Protocol (SDP) offer와 answer 교환
- Interactive Connectivity Establishment (ICE) candidate 교환
- ICE server 설정 전달 방식
- 카메라 또는 스트림 식별 방식
- 브라우저 재연결과 미디어 서비스 오류 처리
- signaling 인증과 접근 권한

Nginx는 signaling 요청만 FastAPI로 전달한다. WebRTC 미디어 패킷은 Nginx와 FastAPI를
통과하지 않는다.

### 5. 배포 계약 확정

배포 전에 다음 8개 항목을 결정한다.

| 항목 | 결정 내용 | 결정 주체 |
| --- | --- | --- |
| API와 signaling 경로 | 외부 경로, HTTP method, upstream별 경로 보존 또는 변경 규칙 | 프론트엔드와 FastAPI 담당자 |
| upstream과 Docker DNS | Docker Compose service 이름, port, resolver 주소, DNS cache 유효 시간과 resolver timeout | 배포 담당자 |
| readiness | FastAPI readiness endpoint, 응답 조건, healthcheck와 배포 순서 | FastAPI와 배포 담당자 |
| proxy timeout | API, SSE와 signaling별 connect, send, read timeout과 SSE keep-alive 주기 | FastAPI와 미디어 담당자 |
| 요청 제한 | API 종류별 request body 최대 크기, IP 또는 사용자 기준 rate limit, 초과 응답 상태 | FastAPI와 운영 담당자 |
| 인증과 오류 | 인증 전달 방식, Cookie 사용 시 Cross-Site Request Forgery (CSRF) 방어, Cross-Origin Resource Sharing (CORS), upstream 오류 응답 형식과 재시도 규칙 | FastAPI와 프론트엔드 담당자 |
| ingress 신뢰 경계 | Nginx 앞단 proxy 유무, `real_ip_header`, 신뢰 proxy IP 대역과 client IP 기록 기준 | 배포 담당자 |
| TLS와 CSP | Transport Layer Security (TLS) 종료 위치, HTTP Strict Transport Security (HSTS) 적용 조건, API와 signaling 및 미디어 origin의 Content Security Policy (CSP) 허용 목록 | 배포와 보안 담당자 |

실제 upstream 주소, 인증서, 사설 주소와 환경별 값은 이 Repository의 컨테이너 이미지에
포함하지 않는다. 배포 Repository가 Nginx runtime 설정으로 주입한다.

### 6. 프론트엔드 연동과 검증

프론트엔드는 제안 계약으로 생성한 타입과 HTTP 데이터 source adapter를 사용한다. 화면
컴포넌트는 도메인 모델을 사용하고 adapter가 외부 응답을 도메인 모델로 변환한다. 외부
계약을 확정할 때 OpenAPI, 생성 타입, adapter와 계약 예제를 함께 변경한다.

검증 범위는 다음과 같다.

- 계약 schema와 예제 응답 검사
- 실제 API adapter 단위 테스트
- 합성 데이터와 실제 API adapter의 동작 일치 검사
- 정상, 로딩, 빈 결과, 부분 결측과 오류 응답 검사
- 인증 만료, 권한 부족과 설정 변경 충돌 검사
- 채택한 실시간 전송의 연결, 끊김, 재연결과 재동기화 검사
- WebRTC signaling 연결과 재연결 검사
- 녹화 영상 재생, range 요청과 다운로드 검사
- Nginx proxy, 보안 header, cache와 timeout 검사
- 통합 환경에서 브라우저 사용자 흐름 검사

## 화면별 데이터 확인 항목

### 현황

- 대표 적재율과 측정 시각
- 운영 상태와 최근 변화량
- 수거 임계율과 사전 알림 기준
- LiDAR 1과 LiDAR 2의 평균, 최솟값과 최댓값
- 측정값 유효성 또는 결측 상태
- 카메라, LiDAR와 edge 장비 상태
- 활성 알림 목록과 읽음 상태
- 최근 수거 후 경과와 평균 수거 주기
- 임계율 예상 도달 시각과 남은 시간

### 이력

- 대표 적재율 시계열과 표본 간격
- 수거 임계율 변경 이력 반영 방식
- 알림, 오류, 수거 필요와 수거 완료 이벤트
- 이벤트 발생 시각, 유형, 상태와 내용
- 기간 및 이벤트 유형 필터
- 페이지 이동과 정렬 기준

### 녹화 영상

- 녹화 시작과 종료 시각
- 영상 길이, 형식, codec, 해상도와 파일 크기
- 보관 시작, 보관 만료와 삭제 상태
- 연결된 운영 이벤트
- 재생 URL 또는 재생 세션
- 다운로드 권한, 파일 이름과 만료 규칙

### 관리자 설정

- 수거 임계율과 사전 알림 기준
- 반복 알림 제한과 발송 내용
- 알림 채널과 이벤트 유형별 정책
- 알림 대상의 이름, 소속, 연락처와 개인별 수신 설정
- 설정 버전과 마지막 변경 정보
- 테스트 알림 요청 접수와 사용자의 실제 수신 확인

## 완료 조건

외부 연동 계약은 다음 조건을 모두 만족하면 확정 상태로 본다.

- 모든 화면 표시값과 사용자 조작의 API 또는 실시간 메시지 매핑
- 모든 endpoint의 입력, 성공 응답, 오류 응답, 인증과 권한 정의
- 단위, 시각, 결측, 유효성, 열거형과 페이지 이동 규칙 정의
- 실시간 이벤트의 순서, 중복, 재연결과 재동기화 규칙 정의
- WebRTC signaling과 미디어 전송 경계 정의
- 관리자 변경의 동시성 충돌과 멱등성 규칙 정의
- Nginx와 배포 Repository가 주입할 환경별 값 정의
- 공개 가능한 예제 payload와 계약 검사 작성
- 프론트엔드, FastAPI, 측정, 미디어와 배포 담당자의 관련 범위 승인

자격 증명, 사설 주소, 현장 데이터와 운영 원본은 계약 예제에 포함하지 않는다.
