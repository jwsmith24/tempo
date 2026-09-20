from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, inspect, select
from sqlalchemy.orm import Session

from tempo.activities.models import CompletedActivity
from tempo.main import app


def valid_activity() -> dict[str, object]:
    return {
        "modality": "running",
        "start_instant": "2026-09-20T06:30:00+05:30",
        "duration_seconds": 2715,
        "distance_metres": 7421,
        "title": "Morning progression",
        "notes": "Finished relaxed.",
    }


def test_create_retrieve_and_list_unmatched_manual_activity(
    client: TestClient, database_url: str
) -> None:
    response = client.post("/api/activities", json=valid_activity())

    assert response.status_code == 201
    created = response.json()
    assert created == {
        "id": created["id"],
        **valid_activity(),
        "entry_source": "manual",
        "creation_provenance": "athlete_entry",
        "created_at": created["created_at"],
        "link_status": "unmatched",
        "original_values": {
            "start_instant": valid_activity()["start_instant"],
            "modality": "running",
            "duration_seconds": 2715,
            "distance_metres": 7421,
            "title": "Morning progression",
            "notes": "Finished relaxed.",
        },
        "corrections": [],
    }
    assert created["start_instant"].endswith("+05:30")
    assert created["created_at"].endswith("Z")
    assert "vendor_identity" not in created
    assert "raw_file" not in created
    assert "planned_session_id" not in created

    assert client.get(f"/api/activities/{created['id']}").json() == created
    assert client.get("/api/activities").json() == [created]

    with Session(create_engine(database_url)) as restarted_session:
        persisted = restarted_session.get(CompletedActivity, created["id"])
        assert persisted is not None
        assert persisted.start_instant.isoformat() == "2026-09-20T06:30:00+05:30"
        columns = {column["name"] for column in inspect(restarted_session.bind).get_columns("completed_activities")}
        assert "vendor_identity" not in columns
        assert "raw_file_identity" not in columns
        assert "planned_session_id" not in columns


def test_activity_list_orders_actual_instants_newest_first(client: TestClient) -> None:
    later_absolute = valid_activity()
    later_absolute["start_instant"] = "2026-09-20T08:00:00+00:00"
    earlier_absolute = valid_activity()
    earlier_absolute["start_instant"] = "2026-09-20T12:00:00+05:30"

    later = client.post("/api/activities", json=later_absolute).json()
    earlier = client.post("/api/activities", json=earlier_absolute).json()

    assert [activity["id"] for activity in client.get("/api/activities").json()] == [
        later["id"],
        earlier["id"],
    ]


def test_invalid_activity_creates_no_partial_record(
    client: TestClient, database_url: str
) -> None:
    invalid = valid_activity()
    invalid.update(
        {
            "modality": "jogging",
            "start_instant": "2026-09-20T06:30:00",
            "duration_seconds": 0,
            "distance_metres": -1,
        }
    )

    response = client.post("/api/activities", json=invalid)

    assert response.status_code == 422
    assert {error["loc"][-1] for error in response.json()["detail"]} == {
        "modality",
        "start_instant",
        "duration_seconds",
        "distance_metres",
    }
    with Session(create_engine(database_url)) as session:
        assert session.scalar(select(func.count()).select_from(CompletedActivity)) == 0


def test_oversized_measures_are_actionable_and_atomic(
    client: TestClient, database_url: str
) -> None:
    invalid = valid_activity()
    invalid["duration_seconds"] = 604_801
    invalid["distance_metres"] = 1_000_000_001

    response = client.post("/api/activities", json=invalid)

    assert response.status_code == 422
    assert {error["loc"][-1] for error in response.json()["detail"]} == {
        "duration_seconds",
        "distance_metres",
    }
    with Session(create_engine(database_url)) as session:
        assert session.scalar(select(func.count()).select_from(CompletedActivity)) == 0


def test_unknown_activity_is_actionable(client: TestClient) -> None:
    response = client.get("/api/activities/not-a-real-id")

    assert response.status_code == 404
    assert response.json() == {"detail": "Completed Activity not found."}


def test_openapi_constrains_activity_link_status() -> None:
    schema = app.openapi()["components"]["schemas"]["ActivityLinkStatus"]

    assert schema["enum"] == ["unmatched", "linked", "legacy_unresolved"]
