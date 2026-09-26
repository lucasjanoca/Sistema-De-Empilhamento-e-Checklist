"""Valida contratos estaticos de interface, acessibilidade basica e PWA."""

from __future__ import annotations

from html.parser import HTMLParser
import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
VERSION_MATCH = re.search(r'__version__\s*=\s*"([^"]+)"', (ROOT / "app" / "__init__.py").read_text(encoding="utf-8"))
if not VERSION_MATCH:
    raise SystemExit("Versao da aplicacao nao encontrada")
APP_VERSION = VERSION_MATCH.group(1)


class ContractParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: list[str] = []
        self.labels: list[str] = []
        self.controls: list[tuple[str, str, dict[str, str]]] = []
        self.dialogs: list[dict[str, str]] = []
        self.duplicate_attrs: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_names = [key for key, _ in attrs]
        for attr_name in sorted(set(attr_names)):
            if attr_names.count(attr_name) > 1:
                self.duplicate_attrs.append((tag, attr_name))
        values = {key: value or "" for key, value in attrs}
        if values.get("id"):
            self.ids.append(values["id"])
        if tag == "label" and values.get("for"):
            self.labels.append(values["for"])
        if tag in {"input", "select", "textarea"} and values.get("id"):
            self.controls.append((tag, values["id"], values))
        if tag == "dialog":
            self.dialogs.append(values)


def check_html(path: Path, *, require_control_labels: bool = False) -> list[str]:
    errors: list[str] = []
    content = path.read_text(encoding="utf-8")
    parser = ContractParser()
    parser.feed(content)
    ids = set(parser.ids)
    duplicates = sorted(item for item in ids if parser.ids.count(item) > 1)
    if duplicates:
        errors.append(f"{path.name}: IDs duplicados: {', '.join(duplicates)}")
    if parser.duplicate_attrs:
        details = ", ".join(f"<{tag}>:{attr}" for tag, attr in parser.duplicate_attrs)
        errors.append(f"{path.name}: atributos HTML duplicados: {details}")
    missing_targets = sorted(set(parser.labels) - ids)
    if missing_targets:
        errors.append(f"{path.name}: labels apontam para IDs ausentes: {', '.join(missing_targets)}")
    if require_control_labels:
        labelled = set(parser.labels)
        missing_labels = sorted(
            control_id
            for tag, control_id, attrs in parser.controls
            if attrs.get("type") != "hidden"
            and control_id not in labelled
            and not attrs.get("aria-label")
            and not attrs.get("aria-labelledby")
        )
        if missing_labels:
            errors.append(f"{path.name}: controles sem nome acessivel: {', '.join(missing_labels)}")
    for dialog in parser.dialogs:
        label_id = dialog.get("aria-labelledby")
        if not label_id or label_id not in ids:
            errors.append(f"{path.name}: dialog {dialog.get('id', '<sem id>')} sem aria-labelledby valido")
    return errors


def check_checklist_contract() -> list[str]:
    errors: list[str] = []
    html_path = PUBLIC / "checklist" / "index.html"
    js_path = PUBLIC / "checklist" / "assets" / "checklist.js"
    html = html_path.read_text(encoding="utf-8")
    ids = set(re.findall(r'\bid="([^"]+)"', html))
    js_ids = set(re.findall(r"\$\('#([A-Za-z][\w:-]*)'\)", js_path.read_text(encoding="utf-8")))
    missing = sorted(js_ids - ids)
    if missing:
        errors.append("Checklist: IDs usados no JavaScript e ausentes no HTML: " + ", ".join(missing))
    return errors


def check_pwa(module: str) -> list[str]:
    errors: list[str] = []
    directory = PUBLIC / module
    manifest_path = directory / "manifest.webmanifest"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    expected_scope = f"/{module}/"
    if manifest.get("scope") != expected_scope or manifest.get("start_url") != expected_scope:
        errors.append(f"{module}: scope/start_url devem ser {expected_scope}")
    for icon in manifest.get("icons", []):
        if not (directory / icon["src"]).is_file():
            errors.append(f"{module}: icone ausente: {icon['src']}")

    worker = (directory / "sw.js").read_text(encoding="utf-8")
    cache_match = re.search(r'const CACHE="([^"]+)"', worker)
    if not cache_match or not cache_match.group(1).endswith(APP_VERSION):
        errors.append(f"{module}: cache do service worker nao corresponde a versao {APP_VERSION}")
    for required in ("self.skipWaiting()", "self.clients.claim()", "url.pathname.startsWith('/api/')"):
        if required not in worker:
            errors.append(f"{module}: service worker sem {required}")
    assets_match = re.search(r"ASSETS=\[(.*?)\];", worker)
    if not assets_match:
        errors.append(f"{module}: lista ASSETS ausente")
    else:
        for asset in re.findall(r'"([^"]+)"', assets_match.group(1)):
            target = PUBLIC / asset.lstrip("/")
            if not target.is_file():
                errors.append(f"{module}: asset do service worker ausente: {asset}")
    return errors


def main() -> None:
    errors: list[str] = []
    for html_path in PUBLIC.rglob("*.html"):
        errors.extend(check_html(html_path, require_control_labels=html_path == PUBLIC / "checklist" / "index.html"))
    errors.extend(check_checklist_contract())
    errors.extend(check_pwa("checklist"))
    errors.extend(check_pwa("empilhadores"))
    if errors:
        raise SystemExit("\n".join(errors))
    print("Contratos de interface, acessibilidade basica e PWA verificados.")


if __name__ == "__main__":
    main()
