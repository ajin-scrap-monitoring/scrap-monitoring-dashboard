import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

if (typeof globalThis.EventSource === "undefined") {
  class MockEventSource {
    url: string;
    withCredentials?: boolean;
    constructor(url: string, eventSourceInitDict?: EventSourceInit) {
      this.url = url;
      this.withCredentials = eventSourceInitDict?.withCredentials;
    }
    addEventListener() {}
    removeEventListener() {}
    close() {}
  }
  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
}

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});
