from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, inspect, select, text
from sqlalchemy.orm import Session

from tempo.main import app
from tempo.measurements import MAX_DISTANCE_METRES, MAX_DURATION_SECONDS
from tempo.planning.models import PlannedSession, PrescriptionRevision


def valid_run() -> dict[str, object]:
    return {
        "scheduled_date": "2026-09-21",
        "training_intent": "aerobic_base",
        "priority": "high",
        "notes": "Keep the first half conversational.",
        "duration_seconds": 3600,
        "distance_metres": 10000,
    }


def test_create_and_retrieve_planned_run(client: TestClient, database_url: str) -> None:
    response = client.post("/api/planned-runs", json=valid_run())

    assert response.status_code == 201
    created = response.json()
    assert created["modality"] == "running"
    assert created["scheduled_date"] == "2026-09-21"
    assert created["active_revision"] == {
        "id": created["active_revision"]["id"],
        "revision_number": 1,
        "duration_seconds": 3600,
        "distance_metres": 10000,
        "reason": "initial_entry",
        "provenance": "athlete_entry",
        "created_at": created["active_revision"]["created_at"],
    }

    retrieved = client.get(f"/api/planned-runs/{created['id']}")
    assert retrieved.status_code == 200
    assert retrieved.json() == created
    assert created["created_at"].endswith("Z")
    assert created["active_revision"]["created_at"].endswith("Z")

    with Session(create_engine(database_url)) as session:
        assert session.scalar(select(func.count()).select_from(PlannedSession)) == 1
        assert session.scalar(select(func.count()).select_from(PrescriptionRevision)) == 1
        assert session.scalar(text("PRAGMA foreign_keys")) == 1


def test_rejects_missing_prescription_without_partial_record(
    client: TestClient, database_url: str
) -> None:
    request = valid_run()
    request["duration_seconds"] = None
    request["distance_metres"] = None

    response = client.post("/api/planned-runs", json=request)

    assert response.status_code == 422
    assert "duration, distance, or both" in response.json()["detail"][0]["msg"]
    with Session(create_engine(database_url)) as session:
        assert session.scalar(select(func.count()).select_from(PlannedSession)) == 0
        assert session.scalar(select(func.count()).select_from(PrescriptionRevision)) == 0


def test_rejects_invalid_controlled_values(client: TestClient) -> None:
    request = valid_run()
    request["training_intent"] = "easy"
    request["priority"] = "urgent"
    request["duration_seconds"] = -1

    response = client.post("/api/planned-runs", json=request)

    assert response.status_code == 422
    fields = {error["loc"][-1] for error in response.json()["detail"]}
    assert fields == {"training_intent", "priority", "duration_seconds"}


def test_unknown_planned_run_is_actionable(client: TestClient) -> None:
    response = client.get("/api/planned-runs/not-a-real-id")

    assert response.status_code == 404
    assert response.json() == {"detail": "Planned Run not found."}


def test_accepts_duration_only_and_distance_only(client: TestClient) -> None:
    duration_only = valid_run()
    duration_only["distance_metres"] = None
    distance_only = valid_run()
    distance_only["duration_seconds"] = None

    assert client.post("/api/planned-runs", json=duration_only).status_code == 201
    assert client.post("/api/planned-runs", json=distance_only).status_code == 201


def test_measurement_boundaries_persist_and_are_in_openapi(client: TestClient) -> None:
    request = valid_run()
    request["duration_seconds"] = MAX_DURATION_SECONDS
    request["distance_metres"] = MAX_DISTANCE_METRES

    response = client.post("/api/planned-runs", json=request)

    assert response.status_code == 201
    assert response.json()["active_revision"]["duration_seconds"] == MAX_DURATION_SECONDS
    assert response.json()["active_revision"]["distance_metres"] == MAX_DISTANCE_METRES
    properties = app.openapi()["components"]["schemas"]["PlannedRunCreate"]["properties"]
    assert properties["duration_seconds"]["anyOf"][0]["maximum"] == MAX_DURATION_SECONDS
    assert properties["distance_metres"]["anyOf"][0]["maximum"] == MAX_DISTANCE_METRES


def test_oversized_measurements_are_actionable_and_atomic(
    client: TestClient, database_url: str
) -> None:
    request = valid_run()
    request["duration_seconds"] = MAX_DURATION_SECONDS + 1
    request["distance_metres"] = MAX_DISTANCE_METRES + 1

    response = client.post("/api/planned-runs", json=request)

    assert response.status_code == 422
    assert {error["loc"][-1] for error in response.json()["detail"]} == {
        "duration_seconds",
        "distance_metres",
    }
    with Session(create_engine(database_url)) as session:
        assert session.scalar(select(func.count()).select_from(PlannedSession)) == 0
        assert session.scalar(select(func.count()).select_from(PrescriptionRevision)) == 0


def test_sqlite_prescription_constraints_preserve_legacy_integer_range(
    client: TestClient, database_url: str
) -> None:
    constraints = inspect(create_engine(database_url)).get_check_constraints(
        "prescription_revisions"
    )
    sql = " ".join(constraint["sqltext"] for constraint in constraints)

    assert "duration_seconds > 0" in sql
    assert "distance_metres > 0" in sql
    assert str(MAX_DURATION_SECONDS) not in sql
    assert str(MAX_DISTANCE_METRES) not in sql
