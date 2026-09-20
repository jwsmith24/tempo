from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from tempo.main import app
from tempo.reconciliation.models import ReconciliationAllocation, SuggestionRejection


def create_run(client: TestClient, scheduled_date: str = "2026-09-20") -> dict[str, object]:
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
    *,
    start: str,
    duration: int = 3300,
    distance: int | None = 9000,
    modality: str = "running",
    title: str | None = None,
) -> dict[str, object]:
    response = client.post(
        "/api/activities",
        json={
            "modality": modality,
            "start_instant": start,
            "duration_seconds": duration,
            "distance_metres": distance,
            "title": title,
        },
    )
    assert response.status_code == 201
    return response.json()


def test_suggestions_are_deterministic_eligible_and_write_free(
    client: TestClient, database_url: str
) -> None:
    run = create_run(client)
    adjacent = create_activity(client, start="2026-09-19T12:00:00+00:00", title="Adjacent")
    same_day_late = create_activity(client, start="2026-09-20T15:00:00+00:00", title="Later")
    same_day_early = create_activity(client, start="2026-09-20T09:00:00+00:00", title="Earlier")
    create_activity(client, start="2026-09-22T12:00:00+00:00", title="Too far")
    create_activity(client, start="2026-09-20T12:00:00+00:00", modality="cycling", title="Ride")

    response = client.get(f"/api/planned-runs/{run['id']}/reconciliation/suggestions")

    assert response.status_code == 200
    suggestions = response.json()
    tied = sorted([same_day_early, same_day_late], key=lambda activity: activity["id"])
    assert [suggestion["activity"]["id"] for suggestion in suggestions] == [
        tied[0]["id"],
        tied[1]["id"],
        adjacent["id"],
    ]
    assert all(suggestion["algorithm_version"] == "stage1-date-noon-v1" for suggestion in suggestions)
    assert suggestions[0]["reasons"] == [
        "Both records have running modality.",
        "The activity starts on the Planned Session date.",
        "The activity has unallocated duration available.",
    ]
    assert suggestions[0]["proposed_duration_seconds"] == 3300
    assert suggestions[0]["proposed_distance_metres"] == 9000

    with Session(create_engine(database_url)) as session:
        assert session.scalar(select(func.count()).select_from(ReconciliationAllocation)) == 0
        assert session.scalar(select(func.count()).select_from(SuggestionRejection)) == 0


def test_activity_suggestions_offer_compatible_planned_runs_without_writing(
    client: TestClient, database_url: str
) -> None:
    same_day = create_run(client, "2026-09-20")
    adjacent = create_run(client, "2026-09-19")
    create_run(client, "2026-09-23")
    activity = create_activity(
        client, start="2026-09-20T08:00:00+00:00", title="Observed run"
    )

    response = client.get(
        f"/api/activities/{activity['id']}/reconciliation/suggestions"
    )

    assert response.status_code == 200
    suggestions = response.json()
    assert [suggestion["planned_run"]["id"] for suggestion in suggestions] == [
        same_day["id"],
        adjacent["id"],
    ]
    assert suggestions[0]["activity_id"] == activity["id"]
    assert suggestions[0]["algorithm_version"] == "stage1-date-noon-v1"
    assert suggestions[0]["proposed_duration_seconds"] == 3300
    assert suggestions[0]["proposed_distance_metres"] == 9000
    with Session(create_engine(database_url)) as session:
        assert session.scalar(select(func.count()).select_from(ReconciliationAllocation)) == 0
        assert session.scalar(select(func.count()).select_from(SuggestionRejection)) == 0


def test_rejection_suppresses_only_the_unchanged_suggestion_and_persists(
    client: TestClient, database_url: str
) -> None:
    run = create_run(client)
    activity = create_activity(client, start="2026-09-20T07:00:00-04:00")
    suggestion_url = f"/api/planned-runs/{run['id']}/reconciliation/suggestions"

    response = client.post(f"{suggestion_url}/{activity['id']}/reject")

    assert response.status_code == 200
    assert response.json() == {"decision": "rejected"}
    assert client.get(suggestion_url).json() == []
    assert client.get(f"/api/activities/{activity['id']}").json()["reconciliation_status"] == "unmatched"
    with Session(create_engine(database_url)) as restarted_session:
        rejection = restarted_session.scalar(select(SuggestionRejection))
        assert rejection is not None
        assert rejection.prescription_revision_id == run["active_revision"]["id"]
        assert rejection.completed_activity_id == activity["id"]
        assert restarted_session.scalar(select(func.count()).select_from(ReconciliationAllocation)) == 0


def test_confirmation_defaults_allocation_and_returns_planned_actual_evidence(
    client: TestClient, database_url: str
) -> None:
    run = create_run(client)
    activity = create_activity(
        client,
        start="2026-09-20T07:00:00-04:00",
        duration=3300,
        distance=9000,
        title="Steady run",
    )
    base_url = f"/api/planned-runs/{run['id']}/reconciliation"

    response = client.post(f"{base_url}/suggestions/{activity['id']}/confirm", json={})

    assert response.status_code == 201
    allocation = response.json()
    assert allocation["planned_session_id"] == run["id"]
    assert allocation["completed_activity_id"] == activity["id"]
    assert allocation["allocated_duration_seconds"] == 3300
    assert allocation["allocated_distance_metres"] == 9000
    assert allocation["confirmation_source"] == "suggestion"

    evidence = client.get(base_url).json()
    assert evidence["planned_run"]["id"] == run["id"]
    assert evidence["allocated_duration_seconds"] == 3300
    assert evidence["allocated_distance_metres"] == 9000
    assert evidence["duration_difference_seconds"] == 300
    assert evidence["distance_difference_metres"] == 1000
    assert evidence["allocations"][0]["activity"]["title"] == "Steady run"
    assert evidence["allocations"][0]["unmatched_duration_seconds"] == 0
    assert evidence["allocations"][0]["unmatched_distance_metres"] == 0
    assert evidence["allocations"][0]["activity"]["reconciliation_status"] == "allocated"
    assert evidence["session_outcome"] is None
    assert client.get(f"{base_url}/suggestions").json() == []
    assert client.get(f"/api/activities/{activity['id']}").json()["reconciliation_status"] == "allocated"

    with Session(create_engine(database_url)) as restarted_session:
        persisted = restarted_session.scalar(select(ReconciliationAllocation))
        assert persisted is not None
        assert persisted.id == allocation["id"]


def test_confirmation_allows_adjustment_and_rejects_invalid_capacity_or_duplicates(
    client: TestClient,
) -> None:
    run = create_run(client)
    activity = create_activity(
        client, start="2026-09-20T10:00:00+00:00", duration=1800, distance=4000
    )
    confirm_url = (
        f"/api/planned-runs/{run['id']}/reconciliation/suggestions/{activity['id']}/confirm"
    )

    too_long = client.post(
        confirm_url,
        json={"allocated_duration_seconds": 1801, "allocated_distance_metres": 4000},
    )
    assert too_long.status_code == 409
    assert too_long.json() == {
        "detail": "Allocated duration exceeds the activity's remaining 1800 seconds."
    }

    too_far = client.post(
        confirm_url,
        json={"allocated_duration_seconds": 1200, "allocated_distance_metres": 4001},
    )
    assert too_far.status_code == 409
    assert too_far.json() == {
        "detail": "Allocated distance exceeds the activity's remaining 4000 metres."
    }

    confirmed = client.post(
        confirm_url,
        json={"allocated_duration_seconds": 1200, "allocated_distance_metres": 3000},
    )
    assert confirmed.status_code == 201
    assert confirmed.json()["allocated_duration_seconds"] == 1200
    assert confirmed.json()["allocated_distance_metres"] == 3000

    duplicate = client.post(confirm_url, json={})
    assert duplicate.status_code == 409
    assert duplicate.json() == {
        "detail": "This Planned Session and Completed Activity are already reconciled."
    }


def test_confirmation_distinguishes_default_distance_from_no_distance(client: TestClient) -> None:
    default_run = create_run(client)
    default_activity = create_activity(
        client, start="2026-09-20T08:00:00+00:00", distance=4000
    )
    defaulted = client.post(
        f"/api/planned-runs/{default_run['id']}/reconciliation/suggestions/{default_activity['id']}/confirm",
        json={},
    )
    assert defaulted.status_code == 201
    assert defaulted.json()["allocated_distance_metres"] == 4000

    no_distance_run = create_run(client, "2026-09-22")
    no_distance_activity = create_activity(
        client, start="2026-09-22T08:00:00+00:00", distance=4000
    )
    duration_only = client.post(
        f"/api/planned-runs/{no_distance_run['id']}/reconciliation/suggestions/{no_distance_activity['id']}/confirm",
        json={"allocated_distance_metres": None},
    )
    assert duration_only.status_code == 201
    assert duration_only.json()["allocated_distance_metres"] is None


def test_confirmation_revalidates_eligibility_and_distance_presence(client: TestClient) -> None:
    run = create_run(client)
    no_distance = create_activity(
        client, start="2026-09-20T10:00:00+00:00", distance=None
    )
    invalid_distance = client.post(
        f"/api/planned-runs/{run['id']}/reconciliation/suggestions/{no_distance['id']}/confirm",
        json={"allocated_distance_metres": 1},
    )
    assert invalid_distance.status_code == 409
    assert invalid_distance.json() == {
        "detail": "Distance cannot be allocated because the activity has no recorded distance."
    }

    incompatible = create_activity(
        client, start="2026-09-24T10:00:00+00:00", modality="running"
    )
    stale = client.post(
        f"/api/planned-runs/{run['id']}/reconciliation/suggestions/{incompatible['id']}/confirm",
        json={},
    )
    assert stale.status_code == 409
    assert stale.json() == {
        "detail": "These records are no longer eligible for this match suggestion."
    }


def test_concurrent_confirmations_cannot_overallocate_activity(
    client: TestClient, database_url: str
) -> None:
    first_run = create_run(client)
    second_run = create_run(client)
    activity = create_activity(
        client, start="2026-09-20T10:00:00+00:00", duration=1800, distance=4000
    )

    def confirm(run_id: str):
        return client.post(
            f"/api/planned-runs/{run_id}/reconciliation/suggestions/{activity['id']}/confirm",
            json={},
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(confirm, [first_run["id"], second_run["id"]]))

    assert sorted(response.status_code for response in responses) == [201, 409]
    with Session(create_engine(database_url)) as session:
        duration, distance = session.execute(
            select(
                func.sum(ReconciliationAllocation.allocated_duration_seconds),
                func.sum(ReconciliationAllocation.allocated_distance_metres),
            ).where(ReconciliationAllocation.completed_activity_id == activity["id"])
        ).one()
        assert duration == 1800
        assert distance == 4000


def test_concurrent_reject_and_confirm_cannot_both_succeed(client: TestClient) -> None:
    run = create_run(client)
    activity = create_activity(client, start="2026-09-20T10:00:00+00:00")
    base_url = f"/api/planned-runs/{run['id']}/reconciliation/suggestions/{activity['id']}"

    with ThreadPoolExecutor(max_workers=2) as executor:
        reject_future = executor.submit(client.post, f"{base_url}/reject")
        confirm_future = executor.submit(client.post, f"{base_url}/confirm", json={})
        responses = [reject_future.result(), confirm_future.result()]

    assert len([response for response in responses if response.status_code in (200, 201)]) == 1
    assert len([response for response in responses if response.status_code == 409]) == 1
    assert client.get(
        f"/api/planned-runs/{run['id']}/reconciliation/suggestions"
    ).json() == []


def test_reconciliation_is_available_to_a_restarted_client(client: TestClient) -> None:
    run = create_run(client)
    activity = create_activity(client, start="2026-09-20T10:00:00+00:00")
    response = client.post(
        f"/api/planned-runs/{run['id']}/reconciliation/suggestions/{activity['id']}/confirm",
        json={},
    )
    assert response.status_code == 201

    with TestClient(app) as restarted_client:
        evidence = restarted_client.get(
            f"/api/planned-runs/{run['id']}/reconciliation"
        ).json()
        assert evidence["allocations"][0]["allocation"]["completed_activity_id"] == activity["id"]
        assert restarted_client.get(f"/api/activities/{activity['id']}").json()[
            "reconciliation_status"
        ] == "allocated"
