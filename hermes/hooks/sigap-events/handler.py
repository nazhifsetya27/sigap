"""Hook gateway Hermes untuk portal Sigap.

Yang dikirim hanya jenis kejadian, id sesi, dan nama platform. Isi pesan pelanggan
tidak pernah dikirim lewat hook ini; portal membacanya sendiri dari penyimpanan sesi.
Pengiriman berjalan di thread terpisah dan semua galat ditelan, sehingga portal yang
mati tidak pernah memperlambat atau menggagalkan balasan ke pelanggan.
"""

import json
import threading
import urllib.request
from pathlib import Path

_CONFIG = Path(__file__).with_name("sigap.json")


def _load():
    try:
        data = json.loads(_CONFIG.read_text(encoding="utf-8"))
        return str(data["url"]).rstrip("/"), str(data["token"])
    except Exception:
        return None


def _post(url, token, payload):
    try:
        req = urllib.request.Request(
            f"{url}/api/ingest/hermes-event",
            data=json.dumps(payload).encode("utf-8"),
            headers={"content-type": "application/json", "x-sigap-token": token},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=2).close()
    except Exception:
        pass


def handle(event_type, context):
    config = _load()
    if config is None:
        return
    payload = {
        "event": event_type,
        "session_id": str(context.get("session_id") or ""),
        "platform": str(context.get("platform") or ""),
    }
    threading.Thread(target=_post, args=(config[0], config[1], payload), daemon=True).start()
