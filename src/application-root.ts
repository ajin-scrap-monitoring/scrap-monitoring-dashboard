import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

export function createApplicationRoot(container: HTMLElement) {
  let root: Root | undefined;
  let application: ReactNode;
  let ready = false;
  let active = true;
  let disposed = false;

  const render = (nextApplication: ReactNode) => {
    if (disposed) return;
    application = nextApplication;
    ready = true;
    if (!active) return;
    root ??= createRoot(container);
    root.render(application);
  };
  const onPageHide = () => {
    active = false;
    const previousRoot = root;
    root = undefined;
    // Browser page caching does not unmount React or run its effect cleanup.
    previousRoot?.unmount();
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted || active || disposed) return;
    active = true;
    if (ready) render(application);
  };
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);

  return {
    render,
    dispose() {
      disposed = true;
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      onPageHide();
    },
  };
}
