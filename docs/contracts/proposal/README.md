# 프론트엔드 외부 연동 계약 제안

## 상태

이 디렉토리의 문서는 프론트엔드가 필요한 인터페이스를 백엔드 개발자에게 전달하기 위한
초기 제안이다. 제품 또는 서버의 확정 계약이 아니다. 합의한 내용은 계약 정본을 관리할
Repository와 승인 주체를 정한 뒤 확정 상태로 전환한다.

제안은 현재 화면과 합성 데이터가 사용하는 정보만 다룬다. 백엔드 내부 데이터베이스,
측정 알고리즘, 서비스 분리와 저장 구조는 정하지 않는다.

## 제공 파일

| 파일 | 역할 |
| --- | --- |
| `openapi.yaml` | HTTP 요청, 응답, 오류와 schema 제안 |
| `realtime.md` | 실시간 상태 갱신과 WebRTC signaling 전송 방식 검토 |
| `frontend-mapping.md` | 화면 표시와 사용자 조작의 endpoint 및 검증 매핑 |

HTTP 제안은 8개 기능 그룹과 24개 operation으로 구성한다.

| 기능 그룹 | operation 수 | 범위 |
| --- | ---: | --- |
| Session | 3 | 현재 session 조회, 로그인과 로그아웃 |
| Monitoring | 1 | 현재 상태 전체 snapshot 조회 |
| Realtime | 1 | SSE 기반 monitoring 상태 갱신 |
| History | 2 | 대표 적재율 이력과 운영 이벤트 조회 |
| Notifications | 3 | 개인 알림 조회, 읽음 처리와 모두 읽음 처리 |
| Recordings | 5 | 메타데이터 목록 및 단건 조회, 미리보기, byte range 재생과 다운로드 |
| Administration | 6 | 알림 설정, 알림 대상과 테스트 알림 관리 |
| Streaming | 3 | WHEP 형태의 WebRTC session 생성, SDP answer 및 ICE 전달과 종료 |

HTTP 계약은 FastAPI가 기본 생성하고 클라이언트 생성 도구가 사용할 수 있는 OpenAPI 3.1로
작성한다. 오류 본문은 Problem Details for HTTP APIs 형식인 RFC 9457을 적용한다. 시각은
RFC 3339 형식과 명시적인 UTC offset을 사용한다.

참고 규격은 다음과 같다.

- OpenAPI Specification 3.1: https://spec.openapis.org/oas/v3.1.0.html
- FastAPI OpenAPI schema: https://fastapi.tiangolo.com/tutorial/first-steps/#openapi
- RFC 9457 Problem Details: https://www.rfc-editor.org/rfc/rfc9457.html
- RFC 3339 timestamp: https://www.rfc-editor.org/rfc/rfc3339.html
- FastAPI SSE: https://fastapi.tiangolo.com/tutorial/server-sent-events/
- IETF WHEP draft-04: https://datatracker.ietf.org/doc/draft-ietf-wish-whep/04/

## 제안 원칙

- 브라우저가 사용하는 외부 필드만 계약에 노출
- 표시용 문자열 대신 숫자, 식별자와 RFC 3339 시각 전달
- 한글 화면 문구 대신 안정적인 영문 enum 전달
- 현재 상태 전체 snapshot과 이후 실시간 변경 이벤트 분리
- 목록 응답의 page, pageSize, totalItems와 totalPages 제공
- 상태 변경 요청의 명시적인 성공 및 오류 응답 제공
- 관리자 설정 변경의 Entity Tag (ETag)와 `If-Match` 기반 충돌 방지
- RFC 9457 `application/problem+json` 오류 본문 사용
- 요청과 오류 추적을 위한 `X-Request-ID` 응답 header 제공
- 녹화 영상 byte range 재생과 별도 다운로드 응답 구분
- SSE 기반 상태 갱신과 HTTP API 분리
- WHEP 형태의 WebRTC signaling과 실제 미디어 전송 경계 분리

## 백엔드 검토가 필요한 결정

제안 검토 시 다음 10개 항목을 확정하거나 수정한다.

1. API base path와 버전 관리 규칙
2. session Cookie, Bearer token 또는 다른 인증 방식
3. 조회 화면의 비로그인 접근 범위
4. 현재 상태 snapshot의 계산 주체와 갱신 주기
5. LiDAR profile sample의 위치와 높이 표현
6. 이력 표본 생성 주체와 허용 bucket 크기
7. 목록 페이지 이동과 정렬 방식
8. 녹화 재생 URL, byte range와 다운로드 방식
9. 관리자 설정 변경 충돌과 테스트 알림 처리 방식
10. SSE 상태 갱신과 WHEP 형태 signaling의 연결 및 재연결 방식

## 검토 방법

백엔드 개발자는 `openapi.yaml`의 endpoint와 schema를 기준으로 구현 가능 여부를 검토한다.
수정 제안은 필드 단위로 다음 정보를 포함한다.

- 대상 endpoint 또는 메시지 유형
- 추가, 변경 또는 삭제할 필드
- 데이터 형식과 허용값
- 필수값 또는 선택값 여부
- 계산 또는 저장 책임 서비스
- 오류와 결측 상황의 표현
- 호환성 영향

프론트엔드는 `src/test/api-contract-fixtures.ts`의 공개 가능한 예제를 OpenAPI 생성 타입,
데이터 adapter와 브라우저 통합 테스트에 함께 사용한다. 화면별 요청과 변환 범위는
`frontend-mapping.md`를 따른다. 백엔드는 합의한 OpenAPI와 같은 예제로 contract test를
구성한다.

OpenAPI 제안서는 다음 명령으로 문법, 참조와 권장 규칙을 검사한다.

```bash
pnpm run contract:check
```

프론트엔드의 정적 검사, 단위 테스트, 브라우저와 계약 검사는 다음 명령으로 실행한다.

```bash
pnpm run check
```
