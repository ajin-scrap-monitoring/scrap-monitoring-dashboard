export function getExecutionStatus(isReady: boolean): string {
  return isReady
    ? "애플리케이션이 정상적으로 실행되었습니다."
    : "애플리케이션을 준비하고 있습니다.";
}
