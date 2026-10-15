export const runtimeFeatureSelection = import.meta.env.DEV || import.meta.env.VITE_ENABLE_MOCK_DATA === "true";
export const configuredMonitoringVersion = import.meta.env.VITE_MONITORING_API_VERSION ?? "v2";
export const configuredLiveVideoMode = import.meta.env.VITE_LIVE_VIDEO_MODE ?? "mjpeg";

export const v1MonitoringEnabled = runtimeFeatureSelection || configuredMonitoringVersion === "v1";
export const v2MonitoringEnabled = runtimeFeatureSelection || configuredMonitoringVersion === "v2";
export const mjpegPlaybackEnabled = runtimeFeatureSelection || configuredLiveVideoMode === "mjpeg";
export const whepPlaybackEnabled = runtimeFeatureSelection || configuredLiveVideoMode === "webrtc";
