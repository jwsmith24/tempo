from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from tempo.linking.models import LegacyLinkRecord, LegacyLinkResolution, Link
from tempo.main import app


def create_run(client: TestClient, scheduled_date: str = "2026-09-20") -> dict:
    response = client.post(
        "/api/planned-runs",
        json={
            "scheduled_date": scheduled_date,
            "training_intent": "aerobic_base",
            "priority": "normal",
            "duration_seconds": 3600,
            "distance_metres": 10_000,
        },
    )
    assert response.status_code == 201
    return response.json()


def create_activity(
    client: TestClient,
    start: str = "2026-09-20T08:00:00+00:00",
    modality: str = "running",
    duration: int = 3300,
    distance: int | None = 9000,
) -> dict:
    response = client.post(
        "/api/activities",
        json={
            "modality": modality,
            "start_instant": start,
            "duration_seconds": duration,
            "distance_metres": distance,
        },
    )
    assert response.status_code == 201
    return response.json()


def test_exactly_one_candidate_links_automatically_with_complete_evidence(
    client: TestClient, database_url: str
) -> None:
    run = create_run(client)
    activity = create_activity(client)

    assert activity["link_status"] == "linked"
    linking = client.get(f"/api/activities/{activity['id']}/linking").json()
    assert linking["candidates"] == []
    assert linking["link"]["planned_run"]["id"] == run["id"]
    link = linking["link"]["link"]
    assert link["source"] == "automatic"
    assert link["algorithm_version"] == "stage1-date-noon-v2"
    assert link["reasons"] == [
        "Both records have running modality.",
        "The activity starts on the Planned Session date.",
        "The activity has no current Link.",
    ]
    assert "linked_duration_seconds" not in link
    assert "linked_distance_metres" not in link

    evidence = client.get(f"/api/planned-runs/{run['id']}/linking").json()
    assert evidence["total_duration_seconds"] == 3300
    assert evidence["total_distance_metres"] == 9000
    assert evidence["duration_difference_seconds"] == 300
    assert evidence["distance_difference_metres"] == 1000
    assert evidence["session_outcome"] is None
    with Session(create_engine(database_url)) as restarted_session:
        assert restarted_session.scalar(select(func.count()).select_from(Link)) == 1


def test_multiple_candidates_require_confirmation_and_zero_candidates_stay_unmatched(
    client: TestClient,
) -> None:
    first = create_run(client)
    second = create_run(client)
    activity = create_activity(client)

    assert activity["link_status"] == "unmatched"
    linking = client.get(f"/api/activities/{activity['id']}/linking").json()
    assert linking["link"] is None
    assert [candidate["planned_run"]["id"] for candidate in linking["candidates"]] == sorted(
        [first["id"], second["id"]]
    )

    confirmed = client.post(
        f"/api/activities/{activity['id']}/linking/candidates/{second['id']}/confirm"
    )
    assert confirmed.status_code == 201
    assert confirmed.json()["source"] == "athlete_confirmed"
    assert client.get(f"/api/activities/{activity['id']}/linking").json()["link"][
        "planned_run"
    ]["id"] == second["id"]

    unmatched = create_activity(client, start="2026-10-20T08:00:00+00:00")
    detail = client.get(f"/api/activities/{unmatched['id']}/linking").json()
    assert detail["link"] is None
    assert detail["candidates"] == []


def test_direct_link_can_be_changed_removed_and_revisited(client: TestClient) -> None:
    first = create_run(client, "2026-09-01")
    second = create_run(client, "2026-10-01")
    activity = create_activity(client, start="2026-09-20T08:00:00+00:00")
    url = f"/api/activities/{activity['id']}/linking/link"

    created = client.post(url, json={"planned_session_id": first["id"]})
    assert created.status_code == 201
    assert created.json()["source"] == "direct"
    changed = client.put(url, json={"planned_session_id": second["id"], "expected_version": 1})
    assert changed.status_code == 200
    assert changed.json()["planned_session_id"] == second["id"]

    with TestClient(app) as restarted_client:
        detail = restarted_client.get(f"/api/activities/{activity['id']}/linking").json()
        assert detail["link"]["planned_run"]["id"] == second["id"]

    assert client.request("DELETE", url, json={"expected_version": 2}).status_code == 204
    detail = client.get(f"/api/activities/{activity['id']}/linking").json()
    assert detail["link"] is None
    assert detail["activity"]["link_status"] == "unmatched"


def test_many_activities_can_link_to_one_plan_and_missing_distance_abstains(
    client: TestClient,
) -> None:
    run = create_run(client)
    first = create_activity(client, duration=1800, distance=5000)
    second = create_activity(client, start="2026-09-20T10:00:00+00:00", duration=1500, distance=None)

    for activity in (first, second):
        assert activity["link_status"] == "linked"
    evidence = client.get(f"/api/planned-runs/{run['id']}/linking").json()
    assert len(evidence["links"]) == 2
    assert evidence["total_duration_seconds"] == 3300
    assert evidence["total_distance_metres"] is None
    assert evidence["distance_difference_metres"] is None


def test_concurrent_direct_links_enforce_one_activity_owner(
    client: TestClient, database_url: str
) -> None:
    first = create_run(client, "2026-09-01")
    second = create_run(client, "2026-10-01")
    activity = create_activity(client, start="2026-09-20T08:00:00+00:00")
    url = f"/api/activities/{activity['id']}/linking/link"

    def link(run_id: str):
        return client.post(url, json={"planned_session_id": run_id})

    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(link, [first["id"], second["id"]]))

    assert sorted(response.status_code for response in responses) == [201, 409]
    with Session(create_engine(database_url)) as session:
        assert session.scalar(select(func.count()).select_from(Link)) == 1


def test_stale_link_change_and_removal_are_rejected(client: TestClient) -> None:
    first = create_run(client, "2026-09-01")
    second = create_run(client, "2026-10-01")
    activity = create_activity(client, start="2026-09-20T08:00:00+00:00")
    url = f"/api/activities/{activity['id']}/linking/link"
    assert client.post(url, json={"planned_session_id": first["id"]}).status_code == 201
    assert client.put(
        url, json={"planned_session_id": second["id"], "expected_version": 1}
    ).status_code == 200

    stale_change = client.put(
        url, json={"planned_session_id": first["id"], "expected_version": 1}
    )
    stale_remove = client.request("DELETE", url, json={"expected_version": 1})
    assert stale_change.status_code == 409
    assert stale_remove.status_code == 409


def test_non_running_activity_is_not_matched(client: TestClient) -> None:
    create_run(client)
    activity = create_activity(client, modality="cycling")
    assert activity["link_status"] == "unmatched"
    assert client.get(f"/api/activities/{activity['id']}/linking").json()["candidates"] == []


def test_legacy_multi_links_are_visible_and_resolved_without_losing_history(
    client: TestClient, database_url: str
) -> None:
    first = create_run(client, "2026-09-01")
    second = create_run(client, "2026-10-01")
    activity = create_activity(client, start="2026-09-20T08:00:00+00:00")
    with Session(create_engine(database_url)) as session:
        resolution = LegacyLinkResolution(
            completed_activity_id=activity["id"], status="unresolved"
        )
        session.add(resolution)
        session.flush()
        session.add_all(
            [
                LegacyLinkRecord(
                    id=f"legacy-{index}",
                    resolution_id=resolution.id,
                    planned_session_id=run["id"],
                    completed_activity_id=activity["id"],
                    linked_duration_seconds=duration,
                    linked_distance_metres=distance,
                    confirmation_source="direct",
                    version=1,
                    created_at=datetime(2026, 9, 20, 1, tzinfo=UTC),
                )
                for index, (run, duration, distance) in enumerate(
                    ((first, 1200, 3000), (second, 1800, 4000)), start=1
                )
            ]
        )
        session.commit()

    detail = client.get(f"/api/activities/{activity['id']}/linking").json()
    assert detail["activity"]["link_status"] == "legacy_unresolved"
    assert detail["link"] is None
    assert [record["linked_duration_seconds"] for record in detail["legacy_resolution"]["records"]] == [
        1200,
        1800,
    ]

    resolved = client.post(
        f"/api/activities/{activity['id']}/linking/legacy-resolution",
        json={"planned_session_id": second["id"]},
    )
    assert resolved.status_code == 200
    result = resolved.json()
    assert result["link"]["planned_run"]["id"] == second["id"]
    assert result["legacy_resolution"]["status"] == "resolved"
    assert len(result["legacy_resolution"]["records"]) == 2
