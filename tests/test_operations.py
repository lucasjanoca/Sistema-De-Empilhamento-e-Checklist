from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta, datetime, timezone
import time
import sqlalchemy as sa
from app import schema as t
from app.db import engine, now
from app.main import tick
from app.policy import operational_day


def record(pid):
    with engine().connect() as c:
        return c.execute(sa.select(t.pallet_requests).where(t.pallet_requests.c.id == pid)).mappings().one()


def prepare(a, pic=False):
    a.device()
    a.ok("/production/start")
    pid = a.pallet(pic)
    assert a.command(pid, "authorize-lower", reason="Conferência realizada").status_code == 200
    return pid


def due(pid):
    with engine().begin() as c:
        c.execute(
            t.pallet_movements.update()
            .where(t.pallet_movements.c.pallet_request_id == pid, t.pallet_movements.c.status == "PENDING")
            .values(confirm_at=now(c) - timedelta(seconds=1))
        )
    tick()


def test_requires_authorization_and_version(clients):
    a = clients()
    a.device()
    a.ok("/production/start")
    pid = a.pallet()
    assert a.command(pid, "lower").status_code == 403
    assert record(pid)["state"] == "WAITING"
    assert a.command(pid, "authorize-lower", reason="Conferido").status_code == 200
    assert a.send(f"/pallets/{pid}/lower", {"version": 1}).status_code == 409
    assert a.command(pid, "lower").status_code == 200


def test_concurrent_operator_race_one_winner(clients):
    a = clients()
    pid = prepare(a)
    b = clients("empilhador")
    b.device()
    b.ok("/production/start")
    version = record(pid)["version"]
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda x: x.send(f"/pallets/{pid}/lower", {"version": version}).status_code, [a, b]))
    assert sorted(results) == [200, 409]
    with engine().connect() as c:
        assert (
            c.scalar(
                sa.select(sa.func.count())
                .select_from(t.pallet_movements)
                .where(t.pallet_movements.c.pallet_request_id == pid, t.pallet_movements.c.status == "PENDING")
            )
            == 1
        )


def test_undo_and_confirm_exactly_once(clients):
    a = clients()
    pid = prepare(a)
    assert a.command(pid, "lower").status_code == 200
    assert a.command(pid, "undo").status_code == 200
    assert record(pid)["state"] == "LOWER_AUTHORIZED"
    assert a.command(pid, "lower").status_code == 200
    due(pid)
    tick()
    assert record(pid)["state"] == "FLOOR"
    assert a.command(pid, "undo").status_code == 409
    with engine().connect() as c:
        assert (
            c.scalar(
                sa.select(sa.func.count())
                .select_from(t.operational_history)
                .where(t.operational_history.c.pallet_id == pid, t.operational_history.c.action == "LOWER_CONFIRMED")
            )
            == 1
        )
        assert (
            c.scalar(
                sa.select(t.production_requests.c.down_count).where(
                    t.production_requests.c.user_id == a.uid, t.production_requests.c.status == "OPEN"
                )
            )
            == 1
        )


def test_90_minutes_pic_and_no_automatic_movement(clients):
    a = clients()
    pid = prepare(a)
    a.command(pid, "lower")
    due(pid)
    assert a.command(pid, "raise").status_code == 403
    with engine().begin() as c:
        c.execute(t.pallet_requests.update().where(t.pallet_requests.c.id == pid).values(lowered_at=now(c) - timedelta(minutes=91)))
    tick()
    assert record(pid)["state"] == "READY"
    tick()
    assert record(pid)["state"] == "READY"
    assert a.command(pid, "raise").status_code == 200
    due(pid)
    assert record(pid)["state"] == "COMPLETED"
    pic = a.pallet(True)
    a.command(pic, "authorize-lower", reason="EXP PIC conferido")
    a.command(pic, "lower")
    due(pic)
    assert record(pic)["state"] == "READY"


def test_device_exclusivity_and_type(clients):
    a = clients()
    did = a.device("COMPUTADOR")
    b = clients("empilhador")
    assert b.send("/devices/select", {"device_id": did}).status_code == 403
    did = a.device()
    assert b.send("/devices/select", {"device_id": did}).status_code == 409


def test_blocked_location_and_close_pending(clients):
    a = clients()
    pid = prepare(a)
    a.ok("/locations/block", {"address": record(pid)["address"], "reason": "Área em manutenção"})
    assert a.command(pid, "lower").status_code == 409
    a.ok("/locations/unlock", {"address": record(pid)["address"], "reason": "Área liberada"})
    assert a.command(pid, "lower").status_code == 200
    assert a.send("/production/close").status_code == 409
    due(pid)
    a.ok("/production/close")


def test_real_timer_and_lifespan_restart(clients):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.config import settings

    a = clients()
    pid = prepare(a)
    a.command(pid, "lower")
    assert record(pid)["state"] == "LOWERING"
    with TestClient(app, base_url=settings().public_origin):
        end = time.monotonic() + 14
        while time.monotonic() < end and record(pid)["state"] == "LOWERING":
            time.sleep(0.4)
    assert record(pid)["state"] == "FLOOR"


def test_operational_day_shift_overnight():
    assert tuple(map(str, operational_day(datetime(2026, 9, 25, 6, 0, tzinfo=timezone.utc)))) == ("2026-09-24", "T3")
    assert tuple(map(str, operational_day(datetime(2026, 9, 25, 8, 0, tzinfo=timezone.utc)))) == ("2026-09-25", "T1")
