"""Verificação somente leitura do contrato Selene fornecido pela TI."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.config import settings  # noqa: E402
from app.integration import require_adapter  # noqa: E402


def item_count(value):
    if isinstance(value, list):
        return len(value)
    if isinstance(value, dict):
        for key in ("items", "data", "results", "rows"):
            if isinstance(value.get(key), list):
                return len(value[key])
        return len(value)
    return 0


def main():
    parser = argparse.ArgumentParser(description="Valida health e leituras do contrato Selene sem escrever dados")
    parser.add_argument("--config", required=True, type=Path, help="JSON aprovado pela TI, sem credenciais")
    parser.add_argument("--allow-production", action="store_true", help="Autoriza consulta somente leitura em produção")
    args = parser.parse_args()
    runtime = settings()
    if runtime.environment == "production" and not args.allow_production:
        raise SystemExit("Use staging; produção exige --allow-production explícito.")
    config = json.loads(args.config.read_text(encoding="utf-8"))
    adapter = require_adapter(config)
    health = adapter.health()
    pallets = adapter.fetch_pallets()
    output = {
        "ok": True,
        "environment": runtime.environment,
        "healthResponseType": type(health).__name__,
        "pendingResponseType": type(pallets["pending"]).__name__,
        "attendanceResponseType": type(pallets["attendance"]).__name__,
        "pendingItemCount": item_count(pallets["pending"]),
        "attendanceItemCount": item_count(pallets["attendance"]),
    }
    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    main()
