import type { DashboardData } from "../domain/dashboard";

import { MjpegVideo } from "./MjpegVideo";
import { WhepVideo } from "./WhepVideo";

export function LiveVideo({ alt, fallbackImage, monitoring }: { alt: string; fallbackImage: string; monitoring: DashboardData["monitoring"] }) {
  if (monitoring.videoMode === "mjpeg") return <MjpegVideo alt={alt} url={monitoring.videoUrl ?? `/media/cameras/${encodeURIComponent(monitoring.videoStreamId)}/live`} />;
  return <WhepVideo alt={alt} fallbackImage={fallbackImage} mode={monitoring.videoMode} status={monitoring.videoStatus} streamId={monitoring.videoStreamId} />;
}
