export type LazyPageRoute = "admin" | "history" | "recordings";

type PageModules = {
  admin: typeof import("./pages/AdminPage");
  history: typeof import("./pages/HistoryPage");
  recordings: typeof import("./pages/RecordingsPage");
};

const loadedModules: Partial<PageModules> = {};

function track<Route extends LazyPageRoute>(route: Route, load: () => Promise<PageModules[Route]>) {
  return () => load().then((module) => {
    loadedModules[route] = module;
    return module;
  });
}

export const loadAdminPage = track("admin", () => import("./pages/AdminPage"));
export const loadHistoryPage = track("history", () => import("./pages/HistoryPage"));
export const loadRecordingsPage = track("recordings", () => import("./pages/RecordingsPage"));

const loaders: { [Route in LazyPageRoute]: () => Promise<PageModules[Route]> } = {
  admin: loadAdminPage,
  history: loadHistoryPage,
  recordings: loadRecordingsPage,
};

export type { PageModules };

export function isLazyPageRoute(route: string): route is LazyPageRoute {
  return route === "admin" || route === "history" || route === "recordings";
}

export function getLoadedPageModule<Route extends LazyPageRoute>(route: Route): PageModules[Route] | undefined {
  return loadedModules[route];
}

export function loadPageModule<Route extends LazyPageRoute>(route: Route): Promise<PageModules[Route]> {
  return loaders[route]();
}

export function preloadPageModule(pathname: string) {
  const route = pathname.replace(/^\//, "");
  if (isLazyPageRoute(route)) void loadPageModule(route).catch(() => undefined);
}
