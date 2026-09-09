# 대시보드 화면 목업

이 디렉터리는 대시보드 화면 설계를 브라우저에서 검토하기 위한 코드 기반 목업을 제공한다.
제품 소스 코드가 아니며 구현 요구사항의 정본으로 사용하지 않는다. 채택 전 설계 기준은
`docs/design-reference.md`에서 관리한다.

## 구성

| 경로 | 내용 |
| --- | --- |
| `index.html` | 현황, 이력, 녹화 영상, 관리자 설정과 로그인 화면 구조 |
| `styles.css` | 공통 테마, 글자 위계와 화면 배치 |
| `mockups.js` | 쿼리 매개변수 기반 화면 선택 |
| `render.mjs` | 1584 x 992 화면 5종 렌더링 |
| `assets/` | 합성 영상 예시, Noto Sans KR 글꼴과 글꼴 라이선스 |
| `rendered/` | 검토용 PNG 렌더링 결과 |

목업은 합성 데이터와 일반화한 도형만 포함한다. 현장 원본 이미지, 내부 치수와 비공개
참고 자산은 포함하지 않는다.

## 화면 확인

Repository 루트에서 다음 명령을 실행한다.

```bash
pnpm install --frozen-lockfile
node docs/mockups/render.mjs
```

Playwright의 Chromium 브라우저 실행 파일이 로컬에 설치되어 있어야 한다. 필요한 버전과
Continuous Integration (CI) 환경은 `docs/implementation.md`를 따른다.

브라우저에서 `docs/mockups/index.html?page=monitoring`을 열어 개별 화면을 확인할 수도 있다.
`page` 값은 `monitoring`, `history`, `recordings`, `admin`, `login` 중 하나다.

## 글꼴 라이선스

목업은 SIL Open Font License 1.1로 배포되는 Noto Sans KR을 포함한다. 라이선스 전문은
`assets/OFL.txt`에서 확인한다.
