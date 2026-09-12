export const ROUTES = {
  admin: "/admin",
  history: "/history",
  login: "/login",
  monitoring: "/",
  recordings: "/recordings",
} as const;

export const AUTHENTICATION_SESSION_KEY = "scrap-monitoring-authenticated";

export function hasAuthenticationSession() {
  return window.sessionStorage.getItem(AUTHENTICATION_SESSION_KEY) === "true";
}

export function setAuthenticated() {
  window.sessionStorage.setItem(AUTHENTICATION_SESSION_KEY, "true");
}

export function clearAuthentication() {
  window.sessionStorage.removeItem(AUTHENTICATION_SESSION_KEY);
}
