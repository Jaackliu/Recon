from __future__ import annotations

import json
import re
import subprocess
import sys
import threading
from datetime import datetime, timedelta
from pathlib import Path

from flask import Flask, jsonify, request
from flask_cors import CORS

ROOT = Path(__file__).resolve().parents[2]
RAW_INPUT_DIR = ROOT / "data" / "raw_input"
BACKEND_DIR = ROOT / "src" / "backend"
LOG_DIR = ROOT / "data" / "logs"
NOTIF_LOG = LOG_DIR / "notifications.jsonl"
PYTHON = sys.executable

app = Flask(__name__)
CORS(app)

# ---------------------------------------------------------------------------
# Message store
# ---------------------------------------------------------------------------
_messages: list[dict] = []
_lock = threading.Lock()


def _add_message(key: str, params: dict | None = None):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    msg = {"timestamp": ts, "key": key, "params": params or {}}
    with _lock:
        _messages.insert(0, msg)
    NOTIF_LOG.parent.mkdir(parents=True, exist_ok=True)
    with NOTIF_LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(msg, ensure_ascii=False) + "\n")


def _extract_info(stdout: str) -> str:
    """Extract the last [INFO] line from subprocess stdout."""
    for line in reversed(stdout.strip().splitlines()):
        m = re.search(r"\[INFO\]\s*(.+)", line)
        if m:
            return m.group(1).strip()
    return stdout.strip()[-200:] if stdout.strip() else ""


def _run_script(script: str) -> tuple[bool, str]:
    """Run a backend script, return (success, info_text)."""
    result = subprocess.run(
        [PYTHON, str(BACKEND_DIR / script)],
        cwd=str(BACKEND_DIR),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        err = result.stderr.strip()[-300:] if result.stderr else "unknown error"
        return False, err
    combined = (result.stdout or "") + (result.stderr or "")
    return True, _extract_info(combined)


# ---------------------------------------------------------------------------
# Background parse watcher
# ---------------------------------------------------------------------------

def _parse_watcher():
    """Run parser.py and report results via messages."""
    ok, info = _run_script("parser.py")
    if ok:
        _add_message("msg.parse_done", {"detail": info})
    else:
        _add_message("msg.parse_error", {"error": info})


# ---------------------------------------------------------------------------
# Refresh logic (shared by API endpoint and scheduler)
# ---------------------------------------------------------------------------

def _do_refresh(auto: bool = False):
    """Run fetch_fx.py + processor.py, record messages."""
    ok, info = _run_script("fetch_fx.py")
    if ok:
        _add_message("msg.fx_done", {"detail": info})
    else:
        _add_message("msg.fx_error", {"error": info})
        return False

    ok, info = _run_script("processor.py")
    if ok:
        _add_message("msg.processor_done", {})
    else:
        _add_message("msg.processor_error", {"error": info})
        return False

    key = "msg.auto_refresh" if auto else "msg.refresh_done"
    _add_message(key, {})
    return True


# ---------------------------------------------------------------------------
# Daily 4:00 AM scheduler
# ---------------------------------------------------------------------------

def _schedule_next():
    now = datetime.now()
    target = now.replace(hour=4, minute=0, second=0, microsecond=0)
    if now >= target:
        target += timedelta(days=1)
    delay = (target - now).total_seconds()
    timer = threading.Timer(delay, _on_daily_tick)
    timer.daemon = True
    timer.start()


def _on_daily_tick():
    _do_refresh(auto=True)
    _schedule_next()


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------

@app.route("/api/upload", methods=["POST"])
def upload_files():
    uploaded = request.files.getlist("files")
    if not uploaded:
        return jsonify({"error": "No files provided"}), 400

    saved = []
    for f in uploaded:
        if not f.filename:
            continue
        dest = RAW_INPUT_DIR / Path(f.filename).name
        f.save(str(dest))
        saved.append(f.filename)

    if not saved:
        return jsonify({"error": "No valid files"}), 400

    _add_message("msg.upload_success", {"count": len(saved), "files": ", ".join(saved)})
    return jsonify({"saved": saved})


@app.route("/api/parse", methods=["POST"])
def parse_pdfs():
    _add_message("msg.parse_started", {})
    t = threading.Thread(target=_parse_watcher, daemon=True)
    t.start()
    return jsonify({"status": "started"})


@app.route("/api/refresh", methods=["POST"])
def refresh_data():
    ok = _do_refresh(auto=False)
    if ok:
        return jsonify({"status": "done"})
    return jsonify({"status": "error"}), 500


@app.route("/api/messages", methods=["GET"])
def get_messages():
    with _lock:
        return jsonify(list(_messages))


if __name__ == "__main__":
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    _schedule_next()
    app.run(host="127.0.0.1", port=5001, debug=False)
