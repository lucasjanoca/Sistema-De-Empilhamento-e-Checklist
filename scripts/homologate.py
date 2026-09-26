"""Executa a homologacao automatizada do Site Selene."""

from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parent.parent


def run(label: str, command: list[str]) -> None:
    print(f"\n=== {label} ===", flush=True)
    subprocess.run(command, cwd=ROOT, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Homologacao automatizada do Site Selene")
    parser.add_argument("--skip-dependency-audit", action="store_true", help="Nao consulta a base de vulnerabilidades")
    parser.add_argument("--skip-runtime", action="store_true", help="Nao executa verificacoes que exigem PostgreSQL configurado")
    args = parser.parse_args()
    python = sys.executable

    checks = [
        ("Lint Python", [python, "-m", "ruff", "check", "app", "tests", "migrations", "scripts"]),
        ("Fronteira publica e JavaScript", [python, "scripts/check_public.py"]),
        ("Contratos de interface e PWA", [python, "scripts/check_ui_contract.py"]),
        ("Varredura de segredos", [python, "scripts/scan_secrets.py"]),
        ("Testes de regressao", [python, "-m", "pytest", "--junitxml=TEST-RESULTS.xml"]),
    ]
    for label, command in checks:
        run(label, command)

    if not args.skip_dependency_audit:
        audit_output = ROOT / "dependency-audit.json"
        audit_output.unlink(missing_ok=True)
        audit_cache = ROOT / "work" / "pip-audit-cache"
        audit_cache.mkdir(parents=True, exist_ok=True)
        run(
            "Auditoria de dependencias",
            [
                python,
                "-m",
                "pip_audit",
                "-r",
                "requirements-runtime.lock",
                "--cache-dir",
                str(audit_cache),
                "--no-deps",
                "--disable-pip",
                "--format",
                "json",
                "--output",
                str(audit_output),
            ],
        )

    if not args.skip_runtime:
        run("Estado das migrations", [python, "-m", "alembic", "check"])
        run("Integridade da auditoria", [python, "-m", "app.admin", "verify-audit"])
        run("Diagnostico operacional", [python, "-m", "app.admin", "diagnose"])

    print("\nHOMOLOGACAO AUTOMATIZADA: PASSOU", flush=True)


if __name__ == "__main__":
    main()
