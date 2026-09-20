from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Barrier

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from tempo.activities.models import CompletedActivity
from tempo.linking.models import (
    CheckIn,
    LegacyLinkRecord,
    LegacyLinkResolution,
    Link,
    LinkDecision,
    SessionOutcome,
)
from tempo.main import app
from tempo.planning.models import PlannedSession


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
    evaluation = linking["latest_match_evaluation"]
    assert datetime.fromisoformat(evaluation["activity_effective_version"]) == datetime.fromisoformat(
        activity["created_at"]
    )
    assert evaluation["algorithm_version"] == "stage1-date-noon-v2"
    assert evaluation["evaluated_at"]
    assert [candidate["planned_run"]["id"] for candidate in evaluation["candidates"]] == [run["id"]]
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
    assert [candidate["planned_run"]["id"] for candidate in linking["latest_match_evaluation"]["candidates"]] == sorted(
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
    assert detail["latest_match_evaluation"]["candidates"] == []


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

    with TestClient(app, base_url="http://127.0.0.1") as restarted_client:
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


def test_concurrent_reassignments_leave_one_destination_and_coherent_history(
    client: TestClient, database_url: str
) -> None:
    original = create_run(client, "2026-09-01")
    destinations = [
        create_run(client, "2026-10-01"),
        create_run(client, "2026-11-01"),
    ]
    activity = create_activity(client, start="2026-09-20T08:00:00+00:00")
    url = f"/api/activities/{activity['id']}/linking/link"
    assert client.post(url, json={"planned_session_id": original["id"]}).status_code == 201
    start = Barrier(2)

    def reassign(run_id: str):
        start.wait(timeout=5)
        return client.put(
            url,
            json={"planned_session_id": run_id, "expected_version": 1},
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(reassign, [run["id"] for run in destinations]))

    assert sorted(response.status_code for response in responses) == [200, 409]
    conflict = next(response for response in responses if response.status_code == 409)
    assert conflict.json()["detail"] == "This Link changed since it was loaded. Reload and try again."
    winner = next(response.json() for response in responses if response.status_code == 200)
    with Session(create_engine(database_url)) as session:
        links = list(session.scalars(select(Link)))
        decisions = list(session.scalars(select(LinkDecision)))
        assert len(links) == 1
        assert links[0].completed_activity_id == activity["id"]
        assert links[0].planned_session_id == winner["planned_session_id"]
        assert links[0].version == 2
        assert len(decisions) == 1
        assert decisions[0].action == "changed"
        assert decisions[0].prior_planned_session_id == original["id"]
        assert decisions[0].planned_session_id == winner["planned_session_id"]


def test_concurrent_change_versus_remove_preserves_records_and_zero_or_one_link(
    client: TestClient, database_url: str
) -> None:
    original = create_run(client, "2026-09-01")
    destination = create_run(client, "2026-10-01")
    activity = create_activity(client, start="2026-09-20T08:00:00+00:00")
    url = f"/api/activities/{activity['id']}/linking/link"
    assert client.post(url, json={"planned_session_id": original["id"]}).status_code == 201
    assert client.post(
        f"/api/planned-runs/{original['id']}/outcomes",
        json={"disposition": "completed", "reason": "Preserve this decision."},
    ).status_code == 201
    assert client.post(
        f"/api/planned-runs/{original['id']}/check-ins",
        json={"post_session_effort": 7},
    ).status_code == 201
    start = Barrier(2)

    def change():
        start.wait(timeout=5)
        return client.put(
            url,
            json={"planned_session_id": destination["id"], "expected_version": 1},
        )

    def remove():
        start.wait(timeout=5)
        return client.request("DELETE", url, json={"expected_version": 1})

    with ThreadPoolExecutor(max_workers=2) as executor:
        change_response = executor.submit(change)
        remove_response = executor.submit(remove)
        responses = [change_response.result(), remove_response.result()]

    assert sum(response.status_code in {200, 204} for response in responses) == 1
    loser = next(response for response in responses if response.status_code not in {200, 204})
    assert loser.status_code == 409
    assert "Reload and try again" in loser.json()["detail"]
    with Session(create_engine(database_url)) as session:
        links = list(session.scalars(select(Link)))
        decisions = list(session.scalars(select(LinkDecision)))
        assert len(links) <= 1
        if links:
            assert links[0].completed_activity_id == activity["id"]
            assert links[0].planned_session_id == destination["id"]
        assert len(decisions) == 1
        assert decisions[0].action in {"changed", "removed"}
        assert session.get(CompletedActivity, activity["id"]) is not None
        assert session.get(PlannedSession, original["id"]) is not None
        assert session.get(PlannedSession, destination["id"]) is not None
        assert session.scalar(select(func.count()).select_from(SessionOutcome)) == 1
        assert session.scalar(select(func.count()).select_from(CheckIn)) == 1


def test_non_running_activity_is_not_matched(client: TestClient) -> None:
    create_run(client)
    activity = create_activity(client, modality="cycling")
    assert activity["link_status"] == "unmatched"
    assert client.get(f"/api/activities/{activity['id']}/linking").json()["latest_match_evaluation"][
        "candidates"
    ] == []


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


def test_outcomes_and_check_ins_are_append_only_and_independent_of_links(
    client: TestClient, database_url: str
) -> None:
    run = create_run(client, "2026-09-01")
    base = f"/api/planned-runs/{run['id']}"

    dispositions = [
        "completed",
        "modified",
        "rescheduled",
        "intentionally_skipped",
        "unintentionally_missed",
        "replaced",
    ]
    outcomes = [
        client.post(f"{base}/outcomes", json={"disposition": disposition, "reason": "Finished as planned."})
        for disposition in dispositions
    ]
    assert all(response.status_code == 201 for response in outcomes)
    assert outcomes[0].json()["reason"] == "Finished as planned."
    assert client.post(f"{base}/outcomes", json={"disposition": "unknown"}).status_code == 422
    assert client.post(f"{base}/check-ins", json={}).status_code == 422
    assert client.post(f"{base}/check-ins", json={"notes": "   "}).status_code == 422
    assert client.post(f"{base}/check-ins", json={"readiness": 6}).status_code == 422
    first_check_in = client.post(f"{base}/check-ins", json={"readiness": 3, "notes": "Tired."})
    second_check_in = client.post(f"{base}/check-ins", json={"post_session_effort": 7, "feel": 4})
    notes_only_check_in = client.post(f"{base}/check-ins", json={"notes": "Easy day."})
    assert first_check_in.status_code == 201
    assert second_check_in.status_code == 201
    assert notes_only_check_in.status_code == 201

    evidence = client.get(f"{base}/linking").json()
    assert evidence["links"] == []
    assert evidence["session_outcome"]["id"] == outcomes[-1].json()["id"]
    assert [item["disposition"] for item in evidence["session_outcome_history"]] == dispositions
    assert evidence["check_in"]["id"] == notes_only_check_in.json()["id"]
    assert [item["id"] for item in evidence["check_in_history"]] == [
        first_check_in.json()["id"],
        second_check_in.json()["id"],
        notes_only_check_in.json()["id"],
    ]
    with Session(create_engine(database_url)) as restarted_session:
        assert restarted_session.scalar(select(func.count()).select_from(SessionOutcome)) == len(dispositions)
        assert restarted_session.scalar(select(func.count()).select_from(CheckIn)) == 3
