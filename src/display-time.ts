// 화면에 표시하는 모든 시각은 브라우저 시간대와 서버 응답 offset에 관계없이 한국 표준시(Asia/Seoul, DST 없음)이다.
export const displayTimeOffset = "+09:00";
const displayOffsetMilliseconds = 9 * 3_600_000;

// timestamp(epoch ms)를 한국 표준시 "YYYY-MM-DDTHH:mm:ss"로 만든다.
export function seoulDateTime(timestamp: number) {
  return new Date(timestamp + displayOffsetMilliseconds).toISOString().slice(0, 19);
}

// "HH:mm:ss" 또는 seconds=false이면 "HH:mm".
export function seoulClock(timestamp: number, seconds = true) {
  return seoulDateTime(timestamp).slice(11, seconds ? 19 : 16);
}

export function seoulDisplayText(timestamp: number) {
  return `${seoulDateTime(timestamp).replace("T", " ")} (한국 표준시)`;
}
