from datetime import datetime

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from tempo.activities.models import CompletedActivity, Correction
from tempo.linking.models import Link, MatchEvaluation


def create_activity(client: TestClient, **overrides: object) -> dict:
    body = {
        "modality": "running",
        "start_instant": "2026-09-20T08:00:00+00:00",
        "duration_seconds": 3000,
        "distance_metres": 8000,
        "title": "Morning run",
        "notes": "Original notes",
    }
    body.update(overrides)
    response = client.post("/api/activities", json=body)
    assert response.status_code == 201
    return response.json()


def create_run(client: TestClient, day: str) -> dict:
    response = client.post(
        "/api/planned-runs",
        json={
            "scheduled_date": day,
            "training_intent": "aerobic_base",
            "priority": "normal",
            "duration_seconds": 3600,
            "distance_metres": 10_000,
        },
    )
    assert response.status_code == 201
    return response.json()


def correct(client: TestClient, activity_id: str, field: str, value: object, reason: str = "Device was wrong"):
    return client.post(
        f"/api/activities/{activity_id}/corrections",
        json={"field_name": field, "replacement_value": value, "reason": reason},
    )


def test_correction_chain_preserves_original_and_updates_effective_values(
    client: TestClient, database_url: str
) -> None:
    activity = create_activity(client)

    first = correct(client, activity["id"], "duration_seconds", 3300)
    second = correct(client, activity["id"], "duration_seconds", 3000, "Restore original")

    assert first.status_code == 201
    assert second.status_code == 201
    result = second.json()
    assert result["duration_seconds"] == 3000
    assert result["original_values"]["duration_seconds"] == 3000
    assert [(item["source_value"], item["replacement_value"]) for item in result["corrections"]] == [
        (3000, 3300),
        (3300, 3000),
    ]
    with Session(create_engine(database_url)) as session:
        source = session.get(CompletedActivity, activity["id"])
        assert source is not None and source.duration_seconds == 3000
        assert session.scalar(select(func.count()).select_from(Correction)) == 2


def test_all_correctable_fields_validate_and_existing_nullable_fields_are_enforced(
    client: TestClient, database_url: str
) -> None:
    activity = create_activity(client)
    valid = [
        ("start_instant", "2026-09-21T09:00:00-04:00"),
        ("modality", "cycling"),
        ("duration_seconds", 3600),
        ("distance_metres", None),
        ("title", "Correct title"),
        ("notes", "Correct notes"),
    ]
    assert all(correct(client, activity["id"], field, value).status_code == 201 for field, value in valid)

    missing = create_activity(client, start_instant="2026-10-20T08:00:00+00:00", title=None, notes=None)
    invalid = [
        correct(client, activity["id"], "duration_seconds", 0),
        correct(client, activity["id"], "modality", "jogging"),
        correct(client, activity["id"], "start_instant", "2026-09-20T08:00:00"),
        correct(client, missing["id"], "title", "Invented"),
        correct(client, activity["id"], "notes", "Replacement", "   "),
    ]
    assert all(response.status_code == 422 for response in invalid)
    with Session(create_engine(database_url)) as session:
        assert session.scalar(select(func.count()).select_from(Correction)) == len(valid)


def test_unmatched_correction_reevaluates_and_linked_evidence_uses_effective_values(
    client: TestClient, database_url: str
) -> None:
    run = create_run(client, "2026-09-20")
    unmatched = create_activity(client, start_instant="2026-10-20T08:00:00+00:00")
    response = correct(client, unmatched["id"], "start_instant", "2026-09-20T08:00:00+00:00")
    assert response.status_code == 201
    assert response.json()["link_status"] == "linked"

    corrected = correct(client, unmatched["id"], "duration_seconds", 3500).json()
    assert corrected["link_status"] == "linked"
    evidence = client.get(f"/api/planned-runs/{run['id']}/linking").json()
    assert evidence["total_duration_seconds"] == 3500
    assert evidence["duration_difference_seconds"] == 100
    with Session(create_engine(database_url)) as session:
        assert session.scalar(select(func.count()).select_from(Link)) == 1
        assert session.scalar(select(func.count()).select_from(MatchEvaluation)) == 2
        versions = list(session.scalars(select(MatchEvaluation.activity_effective_version)))
        assert versions[0] != versions[1]
