from fastapi.testclient import TestClient

from tempo.main import app


def test_accepts_documented_loopback_hosts(client: TestClient) -> None:
    assert client.get("/api/planned-runs").status_code == 200

    with TestClient(app, base_url="http://localhost:8000") as localhost_client:
        assert localhost_client.get("/api/planned-runs").status_code == 200


def test_rejects_untrusted_host_before_read_route(client: TestClient) -> None:
    response = client.get("/api/planned-runs", headers={"Host": "tempo.example"})

    assert response.status_code == 400
    assert response.text == "Invalid host header"


def test_rejects_untrusted_host_before_state_changing_route(client: TestClient) -> None:
    response = client.post(
        "/api/planned-runs",
        headers={"Host": "tempo.example"},
        json={
            "scheduled_date": "2026-09-21",
            "training_intent": "aerobic_base",
            "priority": "normal",
            "duration_seconds": 1800,
        },
    )

    assert response.status_code == 400
    assert response.text == "Invalid host header"
    assert client.get("/api/planned-runs").json() == []
