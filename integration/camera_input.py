import asyncio
import os
import subprocess
from pathlib import Path

from aiohttp import ClientSession, CookieJar
from websockets.asyncio.client import connect


async def main():
    jpeg = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
         "color=c=blue:s=320x240", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"],
        check=True, capture_output=True,
    ).stdout
    async with connect(
        "ws://media:8443/api/v1/cameras/camera-main/stream",
        additional_headers={"Authorization": "Bearer " + os.environ["SYNC_CAMERA_TOKEN"]},
    ) as stream, ClientSession(cookie_jar=CookieJar(unsafe=True)) as api:
        async def frames():
            while True:
                await stream.send(jpeg)
                await asyncio.sleep(0.1)

        feed = asyncio.create_task(frames())
        try:
            response = await api.post("http://backend:8000/api/v1/session", json={
                "username": "admin", "password": os.environ["SYNC_ADMIN_PASSWORD"], "persistent": False,
            })
            response.raise_for_status()
            session = await response.json()
            headers = {"X-CSRF-Token": session["csrfToken"]}
            response = await api.put("http://backend:8000/api/v2/recordings/daily/policy",
                json={"enabled": True, "retention_days": 1}, headers=headers)
            response.raise_for_status()
            response = await api.put("http://backend:8000/api/v1/media/cameras/camera-main/recording-policy",
                json={"pre_roll_seconds": 5, "post_roll_seconds": 1, "retention_days": 1}, headers=headers)
            response.raise_for_status()
            await asyncio.sleep(0.3)
            response = await api.post("http://backend:8000/api/v1/collections/confirm", json={
                "pit_id": "pit-01", "residual_height_cm": 0, "operator_name": "Synthetic integration", "notes": "Synthetic camera input",
            }, headers=headers)
            response.raise_for_status()
            for _ in range(120):
                response = await api.get("http://backend:8000/api/v1/recordings?pit_id=pit-01")
                response.raise_for_status()
                items = (await response.json())["items"]
                if items and items[0]["mediaStatus"] == "ready":
                    if items[0]["coverage"] != "partial":
                        raise RuntimeError("Expected partial synthetic recording")
                    response = await api.get("http://backend:8000/api/v2/recordings/daily")
                    response.raise_for_status()
                    daily = (await response.json())["items"]
                    if not any(item["playback_state"] == "ready" and item["recorded_seconds"] > 0 for item in daily):
                        await asyncio.sleep(0.5)
                        continue
                    Path("/tmp/input-ready").touch()
                    print("Synthetic MJPEG, partial event MP4 and daily HLS ready.", flush=True)
                    await feed
                    return
                await asyncio.sleep(0.5)
            raise RuntimeError("Event MP4 and daily HLS did not become ready")
        finally:
            feed.cancel()


asyncio.run(main())
