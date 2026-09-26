"""Falha para formatos inequívocos de segredo; não substitui o scanner corporativo."""

from pathlib import Path
import re
import subprocess

root = Path(__file__).resolve().parent.parent
listed = subprocess.run(
    ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    cwd=root,
    check=True,
    capture_output=True,
).stdout.decode("utf-8").split("\0")
patterns = {
    "chave privada": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "token GitHub": re.compile(r"\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{20,}\b"),
    "chave AWS": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "JWT": re.compile(r"\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b"),
    "URL PostgreSQL com senha estática": re.compile(r"postgresql(?:\+psycopg)?://[^\s:$/{]+:[^\s${}/]{12,}@"),
}
findings = []
for relative in filter(None, listed):
    path = root / relative
    if not path.is_file() or path.stat().st_size > 2_000_000 or path.suffix in {".zip", ".png", ".ico", ".pdf", ".xml"}:
        continue
    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        continue
    for label, pattern in patterns.items():
        if pattern.search(content):
            findings.append(f"{label}: {relative}")
if findings:
    raise SystemExit("Possíveis segredos encontrados:\n" + "\n".join(findings))
print(f"Scanner de segredos aprovado: {len(listed) - 1} arquivos examinados.")
