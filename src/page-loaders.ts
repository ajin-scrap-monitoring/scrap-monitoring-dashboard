export const loadAdminPage = () => import("./pages/AdminPage");
export const loadHistoryPage = () => import("./pages/HistoryPage");
export const loadRecordingsPage = () => import("./pages/RecordingsPage");

export function preloadPageModule(pathname: string) {
  if (pathname === "/admin") {
    void loadAdminPage().catch(() => undefined);
  } else if (pathname === "/history") {
    void loadHistoryPage().catch(() => undefined);
  } else if (pathname === "/recordings") {
    void loadRecordingsPage().catch(() => undefined);
  }
}
