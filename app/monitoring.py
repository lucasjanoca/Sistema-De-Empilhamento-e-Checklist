"""Métricas locais por processo; nenhuma telemetria ou exportador externo."""

from collections import Counter
from threading import Lock
import time

_lock = Lock()
_statuses = Counter()
_duration = 0.0
_started = time.monotonic()


def record(status, seconds):
    global _duration
    with _lock:
        _statuses[str(status)] += 1
        _duration += seconds


def snapshot():
    with _lock:
        count = sum(_statuses.values())
        return dict(
            uptime_seconds=round(time.monotonic() - _started),
            requests_by_status=dict(_statuses),
            request_count=count,
            mean_response_ms=round(_duration * 1000 / count, 2) if count else 0,
            scope="process",
        )
