const validPages = new Set(["monitoring", "history", "recordings", "admin", "login"]);
const requestedPage = new URLSearchParams(window.location.search).get("page");
const activePage = validPages.has(requestedPage) ? requestedPage : "monitoring";
const app = document.querySelector("#app");

document.querySelectorAll(".mockup-page").forEach((page) => {
  page.hidden = page.dataset.page !== activePage;
});

document.querySelectorAll("[data-page-link]").forEach((link) => {
  link.classList.toggle("active", link.dataset.pageLink === activePage);
});

if (activePage === "login") {
  app.classList.add("login-shell");
  document.querySelector(".global-nav").hidden = true;
  document.querySelector(".user-tools").hidden = true;
}
