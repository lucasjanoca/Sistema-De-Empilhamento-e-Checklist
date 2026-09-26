from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor
import sqlalchemy as sa
from app.db import engine
from app import schema as t


def setup(a, typ="bateria"):
    a.device()
    with engine().connect() as c:
        prior = (
            c.scalar(
                sa.select(sa.func.max(t.checklist_template_versions.c.version))
                .select_from(t.checklist_template_versions.join(t.checklist_templates))
                .where(t.checklist_templates.c.type == typ)
            )
            or 0
        )
    template = a.ok(
        "/checklist/templates", {"type": typ, "name": "Modelo de teste", "questions": ["Condição verificada?"], "expected_version": prior}
    )["id"]
    eid = a.ok("/equipment", {"code": "test-" + uuid4().hex, "name": "Equipamento de teste", "type": typ})["id"]
    return {
        "equipment_id": eid,
        "equipment_version": 1,
        "template_version_id": template,
        "answers": ["warn"],
        "observation": "Requer tratamento",
        "water": "Abastecer" if typ == "bateria" else None,
        "liters": 0 if typ == "bateria" else None,
    }


def test_checklist_history_immutable_and_issue_not_auto_resolved(clients):
    a = clients()
    body = setup(a)
    a.ok("/checklist/records", body)
    a.ok("/checklist/records", {**body, "equipment_version": 2, "answers": ["ok"], "water": "Cheio"})
    with engine().connect() as c:
        assert (
            c.scalar(
                sa.select(sa.func.count())
                .select_from(t.checklist_records)
                .where(t.checklist_records.c.equipment_id == body["equipment_id"])
            )
            == 2
        )
        issue = c.execute(sa.select(t.issues).where(t.issues.c.equipment_id == body["equipment_id"])).mappings().one()
        assert issue["status"] == "OPEN"
    a.ok("/issues/" + str(issue["id"]), {"version": 1, "status": "RESOLVED", "reason": "Reparo conferido"}, "PATCH")
    assert a.send("/issues/" + str(issue["id"]), {"version": 1, "status": "RESOLVED", "reason": "Repetido"}, "PATCH").status_code == 409


def test_same_equipment_concurrent_checklist(clients):
    a = clients()
    body = setup(a)
    b = clients("empilhador")
    b.device()
    with ThreadPoolExecutor(2) as pool:
        result = list(pool.map(lambda x: x.send("/checklist/records", body).status_code, [a, b]))
    assert sorted(result) == [200, 409]


def test_template_mismatch_and_forged_status_rejected(clients):
    a = clients()
    body = setup(a, "tablet")
    assert a.send("/checklist/records", {**body, "status": "ok"}).status_code == 422
    assert a.send("/checklist/records", {**body, "answers": []}).status_code == 422


def test_battery_unique_link_and_meter_monotonic(clients):
    a = clients()
    a.device()

    def eq(kind):
        return a.ok("/equipment", {"code": "test-" + uuid4().hex, "name": "Equipamento de teste", "type": kind})["id"]

    bat1, bat2, emp1, emp2 = eq("bateria"), eq("bateria"), eq("empilhadeira"), eq("empilhadeira")
    swap = {"installed_id": bat1, "forklift_id": emp1, "out_meter": 10, "in_meter": 10}
    a.ok("/battery-swaps", swap)
    assert a.send("/battery-swaps", {**swap, "forklift_id": emp2}).status_code == 409
    assert a.send("/battery-swaps", {**swap, "removed_id": bat1, "installed_id": bat2, "out_meter": 9}).status_code == 409
    a.ok("/battery-swaps", {**swap, "removed_id": bat1, "installed_id": bat2, "out_meter": 11, "in_meter": 12})


def test_exports_real_csv_pdf_and_formula_escape(clients):
    from app.extras import safe_cell

    assert safe_cell("=1+1").startswith("'")
    a = clients()
    for kind in ["history", "production", "checklist", "audit"]:
        response = a.get("/reports/" + kind + ".csv")
        assert response.status_code == 200
    response = a.get("/reports/history.pdf")
    assert response.status_code == 200 and response.content.startswith(b"%PDF-")
