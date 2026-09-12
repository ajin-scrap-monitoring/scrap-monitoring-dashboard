import type { paths } from "../generated/api-contract";

export type WhepSession = {
  close: () => void;
};

export class WhepResponseError extends Error {
  readonly retryAfterMilliseconds?: number;

  constructor(status: number, retryAfterMilliseconds?: number) {
    super(`WHEP session creation failed with ${status}`);
    this.name = "WhepResponseError";
    this.retryAfterMilliseconds = retryAfterMilliseconds;
  }
}

export const WHEP_RECONNECT_DELAYS = [1000, 2000, 3000] as const;
const WHEP_CREATION_PATH = "/api/v1/webrtc/streams/{streamId}" as const satisfies keyof paths;

function retryAfterMilliseconds(value: string | null) {
  if (value === null) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

function candidateFragment(description: RTCSessionDescription | null, candidates: readonly RTCIceCandidate[], endOfCandidates: boolean) {
  const sdp = description?.sdp ?? "";
  const ufrag = sdp.match(/^a=ice-ufrag:(.+)$/m)?.[1]?.trim();
  const password = sdp.match(/^a=ice-pwd:(.+)$/m)?.[1]?.trim();
  const mediaLine = sdp.match(/^m=(.+)$/m)?.[1]?.trim();
  const mid = candidates[0]?.sdpMid ?? sdp.match(/^a=mid:(.+)$/m)?.[1]?.trim();
  if (!ufrag || !password || !mediaLine || mid === null || mid === undefined) return null;
  const candidateLines = candidates
    .filter((candidate) => candidate.sdpMid === mid)
    .map((candidate) => `a=${candidate.candidate}`);
  if (candidateLines.length === 0 && !endOfCandidates) return null;
  return [
    "a=ice-options:trickle",
    `a=group:BUNDLE ${mid}`,
    `m=${mediaLine}`,
    `a=mid:${mid}`,
    `a=ice-ufrag:${ufrag}`,
    `a=ice-pwd:${password}`,
    ...candidateLines,
    ...(endOfCandidates ? ["a=end-of-candidates"] : []),
    "",
  ].join("\r\n");
}

function waitForIceGatheringComplete(peerConnection: RTCPeerConnection, signal?: AbortSignal) {
  if (peerConnection.iceGatheringState === "complete") return Promise.resolve();
  if (signal?.aborted) return Promise.reject(new DOMException("WHEP connection was cancelled", "AbortError"));
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      peerConnection.removeEventListener("icegatheringstatechange", handleStateChange);
      signal?.removeEventListener("abort", handleAbort);
    };
    const handleStateChange = () => {
      if (peerConnection.iceGatheringState !== "complete") return;
      cleanup();
      resolve();
    };
    const handleAbort = () => {
      cleanup();
      reject(new DOMException("WHEP connection was cancelled", "AbortError"));
    };
    peerConnection.addEventListener("icegatheringstatechange", handleStateChange);
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

export async function createWhepPlayback({
  fetchImplementation = window.fetch.bind(window),
  onConnected,
  onConnectionFailure,
  peerConnection = new RTCPeerConnection({ bundlePolicy: "max-bundle" }),
  signal,
  streamId,
  video,
}: {
  fetchImplementation?: typeof fetch;
  onConnected?: () => void;
  onConnectionFailure: () => void;
  peerConnection?: RTCPeerConnection;
  signal?: AbortSignal;
  streamId: string;
  video: HTMLVideoElement;
}): Promise<WhepSession> {
  let closed = false;
  let sessionPath = "";
  let entityTag = "";
  let candidateDeliveryEnabled = false;
  let iceGatheringComplete = false;
  let patchQueue = Promise.resolve();
  const bufferedCandidates: RTCIceCandidate[] = [];

  const close = () => {
    if (closed) return;
    closed = true;
    signal?.removeEventListener("abort", close);
    window.removeEventListener("pagehide", close);
    peerConnection.close();
    video.srcObject = null;
    if (sessionPath) {
      void fetchImplementation(sessionPath, { credentials: "include", keepalive: true, method: "DELETE" });
    }
  };

  const sendCandidates = (candidates: readonly RTCIceCandidate[], endOfCandidates = false) => {
    const body = candidateFragment(peerConnection.localDescription, candidates, endOfCandidates);
    if (!body || !sessionPath || !entityTag || !candidateDeliveryEnabled || closed) return;
    patchQueue = patchQueue.then(async () => {
      const response = await fetchImplementation(sessionPath, {
        body,
        credentials: "include",
        headers: {
          "Content-Type": "application/trickle-ice-sdpfrag",
          "If-Match": entityTag,
        },
        method: "PATCH",
        signal,
      });
      if (!response.ok) throw new Error(`WHEP ICE update failed with ${response.status}`);
    }).catch(onConnectionFailure);
  };

  signal?.addEventListener("abort", close, { once: true });
  window.addEventListener("pagehide", close, { once: true });
  if (signal?.aborted) {
    close();
    throw new DOMException("WHEP connection was cancelled", "AbortError");
  }

  peerConnection.addTransceiver("video", { direction: "recvonly" });
  peerConnection.ontrack = (event) => {
    const [stream] = event.streams;
    if (stream) video.srcObject = stream;
    onConnected?.();
  };
  peerConnection.onconnectionstatechange = () => {
    if (peerConnection.connectionState === "connected") onConnected?.();
    else if (peerConnection.connectionState === "failed" || peerConnection.connectionState === "disconnected") onConnectionFailure();
  };
  peerConnection.onicecandidate = (event) => {
    if (!event.candidate) {
      iceGatheringComplete = true;
      if (candidateDeliveryEnabled) sendCandidates([], true);
      return;
    }
    if (!candidateDeliveryEnabled) bufferedCandidates.push(event.candidate);
    else sendCandidates([event.candidate]);
  };

  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    const creationPath = WHEP_CREATION_PATH.replace("{streamId}", encodeURIComponent(streamId));
    const response = await fetchImplementation(creationPath, {
      body: peerConnection.localDescription?.sdp ?? offer.sdp,
      credentials: "include",
      headers: { Accept: "application/sdp", "Content-Type": "application/sdp" },
      method: "POST",
      signal,
    });
    if (response.status !== 201 && response.status !== 406) {
      throw new WhepResponseError(response.status, retryAfterMilliseconds(response.headers.get("Retry-After")));
    }
    if (response.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/sdp") {
      throw new Error("WHEP session response did not use application/sdp");
    }
    const location = response.headers.get("Location") ?? "";
    if (!location) throw new Error("WHEP session response omitted Location");
    const sessionUrl = new URL(location, new URL(creationPath, window.location.href));
    if (sessionUrl.origin !== window.location.origin) throw new Error("WHEP session response used a cross-origin Location");
    sessionPath = `${sessionUrl.pathname}${sessionUrl.search}`;
    const responseSdp = await response.text();
    entityTag = response.headers.get("ETag") ?? "";
    if (response.status === 201) {
      if (!entityTag) throw new Error("WHEP session response omitted ETag");
      if (!/^"[^"\r\n]+"$/.test(entityTag)) throw new Error("WHEP session response used an invalid strong ETag");
      if (!/^a=ice-options:.*\btrickle\b/im.test(responseSdp)) {
        throw new Error("WHEP session did not negotiate Trickle ICE");
      }
      await peerConnection.setRemoteDescription({ sdp: responseSdp, type: "answer" });
      candidateDeliveryEnabled = true;
      sendCandidates(bufferedCandidates.splice(0), iceGatheringComplete);
    } else {
      await peerConnection.setLocalDescription({ type: "rollback" });
      await peerConnection.setRemoteDescription({ sdp: responseSdp, type: "offer" });
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      await waitForIceGatheringComplete(peerConnection, signal);
      const answerResponse = await fetchImplementation(sessionPath, {
        body: peerConnection.localDescription?.sdp ?? answer.sdp,
        credentials: "include",
        headers: { "Content-Type": "application/sdp" },
        method: "PATCH",
        signal,
      });
      if (answerResponse.status !== 204) throw new Error(`WHEP counter-offer answer failed with ${answerResponse.status}`);
      bufferedCandidates.splice(0);
    }
  } catch (error) {
    close();
    throw error;
  }

  return { close };
}
