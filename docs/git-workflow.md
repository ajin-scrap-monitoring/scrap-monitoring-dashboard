# Git 협업 원칙

## 브랜치

`main`은 검증된 통합 상태만 유지한다. `main`에 직접 커밋하거나 Push하지 않는다. 모든 변경은 최신 `main`에서 분기한 목적별 작업 브랜치에서 수행한다.

작업 브랜치 이름은 변경 종류와 목적을 나타낸다. 하나의 브랜치에는 하나의 목적만 포함한다.

```text
docs/repository-initialization
feat/status-dashboard
fix/session-expiration
```

## Issue와 Pull Request

작업은 가능한 경우 GitHub Issue에서 목적, 범위, 제외 범위와 완료 조건을 정의한다. 작업 브랜치와 Pull Request는 해당 Issue를 연결한다.

Pull Request에는 변경 목적, 핵심 변경, 검증 결과, 미실행 검사와 장애 요인을 기록한다. 소스 코드 변경은 화면 상태, 외부 계약, 보안, 접근성과 반응형 화면에 미치는 영향을 검토한다. 검토자가 재현할 수 있는 크기로 변경을 유지한다.

## 필수 검사

모든 Pull Request는 다음 검사를 통과해야 한다.

- 변경 파일과 의도한 범위의 일치
- `docs/project-spec.md`와 저장소 지침 준수
- 자격 증명, 사설 주소, 운영 데이터와 비공개 원본 미포함
- 문서 링크와 심링크 유효성
- ESLint
- TypeScript 검사
- Vitest
- Vite 배포용 빌드

프로젝트 초기화 전처럼 특정 검사를 실행할 수 없는 상태에서는 이유와 후속 조치를 Pull Request와 `docs/status.md`에 기록한다. 소스 코드와 CI 구성이 생성된 후에는 위 자동 검사를 생략하지 않는다.

## 병합과 정리

모든 Pull Request는 필수 검사와 검토를 마친 후 Squash 방식으로 `main`에 병합한다. Squash 커밋 메시지는 완료된 변경 목적을 나타내고 관련 Issue를 연결한다. 병합이 완료되면 원격 작업 브랜치를 삭제하고, 로컬 작업 브랜치는 더 이상 필요하지 않을 때 정리한다.
