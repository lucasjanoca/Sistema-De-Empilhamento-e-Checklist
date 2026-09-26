"""Verifica a fronteira estática e executa parser JS sem servidor ou dados."""

from pathlib import Path
import re
import shutil
import subprocess

root = Path(__file__).resolve().parent.parent
public = root / "public"
errors = []
for path in public.rglob("*"):
    if not path.is_file():
        continue
    if path.suffix not in {".html", ".css", ".js", ".svg", ".webmanifest"}:
        errors.append(f"Arquivo inesperado: {path.relative_to(public)}")
        continue
    content = path.read_text(encoding="utf-8")
    for pattern in [
        r"localStorage",
        r"lucas123|igor123",
        r"BEGIN .*PRIVATE KEY",
        r"postgresql(?:\+psycopg)?://",
        r"\b(?:DATABASE_URL|SESSION_SECRET|service_role)\b",
    ]:
        if re.search(pattern, content, re.I):
            errors.append(f"Padrão proibido {pattern}: {path.relative_to(public)}")
    if path.suffix == ".html":
        if re.search(r"<script(?![^>]*\bsrc=)[^>]*>\s*\S", content, re.I):
            errors.append("Script inline: " + str(path))
        if re.search(r"<[^>]+\son(?:click|error|load|submit)=", content, re.I):
            errors.append("Handler inline: " + str(path))
        for asset in re.findall(r'(?:src|href)="([^"]+)"', content):
            if asset.startswith(("https:", "http:", "#")):
                continue
            target = (public / asset.lstrip("/")) if asset.startswith("/") else path.parent / asset
            if not target.exists():
                errors.append("Asset ausente: " + asset)
    if path.suffix == ".js" and shutil.which("node"):
        subprocess.run(["node", "--check", str(path)], check=True, stdout=subprocess.DEVNULL)
if errors:
    raise SystemExit("\n".join(errors))
print("Fronteira pública e sintaxe JavaScript verificadas.")
