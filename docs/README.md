# 프로젝트 문서 안내

새 세션은 Repository 지침에서 작업 범위를 확인한 뒤 이 안내로 필요한 문서를 선택한다.
현재 코드, 미착수 계획과 외부 서비스의 미구현은 서로 다른 정보이며 같은 완료 상태로
취급하지 않는다. 기능과 환경의 실제 동작은 관련 소스 및 설정과 함께 확인한다.

## 문서별 책임

문서는 6개 역할로 구분한다. 문서의 상세 내용을 다른 역할의 문서에 복제하지 않는다.

| 역할 | 정본 | 확인할 내용 |
| --- | --- | --- |
| 제품 요구사항 | [프로젝트 명세](project-spec.md) | 사용자 목적, 기존 화면 유지와 변경 금지 경계 |
| 현재 구현 | [구현 정보](implementation.md) | 채택한 기술, 코드 진입점과 화면별 현재 동작 |
| 실행과 검증 | [개발 환경](development.md), [검증 기준](testing.md), [배포](deployment.md) | 개발 및 원격 확인, 검사와 자원 회수, runtime 및 Nginx와 TLS |
| 작업 절차 | [개발 워크플로우](development-workflow.md) | 착수 조건, 로컬 작업과 원격 반영, 완료 및 인계 기준 |
| 외부 계약 | [계약 안내](contracts/README.md), [실제 계약](contracts/backend/README.md), [화면 매핑](contracts/backend/frontend-mapping.md) | 확정 경로와 의미, 제공 범위, 미구현과 서비스별 요청 책임 |
| 구현 계획 | [화면 전환과 성능 개선](navigation-performance-plan.md) | 미착수 작업의 순서, 예상 시간과 검증 조건 |

[설계 참고안](design-reference.md)과 [제안 계약](contracts/proposal/README.md)은 제품 또는
현재 서비스 계약의 정본이 아니다. 계약 revision은 [manifest](contracts/backend/manifest.json),
의존성은 `package.json` 및 lock file, 배포 버전은 Git과 해당 산출물에서 확인한다.

## 작업별 읽기 경로

| 작업 | 먼저 확인할 문서 |
| --- | --- |
| 페이지 문구와 배치 수정 | [제품 요구사항](project-spec.md#사용자-기능), [화면 구현](implementation.md#코드-구조와-작업-재개-기준), [회귀 기준](testing.md) |
| 화면 전환과 로딩 개선 | [현재 진입점](implementation.md#진입점과-화면-구성), [요청 수명](implementation.md#데이터-소스와-요청-수명), [구현 계획](navigation-performance-plan.md) |
| 값이 없거나 상태가 맞지 않는 문제 | [응답 연결 점검](contracts/backend/frontend-mapping.md#제공-응답과-화면-연결-점검), 관련 adapter 및 화면 코드 |
| 녹화 조회와 재생 및 다운로드 | [녹화 구현](implementation.md#녹화-조회와-재생), [실제 영상 계약](contracts/backend/README.md#실시간-영상과-녹화-파일), [녹화 요청 책임](contracts/backend/frontend-mapping.md#이력-및-녹화-영상의-일괄-협의-항목) |
| 알림과 관리자 설정 | [공통 헤더](implementation.md#공통-헤더와-인증), [관리자 구현](implementation.md#관리자-설정과-알림), [외부 적용 범위](contracts/backend/frontend-mapping.md#관리자-설정과-알림의-협의-항목) |
| Scrap 개발 화면과 source 동기화 | [원격 개발](development.md#원격-개발-컨테이너), [화면 확인](development.md#원격-화면-확인) |
| Backend 및 Media Service에 전달할 요청 | [추가 계약 요청](contracts/backend/frontend-mapping.md#추가-계약-요청) |
| 계약 snapshot과 생성 타입 변경 | [계약 출처](contracts/backend/README.md#계약-출처), [계약 검사](testing.md#정적-검사와-테스트-기준선) |
| 검증 실패와 산출물 확인 | [검증 기준](testing.md), [통합 자원 회수](testing.md#컨테이너-통합-검증) |
| 이미지 및 환경 설정 | [배포 경계](deployment.md), [runtime 설정](deployment.md#runtime-설정) |

## 계획과 구현의 구분

화면 전환과 성능 개선 계획은 별도 구현 요청을 위한 작업 입력이다. 현재 코드에
client-side routing이나 화면 간 공통 캐시가 있다는 근거로 사용하지 않는다.
계획의 목표, 예상 시간과 완료 조건은 계획서 한 곳에서 유지한다.

서비스 연동과 품질의 현재 설명은 구현 정보, 검증 기준과 계약 매핑을 사용한다.
`api-integration-plan.md`와 `frontend-improvement-plan.md`는 해당 정본문서의 연결만 제공하며
새로 실행할 작업 목록이 아니다. 진행 상태와 검토 결과의 기록 경계는 Repository 지침을
따른다.
