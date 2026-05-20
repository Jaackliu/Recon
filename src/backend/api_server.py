from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
from datetime import datetime
from pathlib import Path

from apscheduler.schedulers.background import BackgroundScheduler
from flask import Flask, jsonify, request, send_from_directory, abort
from flask_cors import CORS

ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIR = ROOT / "src" / "frontend"
BACKEND_DIR = ROOT / "src" / "backend"
USERS_PATH = ROOT / "users.json"
PYTHON = sys.executable

app = Flask(__name__)
CORS(app)


@app.route("/health")
def health():
    return jsonify({"status": "ok"})


# ---------------------------------------------------------------------------
# User registry
# ---------------------------------------------------------------------------


def load_users() -> list[dict]:
    if not USERS_PATH.exists():
        return []
    return json.loads(USERS_PATH.read_text(encoding="utf-8"))


def get_user(user_id: str) -> dict | None:
    for u in load_users():
        if u["id"] == user_id:
            return u
    return None


def user_data_dir(user_id: str) -> Path | None:
    user = get_user(user_id)
    if not user:
        return None
    return (ROOT / user["data_dir"]).resolve()


# ---------------------------------------------------------------------------
# Per-user message store
# ---------------------------------------------------------------------------
def _add_message(user_id: str, key: str, params: dict | None = None):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    msg = {"timestamp": ts, "key": key, "params": params or {}}
    data_dir = user_data_dir(user_id)
    if data_dir:
        notif_log = data_dir / "logs" / "notifications.jsonl"
        notif_log.parent.mkdir(parents=True, exist_ok=True)
        with notif_log.open("a", encoding="utf-8") as f:
            f.write(json.dumps(msg, ensure_ascii=False) + "\n")


def _extract_info(stdout: str) -> str:
    """Extract the last [INFO] line from subprocess stdout."""
    for line in reversed(stdout.strip().splitlines()):
        m = re.search(r"\[INFO\]\s*(.+)", line)
        if m:
            return m.group(1).strip()
    return stdout.strip()[-200:] if stdout.strip() else ""


def _run_script(script: str, user_id: str) -> tuple[bool, str]:
    """Run a backend script with FINANCE_DATA_DIR set for the user."""
    data_dir = user_data_dir(user_id)
    if not data_dir:
        return False, f"Unknown user: {user_id}"
    env = {**os.environ, "FINANCE_DATA_DIR": str(data_dir)}
    result = subprocess.run(
        [PYTHON, str(BACKEND_DIR / script)],
        cwd=str(BACKEND_DIR),
        capture_output=True,
        text=True,
        env=env,
    )
    if result.returncode != 0:
        err = result.stderr.strip()[-300:] if result.stderr else "unknown error"
        return False, err
    combined = (result.stdout or "") + (result.stderr or "")
    return True, _extract_info(combined)


# ---------------------------------------------------------------------------
# Background parse watcher with status tracking
# ---------------------------------------------------------------------------
_parse_status: dict[str, dict] = {}
_parse_lock = threading.Lock()


def _parse_watcher(user_id: str):
    """Run parser.py; on success, auto-run fetch_fx + processor."""
    ok = False
    try:
        ok, info = _run_script("parser.py", user_id)
        if ok:
            _add_message(user_id, "msg.parse_done", {"detail": info})
            # Auto-refresh: fetch FX rates and regenerate UI data
            _do_refresh(user_id, auto=False)
        else:
            _add_message(user_id, "msg.parse_error", {"error": info})
    except Exception as exc:
        _add_message(user_id, "msg.parse_error", {"error": str(exc)[:200]})
    finally:
        with _parse_lock:
            _parse_status[user_id] = {"running": False, "ok": ok}


# ---------------------------------------------------------------------------
# Refresh logic (shared by API endpoint and scheduler)
# ---------------------------------------------------------------------------

def _do_refresh(user_id: str, auto: bool = False):
    """Run fetch_fx.py + processor.py, record messages."""
    ok, info = _run_script("fetch_fx.py", user_id)
    if not ok:
        _add_message(user_id, "msg.fx_error", {"error": info})
        return False

    fx_detail = info

    ok, info = _run_script("processor.py", user_id)
    if not ok:
        _add_message(user_id, "msg.processor_error", {"error": info})
        return False

    if auto:
        _add_message(user_id, "msg.auto_refresh", {"fx_detail": fx_detail})
    else:
        _add_message(user_id, "msg.refresh_done", {"fx_detail": fx_detail})
    return True


# ---------------------------------------------------------------------------
# Per-user daily 4:00 AM scheduler (APScheduler)
# ---------------------------------------------------------------------------

def _start_scheduler():
    scheduler = BackgroundScheduler(timezone="Asia/Shanghai")
    for user in load_users():
        scheduler.add_job(
            _do_refresh,
            "cron",
            hour=4, minute=0,
            args=[user["id"], True],
            id=f"daily_refresh_{user['id']}",
            replace_existing=True,
            misfire_grace_time=3600,
        )
    scheduler.start()


# ---------------------------------------------------------------------------
# Static file serving
# ---------------------------------------------------------------------------

@app.route("/")
def landing_page():
    return send_from_directory(FRONTEND_DIR, "landing.html")


@app.route("/api/users", methods=["GET"])
def list_users():
    return jsonify(load_users())


@app.route("/<user_id>/")
def user_dashboard(user_id):
    if not get_user(user_id):
        abort(404)
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/<user_id>/app.js")
def serve_app_js(user_id):
    return send_from_directory(FRONTEND_DIR, "app.js")


@app.route("/<user_id>/styles.css")
def serve_styles(user_id):
    return send_from_directory(FRONTEND_DIR, "styles.css")


@app.route("/<user_id>/multi-lang.json")
def serve_multi_lang(user_id):
    return send_from_directory(FRONTEND_DIR, "multi-lang.json")


@app.route("/<user_id>/data/<path:subpath>")
def serve_user_data(user_id, subpath):
    data_dir = user_data_dir(user_id)
    if not data_dir:
        abort(404)
    return send_from_directory(str(data_dir), subpath)


# ---------------------------------------------------------------------------
# API endpoints (user-scoped)
# ---------------------------------------------------------------------------

@app.route("/<user_id>/api/upload", methods=["POST"])
def upload_files(user_id):
    if not get_user(user_id):
        abort(404)
    raw_input_dir = user_data_dir(user_id) / "raw_input"
    raw_input_dir.mkdir(parents=True, exist_ok=True)

    uploaded = request.files.getlist("files")
    if not uploaded:
        return jsonify({"error": "No files provided"}), 400

    saved = []
    for f in uploaded:
        if not f.filename:
            continue
        dest = raw_input_dir / Path(f.filename).name
        f.save(str(dest))
        saved.append(f.filename)

    if not saved:
        return jsonify({"error": "No valid files"}), 400

    _add_message(user_id, "msg.upload_success", {"count": len(saved), "files": ", ".join(saved)})
    return jsonify({"saved": saved})


@app.route("/<user_id>/api/parse", methods=["POST"])
def parse_pdfs(user_id):
    if not get_user(user_id):
        abort(404)
    with _parse_lock:
        if _parse_status.get(user_id, {}).get("running"):
            return jsonify({"status": "already_running"}), 409
        _parse_status[user_id] = {"running": True}
    _add_message(user_id, "msg.parse_started", {})
    t = threading.Thread(target=_parse_watcher, args=(user_id,), daemon=True)
    t.start()
    return jsonify({"status": "started"})


@app.route("/<user_id>/api/parse/status", methods=["GET"])
def parse_status(user_id):
    if not get_user(user_id):
        abort(404)
    with _parse_lock:
        status = _parse_status.get(user_id, {"running": False})
    return jsonify(status)


@app.route("/<user_id>/api/refresh", methods=["POST"])
def refresh_data(user_id):
    if not get_user(user_id):
        abort(404)
    ok = _do_refresh(user_id, auto=False)
    if ok:
        return jsonify({"status": "done"})
    return jsonify({"status": "error"}), 500


@app.route("/<user_id>/api/messages", methods=["GET"])
def get_messages(user_id):
    if not get_user(user_id):
        abort(404)
    data_dir = user_data_dir(user_id)
    if not data_dir:
        return jsonify([])
    notif_log = data_dir / "logs" / "notifications.jsonl"
    if not notif_log.exists():
        return jsonify([])
    msgs = []
    with notif_log.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    msgs.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    msgs.reverse()
    return jsonify(msgs)


@app.route("/<user_id>/api/setup", methods=["POST"])
def setup_user(user_id):
    """Initial setup: create config files for a new user."""
    if not get_user(user_id):
        abort(404)
    data_dir = user_data_dir(user_id)
    config_dir = data_dir / "config"
    config_dir.mkdir(parents=True, exist_ok=True)

    body = request.get_json(silent=True) or {}
    default_currency = body.get("default_currency", "01")
    account = body.get("account", {})

    # Build currency.json — copy from a known set or use what's provided
    currencies = body.get("currencies")
    if not currencies:
        currencies = [
            {"currency_code": "01", "currency_iso": "CNY", "alias": {"zh": "人民币", "en": "Chinese Yuan", "fr": "Yuan chinois"}, "currency_symbol": "￥"},
            {"currency_code": "02", "currency_iso": "HKD", "alias": {"zh": "港币", "en": "Hong Kong Dollar", "fr": "Dollar hongkongais"}, "currency_symbol": "HK$"},
            {"currency_code": "03", "currency_iso": "EUR", "alias": {"zh": "欧元", "en": "Euro", "fr": "Euro"}, "currency_symbol": "€"},
            {"currency_code": "04", "currency_iso": "USD", "alias": {"zh": "美元", "en": "US Dollar", "fr": "Dollar américain"}, "currency_symbol": "$"},
            {"currency_code": "05", "currency_iso": "JPY", "alias": {"zh": "日元", "en": "Japanese Yen", "fr": "Yen japonais"}, "currency_symbol": "¥"},
        ]
    with (config_dir / "currency.json").open("w", encoding="utf-8") as f:
        json.dump(currencies, f, indent=2, ensure_ascii=False)

    # Build accounts.json
    accounts = []
    if account.get("account_code"):
        alias = account.get("alias", {})
        if isinstance(alias, str):
            alias = {"zh": alias, "en": alias, "fr": alias}
        accounts.append({
            "account_code": account["account_code"],
            "alias": alias,
            "account_name": account.get("account_name", ""),
            "bank_name": account.get("bank_name", ""),
            "account_number": account.get("account_number", ""),
            "holder_name": account.get("holder_name", ""),
            "default_currency": account.get("default_currency", default_currency),
            "supported_currencies": account.get("supported_currencies", [default_currency]),
        })
    with (config_dir / "accounts.json").open("w", encoding="utf-8") as f:
        json.dump(accounts, f, indent=2, ensure_ascii=False)

    # Create empty database files
    db_dir = data_dir / "database"
    db_dir.mkdir(parents=True, exist_ok=True)
    for name in ("transactions.json", "parsed.json"):
        path = db_dir / name
        if not path.exists():
            with path.open("w", encoding="utf-8") as f:
                json.dump([], f)

    _add_message(user_id, "msg.setup_complete", {})
    return jsonify({"status": "ok"})


# ---------------------------------------------------------------------------
# Config management API (accounts & currencies)
# ---------------------------------------------------------------------------

@app.route("/<user_id>/api/config/accounts", methods=["GET"])
def get_accounts(user_id):
    if not get_user(user_id):
        abort(404)
    config_dir = user_data_dir(user_id) / "config"
    path = config_dir / "accounts.json"
    if not path.exists():
        return jsonify([])
    return jsonify(json.loads(path.read_text(encoding="utf-8")))


@app.route("/<user_id>/api/config/accounts", methods=["PUT"])
def put_accounts(user_id):
    if not get_user(user_id):
        abort(404)
    body = request.get_json(silent=True)
    if not isinstance(body, list):
        return jsonify({"error": "Expected a JSON array"}), 400
    config_dir = user_data_dir(user_id) / "config"
    config_dir.mkdir(parents=True, exist_ok=True)
    path = config_dir / "accounts.json"
    with path.open("w", encoding="utf-8") as f:
        json.dump(body, f, indent=2, ensure_ascii=False)
    _add_message(user_id, "msg.accounts_updated", {"count": len(body)})
    return jsonify({"status": "ok", "count": len(body)})


@app.route("/<user_id>/api/config/currencies", methods=["GET"])
def get_currencies(user_id):
    if not get_user(user_id):
        abort(404)
    config_dir = user_data_dir(user_id) / "config"
    path = config_dir / "currency.json"
    if not path.exists():
        return jsonify([])
    return jsonify(json.loads(path.read_text(encoding="utf-8")))


@app.route("/<user_id>/api/config/currencies", methods=["PUT"])
def put_currencies(user_id):
    if not get_user(user_id):
        abort(404)
    body = request.get_json(silent=True)
    if not isinstance(body, list):
        return jsonify({"error": "Expected a JSON array"}), 400
    config_dir = user_data_dir(user_id) / "config"
    config_dir.mkdir(parents=True, exist_ok=True)
    path = config_dir / "currency.json"
    with path.open("w", encoding="utf-8") as f:
        json.dump(body, f, indent=2, ensure_ascii=False)
    _add_message(user_id, "msg.currencies_updated", {"count": len(body)})
    return jsonify({"status": "ok", "count": len(body)})


if __name__ == "__main__":
    for user in load_users():
        d = ROOT / user["data_dir"]
        (d / "logs").mkdir(parents=True, exist_ok=True)
    _start_scheduler()
    app.run(host="0.0.0.0", port=8000, debug=False)


# ---------------------------------------------------------------------------
# Gunicorn hooks (used when running via gunicorn)
# ---------------------------------------------------------------------------

def on_starting(server):
    """Create per-user log directories before workers are forked."""
    for user in load_users():
        d = ROOT / user["data_dir"]
        (d / "logs").mkdir(parents=True, exist_ok=True)


def post_fork(server, worker):
    """Start per-user daily scheduler in each worker process."""
    _start_scheduler()
