// Backend가 계정, 이벤트, 문맥별 기존 export 조회를 제공하면 서버 값을 우선하고 이 fallback을 제거한다.

export type StoredExport = {
  requestId: string;
  statusPath: string;
  savedAt: number;
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const memoryCache = new Map<string, StoredExport>();
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidExport(eventId: string, entry: { requestId?: unknown; statusPath?: unknown }): entry is { requestId: string; statusPath: string } {
  if (typeof entry.requestId !== "string" || !UUID_REGEX.test(entry.requestId)) return false;
  const expectedStatusPath = `/api/v2/recordings/events/${encodeURIComponent(eventId)}/exports/${entry.requestId}`;
  return entry.statusPath === expectedStatusPath;
}

function storageKey(userId: string, eventId: string, beforeSeconds = 30, afterSeconds = 30): string {
  return `scrap-dashboard:event-export:v1:${userId}:${eventId}:${beforeSeconds}:${afterSeconds}`;
}

export function getStoredExport(
  userId: string,
  eventId: string,
  beforeSeconds = 30,
  afterSeconds = 30,
  now = Date.now(),
): StoredExport | null {
  if (!userId || !eventId) return null;
  const key = storageKey(userId, eventId, beforeSeconds, afterSeconds);

  let stored: StoredExport | null = memoryCache.get(key) ?? null;

  try {
    const raw = typeof window !== "undefined" && window.localStorage ? window.localStorage.getItem(key) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredExport>;
      if (typeof parsed.requestId === "string" && typeof parsed.statusPath === "string" && typeof parsed.savedAt === "number") {
        stored = { requestId: parsed.requestId, statusPath: parsed.statusPath, savedAt: parsed.savedAt };
      } else {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // localStorage 접근 실패 시 메모리 캐시만 사용한다.
  }

  if (stored) {
    if (!isValidExport(eventId, stored)) {
      clearStoredExport(userId, eventId, beforeSeconds, afterSeconds);
      return null;
    }
    if (now - stored.savedAt > SEVEN_DAYS_MS) {
      clearStoredExport(userId, eventId, beforeSeconds, afterSeconds);
      return null;
    }
    memoryCache.set(key, stored);
    return stored;
  }

  return null;
}

export function saveStoredExport(
  userId: string,
  eventId: string,
  entry: { requestId: string; statusPath: string },
  beforeSeconds = 30,
  afterSeconds = 30,
  now = Date.now(),
): void {
  if (!userId || !eventId) return;
  const key = storageKey(userId, eventId, beforeSeconds, afterSeconds);
  const stored: StoredExport = {
    requestId: entry.requestId,
    statusPath: entry.statusPath,
    savedAt: now,
  };
  memoryCache.set(key, stored);

  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(key, JSON.stringify(stored));
    }
  } catch {
    // localStorage 쓰기 실패 시 메모리 캐시만 유지한다.
  }
}

export function clearStoredExport(
  userId: string,
  eventId: string,
  beforeSeconds = 30,
  afterSeconds = 30,
): void {
  if (!userId || !eventId) return;
  const key = storageKey(userId, eventId, beforeSeconds, afterSeconds);
  memoryCache.delete(key);

  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // 무시
  }
}

export function clearAllMemoryExports(): void {
  memoryCache.clear();
}
