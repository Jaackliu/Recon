"""Resolve per-user data paths from FINANCE_DATA_DIR env var.

When FINANCE_DATA_DIR is set (by api_server.py for multi-user mode),
all paths point to that user's data directory. Otherwise falls back
to the project-root /data directory (single-user legacy mode).
"""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _get_data_dir() -> Path:
    env = os.environ.get("FINANCE_DATA_DIR")
    if env:
        return Path(env)
    return ROOT / "data"


DATA_DIR = _get_data_dir()
DB_DIR = DATA_DIR / "database"
LOG_DIR = DATA_DIR / "logs"
CONFIG_DIR = DATA_DIR / "config"
RAW_INPUT_DIR = DATA_DIR / "raw_input"
UI_DIR = DATA_DIR / "ui"
