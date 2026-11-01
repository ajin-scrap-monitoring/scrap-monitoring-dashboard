import { useSyncExternalStore } from "react";

export type AppLocation = {
  pathname: string;
  search: string;
  hasNavigated: boolean;
};

export type NavigationType = "push" | "replace" | "popstate";

const CLIENT_PATHNAMES = new Set(["/", "/history", "/recordings", "/admin"]);

if (typeof window !== "undefined" && "scrollRestoration" in window.history) {
  window.history.scrollRestoration = "manual";
}

let currentNavigationType: NavigationType = "push";
let hasNavigated = false;

type ScrollPosition = { x: number; y: number };
const ENTRY_KEY_FIELD = "entryKey";
const entryScrolls = new Map<string, ScrollPosition>();
let entryKeySequence = 0;
let activeEntryKey = "";

function createEntryKey(): string {
  entryKeySequence += 1;
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${entryKeySequence}`;
  return `entry-${random}`;
}

function readHistoryState(): Record<string, unknown> {
  const state = window.history.state as Record<string, unknown> | null;
  return state !== null && typeof state === "object" ? state : {};
}

// 현재 history entry의 key를 반환하며 key가 없으면 replaceState로 부여한다.
function ensureEntryKey(): string {
  const state = readHistoryState();
  const existing = state[ENTRY_KEY_FIELD];
  if (typeof existing === "string" && existing !== "") return existing;
  const key = createEntryKey();
  window.history.replaceState({ ...state, [ENTRY_KEY_FIELD]: key }, "");
  return key;
}

function rememberScrollOfActiveEntry() {
  if (activeEntryKey === "") return;
  entryScrolls.set(activeEntryKey, { x: window.scrollX, y: window.scrollY });
}

// 현재 history entry에서 마지막으로 떠나기 직전에 기억한 scroll 위치를 반환한다.
export function getRememberedScroll(): ScrollPosition {
  if (typeof window === "undefined") return { x: 0, y: 0 };
  return entryScrolls.get(ensureEntryKey()) ?? { x: 0, y: 0 };
}

if (typeof window !== "undefined") {
  activeEntryKey = ensureEntryKey();
}

export function getNavigationType(): NavigationType {
  return currentNavigationType;
}

export function isClientRoute(to: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const url = new URL(to, window.location.href);
    if (url.origin !== window.location.origin) return false;
    return CLIENT_PATHNAMES.has(url.pathname);
  } catch {
    return false;
  }
}

type RouterSubscriber = () => void;
const subscribers = new Set<RouterSubscriber>();

function notifySubscribers() {
  subscribers.forEach((subscriber) => subscriber());
}

let cachedLocation: AppLocation = {
  pathname: typeof window !== "undefined" ? window.location.pathname : "/",
  search: typeof window !== "undefined" ? window.location.search : "",
  hasNavigated: false,
};

function getSnapshot(): AppLocation {
  if (typeof window === "undefined") return cachedLocation;
  const { pathname, search } = window.location;
  if (
    cachedLocation.pathname !== pathname ||
    cachedLocation.search !== search ||
    cachedLocation.hasNavigated !== hasNavigated
  ) {
    cachedLocation = { pathname, search, hasNavigated };
  }
  return cachedLocation;
}

function getServerSnapshot(): AppLocation {
  return cachedLocation;
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    // 이전 화면이 아직 DOM에 있는 동안 떠나는 entry의 scroll을 기억한다.
    rememberScrollOfActiveEntry();
    activeEntryKey = ensureEntryKey();
    hasNavigated = true;
    currentNavigationType = "popstate";
    getSnapshot();
    notifySubscribers();
  });
}

function subscribe(callback: RouterSubscriber) {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

export function useAppLocation(): AppLocation {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export type NavigateOptions = {
  replace?: boolean;
};

export function navigate(to: string, options: NavigateOptions = {}) {
  if (typeof window === "undefined") return;

  if (!isClientRoute(to)) {
    window.location.assign(to);
    return;
  }

  const url = new URL(to, window.location.href);
  const targetPathname = url.pathname;
  const targetSearch = url.search;
  const currentPathname = window.location.pathname;
  const currentSearch = window.location.search;

  if (currentPathname === targetPathname && currentSearch === targetSearch) {
    return;
  }

  hasNavigated = true;
  const nextUrl = `${targetPathname}${targetSearch}${url.hash}`;
  activeEntryKey = ensureEntryKey();
  const currentState = readHistoryState();

  if (options.replace) {
    currentNavigationType = "replace";
    window.history.replaceState(
      { ...currentState, navigationType: "replace" },
      "",
      nextUrl,
    );
  } else {
    currentNavigationType = "push";
    rememberScrollOfActiveEntry();
    activeEntryKey = createEntryKey();
    window.history.pushState(
      { navigationType: "push", [ENTRY_KEY_FIELD]: activeEntryKey },
      "",
      nextUrl,
    );
  }

  getSnapshot();
  notifySubscribers();
}

export function resetNavigationForTesting() {
  entryScrolls.clear();
  if (typeof window !== "undefined") activeEntryKey = ensureEntryKey();
  hasNavigated = false;
  currentNavigationType = "push";
  cachedLocation = {
    pathname: typeof window !== "undefined" ? window.location.pathname : "/",
    search: typeof window !== "undefined" ? window.location.search : "",
    hasNavigated: false,
  };
}
