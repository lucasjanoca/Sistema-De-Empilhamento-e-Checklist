"""Smoke test seguro contra uma implantação já publicada."""

from __future__ import annotations

import argparse
import json
from urllib.parse import urljoin, urlsplit

import httpx


def main():
    parser = argparse.ArgumentParser(description="Smoke test do Site Selene implantado")
    parser.add_argument("--origin", required=True, help="Origem oficial, sem caminho")
    parser.add_argument("--allow-http-loopback", action="store_true")
    args = parser.parse_args()
    origin = args.origin.rstrip("/") + "/"
    parsed = urlsplit(origin)
    loopback = parsed.hostname in {"127.0.0.1", "localhost"}
    if parsed.scheme != "https" and not (args.allow_http_loopback and loopback):
        raise SystemExit("HTTPS é obrigatório fora de loopback.")

    checks = []
    with httpx.Client(timeout=10, follow_redirects=False) as client:
        for path, expected in (("health/live", 200), ("health/ready", 200), ("empilhadores/", 200), ("checklist/", 200)):
            response = client.get(urljoin(origin, path))
            checks.append({"check": path, "ok": response.status_code == expected, "status": response.status_code})
            if path in {"empilhadores/", "checklist/"}:
                headers = {key.lower(): value for key, value in response.headers.items()}
                checks.extend(
                    [
                        {"check": f"{path}:csp", "ok": "default-src" in headers.get("content-security-policy", "")},
                        {"check": f"{path}:nosniff", "ok": headers.get("x-content-type-options") == "nosniff"},
                        {"check": f"{path}:no-store", "ok": "no-store" in headers.get("cache-control", "")},
                    ]
                )
                if parsed.scheme == "https":
                    checks.append({"check": f"{path}:hsts", "ok": "max-age=" in headers.get("strict-transport-security", "")})
    passed = all(item["ok"] for item in checks)
    print(json.dumps({"ok": passed, "origin": origin, "checks": checks}, ensure_ascii=False))
    raise SystemExit(0 if passed else 1)


if __name__ == "__main__":
    main()
