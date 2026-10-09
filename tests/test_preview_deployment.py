from pathlib import Path

import pytest
import yaml

from app.config import Settings
from scripts.render_preview import configure_environment, normalize_database_url


ROOT = Path(__file__).parent.parent


def test_render_blueprint_is_explicitly_disposable_and_safe_by_default():
    blueprint = yaml.safe_load((ROOT / "render.yaml").read_text(encoding="utf-8"))
    service = blueprint["services"][0]
    database = blueprint["databases"][0]
    variables = {item["key"]: item for item in service["envVars"]}

    assert service["healthCheckPath"] == "/health/ready"
    assert service["autoDeployTrigger"] == "off"
    assert variables["PREVIEW_ADMIN_PASSWORD"]["sync"] is False
    assert variables["INTEGRATION_ADAPTER"]["value"] == ""
    assert database["postgresMajorVersion"] == "17"
    assert database["ipAllowList"] == []


def test_render_environment_is_derived_without_hardcoded_origin():
    env = {
        "ENVIRONMENT": "preview",
        "DATABASE_URL": "postgresql://user:password@private-db:5432/site",
        "RENDER_EXTERNAL_HOSTNAME": "sistema-preview.onrender.com",
    }
    configure_environment(env)

    assert env["DATABASE_URL"] == "postgresql+psycopg://user:password@private-db:5432/site"
    assert env["MIGRATION_DATABASE_URL"] == env["DATABASE_URL"]
    assert env["PUBLIC_ORIGIN"] == "https://sistema-preview.onrender.com"
    assert env["SECURE_COOKIES"] == "true"


def test_preview_requires_render_context_and_https():
    with pytest.raises(RuntimeError, match="somente"):
        configure_environment({"ENVIRONMENT": "production"})
    with pytest.raises(RuntimeError, match="Hostname"):
        configure_environment({"ENVIRONMENT": "preview", "DATABASE_URL": "postgresql://u:p@db/x"})
    with pytest.raises(ValueError, match="HTTPS"):
        Settings(
            ENVIRONMENT="preview",
            DATABASE_URL=normalize_database_url("postgresql://u:p@db/x"),
            SESSION_SECRET="x" * 32,
            PUBLIC_ORIGIN="http://preview.example.com",
            SECURE_COOKIES=True,
        )
