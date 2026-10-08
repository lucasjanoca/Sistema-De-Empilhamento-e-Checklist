"""Inventaria um snapshot legado do Supabase sem publicar dados pessoais.

O comando e deliberadamente somente leitura: ele valida o formato, produz um
relatorio agregado e, opcionalmente, um modelo privado de mapeamento. A carga no
banco novo so pode ser liberada depois que negocio e TI resolverem os bloqueios.
"""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any


MAX_INPUT_BYTES = 50 * 1024 * 1024
ARRAYS = (
    "auditLog",
    "history",
    "notifications",
    "productionRequests",
    "registeredDevices",
    "requests",
    "selectedCorridors",
    "tabletAssignments",
)
SCALARS = {"nextId": (int, float), "nextNotificationId": (int, float), "nextProductionRequestId": (int, float), "version": str}
OBJECTS = ("meta", "settings")
FINAL_REQUEST_STATES = {"completed", "cancelled"}
PROFILE_ROLES = {"empilhador", "encarregado", "ti"}


def read_json(path: Path) -> Any:
    if not path.is_file():
        raise ValueError(f"Arquivo nao encontrado: {path}")
    if path.stat().st_size > MAX_INPUT_BYTES:
        raise ValueError("Arquivo maior que 50 MiB; exporte somente as tabelas emp_* necessarias.")
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"JSON invalido: {error}") from error


def unwrap_snapshot(document: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    if isinstance(document, list):
        if len(document) != 1:
            raise ValueError("O arquivo do estado deve conter exatamente uma linha.")
        document = document[0]
    if not isinstance(document, dict):
        raise ValueError("O JSON do estado deve ser um objeto.")
    wrapper = document
    snapshot = document.get("snapshot", document)
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get("data"), dict):
        raise ValueError("Formato inesperado: esperado snapshot.data como objeto.")
    return snapshot, wrapper


def unwrap_profiles(document: Any) -> list[dict[str, Any]]:
    if isinstance(document, dict):
        document = document.get("profiles", document.get("data", document.get("result")))
    if not isinstance(document, list) or any(not isinstance(item, dict) for item in document):
        raise ValueError("O arquivo de perfis deve conter uma lista de objetos.")
    return document


def distribution(items: Any, field: str) -> dict[str, int]:
    if not isinstance(items, list):
        return {}
    values = Counter()
    for item in items:
        value = item.get(field) if isinstance(item, dict) else None
        label = value.strip().lower() if isinstance(value, str) and value.strip() else "<ausente>"
        values[label[:80]] += 1
    return dict(sorted(values.items()))


def missing_fields(items: Any, fields: tuple[str, ...]) -> dict[str, int]:
    result = Counter()
    if not isinstance(items, list):
        return {field: 0 for field in fields}
    for item in items:
        if not isinstance(item, dict):
            for field in fields:
                result[field] += 1
            continue
        for field in fields:
            if field not in item or item[field] in (None, ""):
                result[field] += 1
    return {field: result[field] for field in fields}


def analyze(document: Any, profiles: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    snapshot, wrapper = unwrap_snapshot(document)
    data = snapshot["data"]
    errors: list[str] = []
    blockers: list[str] = []

    for key in ARRAYS:
        if key not in data:
            errors.append(f"Campo ausente: data.{key}")
        elif not isinstance(data[key], list):
            errors.append(f"Tipo invalido: data.{key} deve ser lista")
    for key in OBJECTS:
        if key not in data:
            errors.append(f"Campo ausente: data.{key}")
        elif not isinstance(data[key], dict):
            errors.append(f"Tipo invalido: data.{key} deve ser objeto")
    for key, expected in SCALARS.items():
        if key not in data:
            errors.append(f"Campo ausente: data.{key}")
        elif isinstance(data[key], bool) or not isinstance(data[key], expected):
            errors.append(f"Tipo invalido: data.{key}")

    requests = data.get("requests", [])
    productions = data.get("productionRequests", [])
    devices = data.get("registeredDevices", [])
    assignments = data.get("tabletAssignments", [])
    required_request_fields = ("quantity", "reference", "note", "area")
    missing_request_data = missing_fields(requests, required_request_fields)
    active_requests = sum(
        1
        for item in requests
        if isinstance(item, dict) and str(item.get("status", "")).strip().lower() not in FINAL_REQUEST_STATES
    )
    open_productions = sum(
        1 for item in productions if isinstance(item, dict) and str(item.get("status", "")).strip().lower() not in {"closed", "encerrada"}
    )
    active_assignments = sum(1 for item in assignments if isinstance(item, dict) and item.get("active") is not False and not item.get("endedAt"))

    if errors:
        blockers.append("Corrigir o formato do export antes de qualquer transformacao.")
    if profiles is None:
        blockers.append("Exportar emp_profiles separadamente para mapear identidade e papeis sem inferir usuarios pelo historico.")
        profile_summary = {"provided": False, "count": 0, "invalidRoles": 0, "inactive": 0}
    else:
        invalid_roles = sum(1 for item in profiles if str(item.get("role", "")).strip().lower() not in PROFILE_ROLES)
        inactive = sum(1 for item in profiles if item.get("active") is False)
        profile_summary = {"provided": True, "count": len(profiles), "invalidRoles": invalid_roles, "inactive": inactive}
        if invalid_roles:
            blockers.append(f"Revisar {invalid_roles} perfil(is) com papel sem equivalencia na matriz nova.")
    missing_total = sum(missing_request_data.values())
    if missing_total:
        blockers.append(
            "Preencher e aprovar quantidade, referencia, observacao e area dos paletes legados; esses campos nao existem no snapshot antigo."
        )
    if active_requests:
        blockers.append(f"Decidir o estado de corte de {active_requests} palete(s) nao finalizado(s) antes da importacao.")
    if open_productions:
        blockers.append(f"Encerrar ou reconciliar {open_productions} requisicao(oes) de producao aberta(s).")
    if active_assignments:
        blockers.append(f"Encerrar {active_assignments} atribuicao(oes) de tablet; sessoes antigas nao devem ser migradas.")

    inventory = {key: len(data[key]) if isinstance(data.get(key), list) else None for key in ARRAYS}
    source_updated = wrapper.get("updated_at", wrapper.get("updatedAt"))
    return {
        "reportVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "containsPersonalData": False,
        "source": {
            "snapshotVersion": str(data.get("version", ""))[:40],
            "revision": wrapper.get("revision"),
            "updatedAtPresent": source_updated is not None,
        },
        "inventory": inventory,
        "profiles": profile_summary,
        "reconciliation": {
            "requestStatuses": distribution(requests, "status"),
            "productionStatuses": distribution(productions, "status"),
            "deviceTypes": distribution(devices, "type"),
            "activeRequests": active_requests,
            "openProductions": open_productions,
            "activeTabletAssignments": active_assignments,
            "missingRequiredRequestFields": missing_request_data,
        },
        "formatErrors": errors,
        "blockers": blockers,
        "importReady": not errors and not blockers,
        "nextStep": (
            "Importacao pode ser ensaiada somente em staging vazio."
            if not blockers and not errors
            else "Resolva os bloqueios, gere novo relatorio e obtenha aceite de Negocio e TI."
        ),
    }


def mapping_template(document: Any) -> dict[str, Any]:
    snapshot, _ = unwrap_snapshot(document)
    data = snapshot["data"]
    requests = data.get("requests", []) if isinstance(data.get("requests"), list) else []
    devices = data.get("registeredDevices", []) if isinstance(data.get("registeredDevices"), list) else []
    return {
        "templateVersion": 1,
        "privateFile": True,
        "warning": "Preencher fora do Git; nao inclua senhas, tokens ou chaves.",
        "palletRequests": [
            {
                "sourceId": item.get("id"),
                "quantity": None,
                "reference": None,
                "volumes": None,
                "note": "Importado do sistema legado apos reconciliacao",
                "area": None,
                "targetState": None,
                "externalRef": None,
            }
            for item in requests
            if isinstance(item, dict)
        ],
        "devices": [
            {"sourceId": item.get("id"), "targetType": "TABLET", "approved": False}
            for item in devices
            if isinstance(item, dict)
        ],
        "approvals": {"businessOwner": None, "itOwner": None, "approvedAt": None},
    }


def write_private_json(path: Path, value: Any) -> None:
    path = path.resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        raise ValueError(f"Destino ja existe; nao sobrescrito: {path}")
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass


def main() -> None:
    parser = argparse.ArgumentParser(description="Planeja a migracao do snapshot legado Supabase sem escrever no banco")
    parser.add_argument("--snapshot", type=Path, required=True, help="Export JSON de emp_operational_state.snapshot")
    parser.add_argument("--profiles", type=Path, help="Export JSON separado de emp_profiles")
    parser.add_argument("--report", type=Path, help="Grava relatorio agregado sem dados pessoais")
    parser.add_argument("--mapping-template", type=Path, help="Grava modelo privado que pode conter IDs operacionais")
    parser.add_argument("--require-ready", action="store_true", help="Retorna codigo 2 enquanto houver bloqueios")
    args = parser.parse_args()
    try:
        snapshot = read_json(args.snapshot)
        profiles = unwrap_profiles(read_json(args.profiles)) if args.profiles else None
        report = analyze(snapshot, profiles)
        if args.report:
            write_private_json(args.report, report)
        if args.mapping_template:
            write_private_json(args.mapping_template, mapping_template(snapshot))
    except ValueError as error:
        raise SystemExit(str(error)) from error
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if args.require_ready and not report["importReady"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
