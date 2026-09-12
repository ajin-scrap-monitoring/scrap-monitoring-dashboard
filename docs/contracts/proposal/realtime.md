# 실시간 전송 계약 제안

## 상태

프론트엔드는 모니터링 상태 갱신에 Server-Sent Events (SSE), Web Real-Time Communication
(WebRTC) signaling에 WebRTC-HTTP Egress Protocol (WHEP) 형태의 HTTP interface를
우선 제안한다. WebSocket은 초기 계약에 사용하지 않는다.

WHEP는 WebRTC 기반 시청을 위한 Internet Engineering Task Force (IETF) 표준화 진행 중인
Internet-Draft다. 미디어 서비스가 WHEP를 지원하지 않으면 미디어 서비스의 기존 signaling
interface를 확인한 뒤 이 제안을 수정한다.

전송 계약은 2개다.

| 계약 | 선택 기술 | 용도 |
| --- | --- | --- |
| 모니터링 상태 갱신 | SSE | 측정값, 장비 상태와 알림 변경 수신 |
| WebRTC signaling | WHEP 형태의 HTTP | 영상 session, Session Description Protocol (SDP)과 Interactive Connectivity Establishment (ICE) 교환 |

두 연결은 독립적으로 동작한다. 영상 연결 실패가 측정 상태 갱신을 중단시키지 않는다.

## 모니터링 상태 갱신

### 선택

모니터링 상태 갱신은 SSE를 사용한다.

현재 화면은 서버가 계산한 상태를 브라우저로 보내는 단방향 구조다. 브라우저가 서버에 보내는
로그인, 알림 읽음 처리와 관리자 설정 변경은 일반 HTTP API로 분리한다. 양방향 장기 연결이
필요하지 않으므로 WebSocket보다 SSE가 역할에 맞다.

SSE를 선택한 이유는 다음 5개다.

1. 서버에서 브라우저로 전달하는 단방향 갱신
2. 일반 HTTP 인증과 reverse proxy 경로 재사용
3. 브라우저 EventSource의 자동 재연결
4. `Last-Event-ID`를 이용한 누락 event 재개
5. WebSocket heartbeat와 별도 command protocol 불필요

### 연결

브라우저는 최초 화면 진입 시 `GET /api/v1/monitoring/snapshot`으로 전체 상태를 조회한다.
이후 `GET /api/v1/monitoring/events`에 SSE 연결을 생성한다.

연결 절차는 5단계다.

1. 브라우저가 현재 session을 확인한다.
2. 브라우저가 전체 monitoring snapshot을 조회하고 적용한다.
3. 브라우저가 SSE endpoint에 연결한다.
4. 서버가 변경 event를 순서대로 전송한다.
5. 연결이 끊기면 브라우저가 마지막 event ID로 자동 재연결한다.

Cookie 인증을 채택하면 EventSource가 same-origin session Cookie를 사용한다. Bearer token을
채택하면 브라우저 기본 EventSource의 header 제한을 고려하여 fetch streaming 또는 짧은 수명의
stream ticket을 별도로 결정한다.

비로그인 연결에는 공개 monitoring event만 전송한다. `notification.created`는 유효한 session
Cookie가 있는 연결에만 전송한다.

### event 형식

초기 event 유형은 4개다.

| event | data | 브라우저 처리 |
| --- | --- | --- |
| `monitoring.snapshot` | OpenAPI `MonitoringSnapshot` | 현재 monitoring 상태 전체 교체 |
| `notification.created` | OpenAPI `Notification` | 개인 알림함 갱신 |
| `session.expired` | 만료 또는 취소 이유 | 연결 종료와 로그인 화면 이동 |
| `stream.resync-required` | 재동기화 이유 | HTTP snapshot과 인증 사용자의 개인 알림함 재조회 |

초기 구현은 부분 patch 대신 전체 `monitoring.snapshot`을 전송한다. 이 방식은 일부 필드만
도착하여 화면 상태가 서로 다른 시각을 나타내는 문제를 방지한다. snapshot 크기와 갱신 주기가
운영 부하가 되는 경우에만 부분 event를 추가한다.

SSE frame 예시는 다음과 같다.

```text
id: 1042
event: monitoring.snapshot
retry: 5000
data: {"schemaVersion":"1","snapshotId":"snapshot-example-001","measuredAt":"2026-09-10T10:24:18+09:00","status":"normal"}
```

`id`는 같은 stream 안에서 증가하는 event 식별자다. 브라우저가 재연결할 때
`Last-Event-ID`로 마지막 적용값을 전송한다.

### 재연결과 재동기화

- 서버가 마지막 event 이후 기록을 보관하면 누락 event 재전송
- 마지막 event가 보관 범위 밖이면 `stream.resync-required` 전송
- `stream.resync-required` 수신 시 HTTP snapshot과 인증 사용자의 개인 알림함 재조회
- 같은 event ID 재수신 시 중복으로 무시
- 알 수 없는 event 유형 수신 시 연결 유지와 진단 기록
- 인증된 연결의 session 만료 시 `session.expired` 전송과 로그인 화면 이동

SSE event 보관 시간, 서버의 keep-alive 주기와 `retry` 값은 측정 주기, 허용 지연과 Nginx
timeout을 확인한 뒤 배포 계약에서 확정한다.

## WebRTC signaling

### 선택

WebRTC signaling은 `draft-ietf-wish-whep-04` 형태의 HTTP interface를 우선 사용한다.

이 화면은 브라우저가 카메라 영상을 송출하는 구조가 아니라 미디어 서비스의 단일 영상을
시청하는 egress 구조다. WHEP는 이 용도를 위해 HTTP `POST`, `PATCH`와 `DELETE`로 WebRTC
session을 관리한다. 별도 WebSocket message protocol을 설계하지 않아도 되므로 custom
signaling보다 상호 운용성과 검토 가능성이 높다.

### HTTP 흐름

signaling 흐름은 6단계다.

1. 브라우저가 `recvonly` transceiver와 SDP offer를 생성한다.
2. 브라우저가 `streamId` 경로로 WebRTC session 생성을 요청한다.
3. FastAPI가 `201` SDP answer와 session Location 및 Entity Tag (ETag) 또는 `406` SDP counter-offer와 session Location을 반환한다.
4. `201`의 SDP가 trickle ICE를 협상하면 브라우저가 후보와 수집 완료를 모아 `If-Match`가 있는 HTTP `PATCH`로 전달한다.
5. `406`이면 브라우저가 ICE 수집을 마친 SDP answer를 `If-Match` 없이 HTTP `PATCH`로 먼저 전달한다.
6. 브라우저가 HTTP `DELETE`로 session을 종료한다.

제안 endpoint는 `openapi.yaml`에 정의한다.

| method | 제안 경로 | 용도 |
| --- | --- | --- |
| `POST` | `/api/v1/webrtc/streams/{streamId}` | 영상 session 생성과 SDP 교환 |
| `PATCH` | `/api/v1/webrtc/sessions/{sessionId}` | SDP answer 또는 trickle ICE fragment 전달 |
| `DELETE` | `/api/v1/webrtc/sessions/{sessionId}` | 영상 session 종료 |

브라우저는 응답의 `Content-Type: application/sdp`와 same-origin Location을 검증한다. `201`은
strong ETag와 `a=ice-options:trickle`을 요구하고 SDP answer를 적용한다. `406`은 기존 local offer를
rollback하고 서버 offer에 대한 전체 ICE SDP answer를 session Location으로 먼저 전송한다.
연결 실패 시 서버가 `Retry-After`를 반환하면 그 지연을 우선 적용하고, 없으면 1초, 2초,
3초 간격으로 새 session을 만든다. 이후에는 사용자가 수동으로 다시 연결할 수 있다.
확대 화면으로 전환하거나 화면을 떠나면 브라우저가 기존 session에 `DELETE`를 요청한다.

### 역할 경계

| 구성 요소 | 책임 |
| --- | --- |
| 브라우저 | SDP offer 생성, ICE 처리, peer connection과 재생 관리 |
| Nginx | 확정된 HTTP signaling API를 FastAPI로 전달 |
| FastAPI | 확정된 접근 정책 확인, 추측하기 어려운 session 식별자 생성, WHEP 형태의 signaling 중개와 session 수명 관리 |
| 미디어 서비스 | 카메라 stream 선택, SDP answer와 WebRTC 미디어 송신 |

WebRTC 미디어 패킷은 Nginx와 FastAPI를 통과하지 않는다. FastAPI는 signaling만 중개한다.

### 미디어 서비스 확인 항목

WHEP 형태를 최종 확정하기 전에 다음 6개를 확인한다.

1. 미디어 서비스의 WHEP 지원 여부와 지원 version
2. 브라우저 offer와 미디어 서비스 answer 방향 지원 여부
3. trickle ICE 지원 여부
4. ICE server와 짧은 수명 credential의 offer 생성 전 제공 방식
5. session 종료와 만료 처리
6. codec, 해상도와 동시 시청자 제한

미디어 서비스가 WHEP를 지원하지 않으면 FastAPI가 WHEP 형태의 외부 interface를 제공하고
내부에서 미디어 서비스의 native signaling으로 변환할 수 있는지 검토한다. 변환이 불가능할
때만 프론트엔드 계약을 미디어 서비스의 native interface에 맞춘다.

## WebSocket 제외 이유

WebSocket을 초기 계약에서 제외하는 이유는 4개다.

1. 모니터링 갱신은 서버에서 브라우저로 전달하는 단방향 흐름
2. 관리자 command는 일반 HTTP API로 분리 가능
3. 영상 signaling은 WHEP 형태의 HTTP interface로 표현 가능
4. 별도 heartbeat, message 순서와 재연결 protocol 설계 불필요

기존 Nginx WebSocket proxy 기능은 제거하지 않는다. 향후 미디어 서비스의 native signaling이
WebSocket만 지원하거나 실제 양방향 실시간 요구가 생길 때 배포 Repository가 해당 설정을
주입할 수 있는 선택 경계로 유지한다.

## 완료 조건

- SSE event schema와 event ID 생성 책임 확정
- 측정 주기와 허용 지연에 맞는 snapshot 발송 조건 확정
- event 보관 범위와 `Last-Event-ID` 재개 규칙 확정
- 미디어 서비스의 WHEP 또는 변환 가능성 확인
- WebRTC session, SDP, ICE, 종료와 만료 규칙 확정
- 브라우저 offer 생성 전에 적용할 STUN 또는 TURN 설정 전달 방식 확정
- Nginx SSE buffering, cache와 read timeout 입력값 확정
- 정상 연결, 누락 event, 재연결과 session 만료 통합 테스트
- 프론트엔드, FastAPI, 미디어와 배포 담당자의 관련 범위 승인
