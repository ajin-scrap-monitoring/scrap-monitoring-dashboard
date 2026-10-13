interface ImportMetaEnv {
  readonly VITE_APP_VERSION?: string;
  readonly VITE_ENABLE_MOCK_DATA?: string;
  readonly VITE_MONITORING_API_VERSION?: "v1" | "v2";
  readonly VITE_LIVE_VIDEO_MODE?: "mjpeg" | "webrtc";
  readonly VITE_PIT_ID?: string;
  readonly VITE_CAMERA_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
