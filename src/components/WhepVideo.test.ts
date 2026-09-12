import { expect, test, vi } from "vitest";

import { createWhepPlayback } from "./whep-client";

function fakePeerConnection() {
  const candidates = [
    { candidate: "candidate:1 1 UDP 1 192.0.2.1 5000 typ host", sdpMid: "0" },
    { candidate: "candidate:2 1 TCP 1 192.0.2.1 5001 typ host", sdpMid: "0" },
  ] as RTCIceCandidate[];
  const close = vi.fn();
  const setLocalDescription = vi.fn(function (this: { localDescription: RTCSessionDescription | null; onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null }, description: RTCSessionDescriptionInit) {
    this.localDescription = description.type === "rollback" ? null : description as RTCSessionDescription;
    if (description.type !== "rollback") {
      candidates.forEach((candidate) => this.onicecandidate?.({ candidate } as RTCPeerConnectionIceEvent));
      this.onicecandidate?.({ candidate: null } as RTCPeerConnectionIceEvent);
    }
    return Promise.resolve();
  });
  const peer = {
    addTransceiver: vi.fn(),
    close,
    connectionState: "new",
    createAnswer: vi.fn(() => Promise.resolve({ sdp: "v=0\r\na=answer\r\n", type: "answer" as const })),
    createOffer: vi.fn(() => Promise.resolve({ sdp: "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:0\r\na=ice-ufrag:user\r\na=ice-pwd:password\r\n", type: "offer" as const })),
    iceGatheringState: "complete",
    localDescription: null as RTCSessionDescription | null,
    onconnectionstatechange: null as (() => void) | null,
    onicecandidate: null as ((event: RTCPeerConnectionIceEvent) => void) | null,
    ontrack: null as ((event: RTCTrackEvent) => void) | null,
    setLocalDescription,
    setRemoteDescription: vi.fn(() => Promise.resolve()),
  };
  return { close, peer: peer as unknown as RTCPeerConnection, setLocalDescription };
}

test("WHEP offer, trickle ICE와 session 종료 요청을 수행한다", async () => {
  const fetchImplementation = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      return Promise.resolve(new Response("v=0\r\na=ice-options:trickle\r\na=answer\r\n", {
        headers: {
          "Content-Type": "application/sdp",
          ETag: '"session-v1"',
          Location: "../sessions/session-1",
        },
        status: 201,
      }));
    }
    if (init?.method === "PATCH") return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(new Response(null, { status: 200 }));
  });
  const video = document.createElement("video");

  const session = await createWhepPlayback({
    fetchImplementation,
    onConnectionFailure: vi.fn(),
    peerConnection: fakePeerConnection().peer,
    streamId: "camera-main",
    video,
  });
  await vi.waitFor(() => expect(fetchImplementation).toHaveBeenCalledTimes(2));

  expect(fetchImplementation.mock.calls[0][0]).toBe("/api/v1/webrtc/streams/camera-main");
  expect(fetchImplementation.mock.calls[0][1]).toMatchObject({ method: "POST" });
  expect(new Headers(fetchImplementation.mock.calls[1][1]?.headers).get("If-Match")).toBe('"session-v1"');
  expect(fetchImplementation.mock.calls[1][1]?.body).toContain("a=ice-options:trickle");
  expect(fetchImplementation.mock.calls[1][1]?.body).toContain("a=group:BUNDLE 0");
  expect(fetchImplementation.mock.calls[1][1]?.body).toContain("a=candidate:1");
  expect(fetchImplementation.mock.calls[1][1]?.body).toContain("a=candidate:2");
  expect(fetchImplementation.mock.calls[1][1]?.body).toContain("a=end-of-candidates");
  window.dispatchEvent(new Event("pagehide"));
  expect(fetchImplementation.mock.calls[2][0]).toBe("/api/v1/webrtc/sessions/session-1");
  expect(fetchImplementation.mock.calls[2][1]).toMatchObject({ method: "DELETE" });
  session.close();
  expect(fetchImplementation).toHaveBeenCalledTimes(3);
});

test("WHEP 406 counter-offer에 SDP answer PATCH로 응답한다", async () => {
  const peerConnection = fakePeerConnection();
  const fetchImplementation = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      return Promise.resolve(new Response("v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:0\r\n", {
        headers: { "Content-Type": "application/sdp", Location: "/api/v1/webrtc/sessions/session-2" },
        status: 406,
      }));
    }
    return Promise.resolve(new Response(null, { status: init?.method === "DELETE" ? 200 : 204 }));
  });

  const session = await createWhepPlayback({
    fetchImplementation,
    onConnectionFailure: vi.fn(),
    peerConnection: peerConnection.peer,
    streamId: "camera-main",
    video: document.createElement("video"),
  });

  expect(peerConnection.setLocalDescription).toHaveBeenCalledWith({ type: "rollback" });
  const answerRequest = fetchImplementation.mock.calls.find(([, init]) => init?.method === "PATCH");
  expect(new Headers(answerRequest?.[1]?.headers).get("Content-Type")).toBe("application/sdp");
  expect(new Headers(answerRequest?.[1]?.headers).has("If-Match")).toBe(false);
  expect(fetchImplementation.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
  session.close();
});

test("WHEP session Location이 다른 origin이면 연결을 중단한다", async () => {
  const peerConnection = fakePeerConnection();
  const fetchImplementation = vi.fn(() => Promise.resolve(new Response("v=0\r\na=answer\r\n", {
    headers: { "Content-Type": "application/sdp", ETag: '"session-v1"', Location: "https://media.example/whep/session-1" },
    status: 201,
  })));

  await expect(createWhepPlayback({
    fetchImplementation,
    onConnectionFailure: vi.fn(),
    peerConnection: peerConnection.peer,
    streamId: "camera-main",
    video: document.createElement("video"),
  })).rejects.toThrow("cross-origin Location");

  expect(peerConnection.close).toHaveBeenCalledOnce();
});

test("WHEP 성공 응답의 SDP media type, ETag와 trickle ICE 협상을 검증한다", async () => {
  const invalidMediaTypeFetch = vi.fn(() => Promise.resolve(new Response("v=0\r\na=answer\r\n", {
    headers: { Location: "/api/v1/webrtc/sessions/session-1" },
    status: 201,
  })));

  await expect(createWhepPlayback({
    fetchImplementation: invalidMediaTypeFetch,
    onConnectionFailure: vi.fn(),
    peerConnection: fakePeerConnection().peer,
    streamId: "camera-main",
    video: document.createElement("video"),
  })).rejects.toThrow("application/sdp");

  const missingEntityTagFetch = vi.fn(() => Promise.resolve(new Response("v=0\r\na=ice-options:trickle\r\na=answer\r\n", {
    headers: { "Content-Type": "application/sdp", Location: "/api/v1/webrtc/sessions/session-1" },
    status: 201,
  })));
  await expect(createWhepPlayback({
    fetchImplementation: missingEntityTagFetch,
    onConnectionFailure: vi.fn(),
    peerConnection: fakePeerConnection().peer,
    streamId: "camera-main",
    video: document.createElement("video"),
  })).rejects.toThrow("ETag");

  const invalidEntityTagFetch = vi.fn(() => Promise.resolve(new Response("v=0\r\na=ice-options:trickle\r\na=answer\r\n", {
    headers: { "Content-Type": "application/sdp", ETag: "session-v1", Location: "/api/v1/webrtc/sessions/session-1" },
    status: 201,
  })));
  await expect(createWhepPlayback({
    fetchImplementation: invalidEntityTagFetch,
    onConnectionFailure: vi.fn(),
    peerConnection: fakePeerConnection().peer,
    streamId: "camera-main",
    video: document.createElement("video"),
  })).rejects.toThrow("invalid strong ETag");

  const noTrickleFetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    void input;
    void init;
    return Promise.resolve(new Response("v=0\r\na=answer\r\n", {
      headers: { "Content-Type": "application/sdp", ETag: '"session-v1"', Location: "/api/v1/webrtc/sessions/session-1" },
      status: 201,
    }));
  });
  await expect(createWhepPlayback({
    fetchImplementation: noTrickleFetch,
    onConnectionFailure: vi.fn(),
    peerConnection: fakePeerConnection().peer,
    streamId: "camera-main",
    video: document.createElement("video"),
  })).rejects.toThrow("Trickle ICE");
  expect(noTrickleFetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  expect(noTrickleFetch.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
});

test("취소된 WHEP 연결은 peer connection을 닫고 요청을 시작하지 않는다", async () => {
  const controller = new AbortController();
  const peerConnection = fakePeerConnection();
  const fetchImplementation = vi.fn();
  controller.abort();

  await expect(createWhepPlayback({
    fetchImplementation,
    onConnectionFailure: vi.fn(),
    peerConnection: peerConnection.peer,
    signal: controller.signal,
    streamId: "camera-main",
    video: document.createElement("video"),
  })).rejects.toMatchObject({ name: "AbortError" });

  expect(peerConnection.close).toHaveBeenCalledOnce();
  expect(fetchImplementation).not.toHaveBeenCalled();
});

test("WHEP 연결 오류의 Retry-After 값을 재연결 지연으로 제공한다", async () => {
  const request = createWhepPlayback({
    fetchImplementation: vi.fn(() => Promise.resolve(new Response(null, {
      headers: { "Retry-After": "2" },
      status: 409,
    }))),
    onConnectionFailure: vi.fn(),
    peerConnection: fakePeerConnection().peer,
    streamId: "camera-main",
    video: document.createElement("video"),
  });

  await expect(request).rejects.toEqual(expect.objectContaining({
    name: "WhepResponseError",
    retryAfterMilliseconds: 2000,
  }));
});
