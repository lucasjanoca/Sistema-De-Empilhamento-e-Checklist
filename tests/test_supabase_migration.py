import json

import pytest

from scripts.plan_supabase_migration import analyze, mapping_template, read_json, write_private_json


def legacy_snapshot():
    return {
        "revision": 1,
        "snapshot": {
            "data": {
                "auditLog": [{}],
                "history": [{}],
                "meta": {},
                "nextId": 4,
                "nextNotificationId": 2,
                "nextProductionRequestId": 2,
                "notifications": [],
                "productionRequests": [{"id": 1, "status": "closed"}],
                "registeredDevices": [{"id": "tablet-1", "type": "tablet"}],
                "requests": [{"id": 3, "status": "ready"}],
                "selectedCorridors": ["A"],
                "settings": {},
                "tabletAssignments": [{"id": 1, "active": False, "endedAt": "2026-01-01"}],
                "version": "legacy-1",
            }
        },
    }


def test_analyzer_is_aggregated_and_blocks_unsafe_assumptions():
    report = analyze(legacy_snapshot(), [{"role": "empilhador", "active": True, "nome": "NAO VAZAR"}])

    assert report["containsPersonalData"] is False
    assert report["inventory"]["requests"] == 1
    assert report["profiles"] == {"provided": True, "count": 1, "invalidRoles": 0, "inactive": 0}
    assert report["reconciliation"]["activeRequests"] == 1
    assert report["reconciliation"]["missingRequiredRequestFields"] == {
        "quantity": 1,
        "reference": 1,
        "note": 1,
        "area": 1,
    }
    assert report["importReady"] is False
    assert "NAO VAZAR" not in json.dumps(report)


def test_analyzer_detects_bad_shape_and_missing_profiles():
    source = legacy_snapshot()
    source["snapshot"]["data"]["history"] = {}
    report = analyze(source)

    assert "Tipo invalido: data.history deve ser lista" in report["formatErrors"]
    assert report["profiles"]["provided"] is False
    assert report["importReady"] is False


def test_private_outputs_refuse_overwrite(tmp_path):
    source = tmp_path / "snapshot.json"
    source.write_text(json.dumps(legacy_snapshot()), encoding="utf-8")
    loaded = read_json(source)
    template = mapping_template(loaded)
    destination = tmp_path / "mapping.json"

    write_private_json(destination, template)
    assert json.loads(destination.read_text(encoding="utf-8"))["palletRequests"][0]["sourceId"] == 3
    with pytest.raises(ValueError, match="nao sobrescrito"):
        write_private_json(destination, template)
