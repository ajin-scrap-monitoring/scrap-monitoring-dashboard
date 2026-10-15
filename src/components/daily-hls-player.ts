let loading: Promise<typeof import("hls.js/light")> | undefined;

export function loadDailyHls() {
  loading ??= import("hls.js/light").catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}
