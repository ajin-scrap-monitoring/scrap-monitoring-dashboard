import type { DashboardData } from "../domain/dashboard";
import { mjpegPlaybackEnabled, whepPlaybackEnabled } from "../build-features";

import { MjpegVideo } from "./MjpegVideo";
import { WhepVideo } from "./WhepVideo";
import { VideoTimestamp } from "./VideoTimestamp";

export function LiveVideo({ alt, fallbackImage, monitoring }: { alt: string; fallbackImage: string; monitoring: DashboardData["monitoring"] }) {
  if (monitoring.videoMode === "sample") return <><img src={fallbackImage} alt={alt} /><VideoTimestamp capturedAt={monitoring.videoCapturedAt} /></>;
  if (mjpegPlaybackEnabled && monitoring.videoMode === "mjpeg") return <MjpegVideo alt={alt} url={monitoring.videoUrl ?? `/media/cameras/${encodeURIComponent(monitoring.videoStreamId)}/live`} capturedAt={monitoring.videoCapturedAt} />;
  if (whepPlaybackEnabled && monitoring.videoMode === "webrtc") return <><WhepVideo alt={alt} fallbackImage={fallbackImage} mode={monitoring.videoMode} status={monitoring.videoStatus} streamId={monitoring.videoStreamId} /><VideoTimestamp capturedAt={monitoring.videoCapturedAt} /></>;
  return <span className="video-connection-state" role="status">빌드에서 지원하지 않는 영상 모드</span>;
}
