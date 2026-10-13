import os
import time
from uuid import uuid4

import httpx
from ajin_edge.v2.contracts import validate_message
from ajin_edge.v2.orchestration import Orchestrator
from ajin_edge.v2.processing import utc_now

config = {
    "schema_version": "2.0", "message_type": "edge_configuration", "message_id": str(uuid4()),
    "site_id": "site-demo", "edge_id": "edge-demo", "generated_at": utc_now(), "config_revision": "synthetic-config-1",
    "coordinate_frame": {
        "frame_id": "synthetic-frame", "unit": "mm", "origin_description": "Synthetic origin",
        "x_axis_description": "Synthetic X", "y_axis_description": "Synthetic Y", "z_axis_description": "Synthetic Z",
        "handedness": "RIGHT_HANDED",
    },
    "sensors": [{"sensor_id": sensor, "angle_intervals_mdeg": [{"start_inclusive": 0, "end_exclusive": 360000}], "calibration": None}
                for sensor in ("lidar-a", "lidar-b")],
}
orchestrator = Orchestrator(config)
stats = {"pending_messages": 0, "pending_bytes": 0, "quarantined_messages": 0, "last_backend_ack_at": None,
         "limit_bytes": 4096, "used_bytes": 0, "lost_messages": 0, "loss_from": None, "loss_to": None,
         "last_loss_reason": None, "unavailable_evidence_scan_ids": []}
messages = [("configurations", config), ("status", orchestrator.status(stats, [], now_ns=time.monotonic_ns())),
            ("assessments", orchestrator.assessment())]
with httpx.Client(base_url="http://backend:8000", timeout=10) as api:
    for endpoint, message in messages:
        validate_message(message)
        response = api.post("/api/edge/v2/" + endpoint, json=message, headers={
            "Authorization": "Bearer " + os.environ["SYNC_EDGE_TOKEN"], "Idempotency-Key": message["message_id"],
        })
        response.raise_for_status()
        assert response.json()["accepted"] is True
print("Edge v2 configuration, status and unavailable assessment accepted.")
