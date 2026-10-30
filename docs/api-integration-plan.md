# 서비스 API 연동 문서 안내

서비스 연동은 다음 문서에서 확인한다. 현재 동작과 추가 계약 요청을 구분하며 이 안내를
구현 착수나 외부 서비스 변경 지시로 사용하지 않는다.

| 확인 대상 | 문서 |
| --- | --- |
| 제품 범위와 기존 화면 유지 | [프로젝트 명세](project-spec.md#사용자-기능) |
| 화면과 adapter의 현재 구현 | [구현 정보](implementation.md#코드-구조와-작업-재개-기준) |
| 계약 revision과 인증 및 공개 경로 | [실제 서비스 계약](contracts/backend/README.md) |
| 데이터 변환, 의도적 비표시와 미구현 요청 | [화면 데이터 매핑](contracts/backend/frontend-mapping.md) |
| 검증 계층과 자원 정리 | [검증 기준](testing.md) |
| 원격 개발 및 읽기 중심 화면 확인 | [개발 환경](development.md#원격-개발-컨테이너) |
| 미착수 화면 전환 개선 | [성능 개선 계획](navigation-performance-plan.md) |
