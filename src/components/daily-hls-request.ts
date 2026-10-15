const playlistPath = /^\/media\/daily-recordings\/([a-zA-Z0-9-]+)\/hls\/index\.m3u8$/;
const segmentPath = /^\/media\/daily-recordings\/([a-zA-Z0-9-]+)\/media\/[a-zA-Z0-9-]+\.ts$/;

export function validDailyPlaylistPath(path: string): boolean {
  return playlistPath.test(path);
}

export function dailyHlsRequest(path: string, requestedUrl: string, init: RequestInit, origin: string): Request {
  const recordingId = playlistPath.exec(path)?.[1];
  const url = new URL(requestedUrl, origin);
  const segmentId = segmentPath.exec(url.pathname)?.[1];
  if (!recordingId || url.origin !== origin || url.username || url.password || url.search || url.hash
    || (url.pathname !== path && segmentId !== recordingId)) {
    throw new Error("Unexpected daily recording media path.");
  }
  return new Request(url, { ...init, credentials: "same-origin", redirect: "error" });
}
