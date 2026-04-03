#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

PYTHON_BIN="${PYTHON_BIN:-${PROJECT_ROOT}/venv/bin/python}"
HOST="${SUBTITLE_HOST:-0.0.0.0}"
PORT="${SUBTITLE_PORT:-8091}"

exec "${PYTHON_BIN}" -m uvicorn \
    app.main:create_default_app \
    --factory \
    --host "${HOST}" \
    --port "${PORT}" \
    --app-dir "${PROJECT_ROOT}"
