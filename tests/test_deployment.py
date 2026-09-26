from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


def test_public_routes_and_health_are_served_by_backend():
    with TestClient(app, base_url=settings().public_origin) as client:
        root = client.get("/", follow_redirects=False)
        assert root.status_code == 302
        assert root.headers["location"] == "/empilhadores/"

        empilhadores = client.get("/empilhadores/")
        checklist = client.get("/checklist/")
        assert empilhadores.status_code == 200
        assert "Gestão de Paletes" in empilhadores.text
        assert checklist.status_code == 200
        assert "Checklist Operacional CD" in checklist.text
        assert client.get("/health/live").json() == {"ok": True}
        assert client.get("/health/ready").status_code == 200


def test_backup_is_authorized_and_fails_truthfully_without_infrastructure(clients):
    operator = clients("empilhador")
    assert operator.send("/backups").status_code == 403

    admin = clients("ti")
    response = admin.send("/backups")
    assert response.status_code == 503
    assert "configurar diretório privado" in response.json()["message"]
