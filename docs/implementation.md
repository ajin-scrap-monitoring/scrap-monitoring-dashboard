# 프론트엔드 구현 정보

## 현재 구현 범위

현재 구현은 브라우저 실행, 로컬 검증, GitHub Actions의 `CI`와 Release 실행 흐름을
확인하는 최소 화면이다. 대시보드의 화면 구조, 측정 정보 표현과 외부 서비스 연동은
구현하지 않는다.

## 채택 기술

| 영역 | 기술 |
| --- | --- |
| UI 구현 | React 19 |
| 구현 언어 | TypeScript 6 |
| 개발 및 빌드 | Vite 8 |
| 단위 테스트 | Vitest 4 |
| 정적 검사 | ESLint 10과 typescript-eslint 8 |
| 실행 환경 | Node.js 24와 npm |

## 소스 구조

| 경로 | 역할 |
| --- | --- |
| `index.html` | 브라우저 진입 문서 |
| `src/main.tsx` | React 애플리케이션 마운트와 최소 화면 |
| `src/status.ts` | 실행 상태 문구 생성 |
| `src/status.test.ts` | 실행 상태 단위 테스트 |
| `src/styles.css` | 최소 화면 스타일 |
| `src/vite-env.d.ts` | Vite 브라우저 자원 타입 선언 |
| `.github/workflows/ci.yml` | 필수 `CI` Check Run 보고 |
| `.github/workflows/release.yml` | Release 검증, asset 생성과 게시 |
| `THIRD_PARTY_LICENSES.txt` | 배포 파일에 포함되는 제3자 라이선스 고지 |

## 실행

의존성을 설치하고 개발 서버를 실행한다.

```sh
npm ci
npm run dev
```

Vite가 출력한 로컬 주소를 브라우저에서 연다.

## 검증

| 명령 | 검증 대상 |
| --- | --- |
| `npm run lint` | TypeScript와 TSX 정적 검사 |
| `npm run typecheck` | TypeScript 타입 검사 |
| `npm run test` | 단위 테스트 |
| `npm run build` | 배포용 정적 빌드 |

GitHub Actions는 `main` 대상 Pull Request와 `main` Push에서 네 검증을 하나의 `CI` job으로
실행한다. 워크플로우는 경로에 따라 job을 생략하지 않는다.

## Release

현재 첫 Release 버전은 `0.0.1`이다. `v0.0.1` tag를 원격 `main` 이력의 해당 버전
커밋에 Push하면 Release workflow가 다음 순서로 실행된다.

1. Tag 형식, `package.json` 버전과 원격 `main` 포함 여부 확인
2. 린트, 타입 검사, 단위 테스트와 빌드
3. 정적 빌드와 제3자 라이선스 고지 압축
4. 배포 압축 파일의 SHA-256 체크섬 생성
5. 두 release asset이 첨부된 Draft Release 생성
6. Release 게시

| Release asset | 내용 |
| --- | --- |
| `scrap-monitoring-dashboard-v0.0.1.tar.gz` | 정적 빌드와 제3자 라이선스 고지 |
| `scrap-monitoring-dashboard-v0.0.1.tar.gz.sha256` | 배포 압축 파일의 SHA-256 체크섬 |

GitHub가 자동으로 제공하는 Source code 압축 파일은 소스 스냅샷이며 배포용 release
asset과 구분한다.

## 직접 의존성

### 애플리케이션과 검증 도구

| 의존성 | 버전 | 사용 목적 | 출처 | 라이선스 |
| --- | --- | --- | --- | --- |
| `react` | 19.2.8 | UI 구성 | [npm](https://www.npmjs.com/package/react) | MIT |
| `react-dom` | 19.2.8 | 브라우저 렌더링 | [npm](https://www.npmjs.com/package/react-dom) | MIT |
| `typescript` | 6.0.3 | 타입 검사와 TSX 작성 | [npm](https://www.npmjs.com/package/typescript) | Apache-2.0 |
| `vite` | 8.2.2 | 개발 서버와 빌드 | [npm](https://www.npmjs.com/package/vite) | MIT |
| `vitest` | 4.1.11 | 단위 테스트 | [npm](https://www.npmjs.com/package/vitest) | MIT |
| `eslint` | 10.9.0 | 정적 검사 실행 | [npm](https://www.npmjs.com/package/eslint) | MIT |
| `@eslint/js` | 10.0.1 | JavaScript 기본 검사 규칙 | [npm](https://www.npmjs.com/package/@eslint/js) | MIT |
| `typescript-eslint` | 8.67.0 | TypeScript 정적 검사 | [npm](https://www.npmjs.com/package/typescript-eslint) | MIT |
| `@types/react` | 19.2.18 | React 타입 정의 | [npm](https://www.npmjs.com/package/@types/react) | MIT |
| `@types/react-dom` | 19.2.4 | React DOM 타입 정의 | [npm](https://www.npmjs.com/package/@types/react-dom) | MIT |

### GitHub Actions

| 의존성 | 버전 | 사용 목적 | 출처 | 라이선스 |
| --- | --- | --- | --- | --- |
| `actions/checkout` | v7 | Repository 체크아웃 | [GitHub](https://github.com/actions/checkout) | MIT |
| `actions/setup-node` | v7 | Node.js 설정과 npm 캐시 | [GitHub](https://github.com/actions/setup-node) | MIT |
