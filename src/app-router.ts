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
  const currentState = (window.history.state as Record<string, unknown> | null) ?? {};

  if (options.replace) {
    currentNavigationType = "replace";
    window.history.replaceState(
      { ...currentState, navigationType: "replace" },
      "",
      nextUrl,
    );
  } else {
    currentNavigationType = "push";
    window.history.replaceState(
      {
        ...currentState,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      },
      "",
    );
    window.history.pushState(
      { navigationType: "push" },
      "",
      nextUrl,
    );
  }

  getSnapshot();
  notifySubscribers();
}

export function resetNavigationForTesting() {
  hasNavigated = false;
  currentNavigationType = "push";
  cachedLocation = {
    pathname: typeof window !== "undefined" ? window.location.pathname : "/",
    search: typeof window !== "undefined" ? window.location.search : "",
    hasNavigated: false,
  };
}
