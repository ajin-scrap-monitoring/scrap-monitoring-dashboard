# 프론트엔드 설계 참고안

## 문서 역할

이 문서는 정본이 아닌 화면 설계 참고안의 사용 경계만 기록한다. 제품 요구사항은
`docs/project-spec.md`, 현재 구현은 `docs/implementation.md`, 작업 절차는
`docs/development-workflow.md`가 정본이다.

현재 화면의 구조, 배치, 색상, 글꼴과 상호작용은 React, TypeScript와 CSS 코드가 정본이다.
공개 목업과 렌더링 방법은 `docs/mockups/README.md`에서 확인한다.

## 사용 경계

새 화면 또는 큰 사용자 경험 변경을 검토할 때만 이 문서를 참고한다. 참고안은 요구사항,
완료 조건, 외부 계약 또는 구현 결정을 확정하지 않는다.

구현 전에 현재 Issue의 인수 조건과 `docs/project-spec.md`를 확인한다. 확인된 결과는 코드와
해당 정본 문서에 반영하며, 이 문서에 중복 기록하지 않는다.
