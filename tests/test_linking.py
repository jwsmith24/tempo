from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from tempo.main import app
from tempo.linking.models import Link, SuggestionRejection


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

    response = client.get(f"/api/planned-runs/{run['id']}/linking/suggestions")

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
        "The activity has remaining duration available for linking.",
    ]
    assert suggestions[0]["proposed_duration_seconds"] == 3300
    assert suggestions[0]["proposed_distance_metres"] == 9000

    with Session(create_engine(database_url)) as session:
        assert session.scalar(select(func.count()).select_from(Link)) == 0
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
        f"/api/activities/{activity['id']}/linking/suggestions"
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
        assert session.scalar(select(func.count()).select_from(Link)) == 0
        assert session.scalar(select(func.count()).select_from(SuggestionRejection)) == 0


def test_rejection_suppresses_only_the_unchanged_suggestion_and_persists(
    client: TestClient, database_url: str
) -> None:
    run = create_run(client)
    activity = create_activity(client, start="2026-09-20T07:00:00-04:00")
    suggestion_url = f"/api/planned-runs/{run['id']}/linking/suggestions"

    response = client.post(f"{suggestion_url}/{activity['id']}/reject")

    assert response.status_code == 200
    assert response.json() == {"decision": "rejected"}
    assert client.get(suggestion_url).json() == []
    assert client.get(f"/api/activities/{activity['id']}").json()["link_status"] == "unmatched"
    with Session(create_engine(database_url)) as restarted_session:
        rejection = restarted_session.scalar(select(SuggestionRejection))
        assert rejection is not None
        assert rejection.prescription_revision_id == run["active_revision"]["id"]
        assert rejection.completed_activity_id == activity["id"]
        assert restarted_session.scalar(select(func.count()).select_from(Link)) == 0


def test_confirmation_defaults_link_and_returns_planned_actual_evidence(
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
    base_url = f"/api/planned-runs/{run['id']}/linking"

    response = client.post(f"{base_url}/suggestions/{activity['id']}/confirm", json={})

    assert response.status_code == 201
    link = response.json()
    assert link["planned_session_id"] == run["id"]
    assert link["completed_activity_id"] == activity["id"]
    assert link["linked_duration_seconds"] == 3300
    assert link["linked_distance_metres"] == 9000
    assert link["confirmation_source"] == "suggestion"

    evidence = client.get(base_url).json()
    assert evidence["planned_run"]["id"] == run["id"]
    assert evidence["total_linked_duration_seconds"] == 3300
    assert evidence["total_linked_distance_metres"] == 9000
    assert evidence["duration_difference_seconds"] == 300
    assert evidence["distance_difference_metres"] == 1000
    assert evidence["links"][0]["activity"]["title"] == "Steady run"
    assert evidence["links"][0]["unmatched_duration_seconds"] == 0
    assert evidence["links"][0]["unmatched_distance_metres"] == 0
    assert evidence["links"][0]["activity"]["link_status"] == "linked"
    assert evidence["session_outcome"] is None
    assert client.get(f"{base_url}/suggestions").json() == []
    assert client.get(f"/api/activities/{activity['id']}").json()["link_status"] == "linked"

    with Session(create_engine(database_url)) as restarted_session:
        persisted = restarted_session.scalar(select(Link))
        assert persisted is not None
        assert persisted.id == link["id"]


def test_confirmation_allows_adjustment_and_rejects_invalid_capacity_or_duplicates(
    client: TestClient,
) -> None:
    run = create_run(client)
    activity = create_activity(
        client, start="2026-09-20T10:00:00+00:00", duration=1800, distance=4000
    )
    confirm_url = (
        f"/api/planned-runs/{run['id']}/linking/suggestions/{activity['id']}/confirm"
    )

    too_long = client.post(
        confirm_url,
        json={"linked_duration_seconds": 1801, "linked_distance_metres": 4000},
    )
    assert too_long.status_code == 409
    assert too_long.json() == {
        "detail": "Linked duration exceeds the activity's remaining 1800 seconds."
    }

    too_far = client.post(
        confirm_url,
        json={"linked_duration_seconds": 1200, "linked_distance_metres": 4001},
    )
    assert too_far.status_code == 409
    assert too_far.json() == {
        "detail": "Linked distance exceeds the activity's remaining 4000 metres."
    }

    confirmed = client.post(
        confirm_url,
        json={"linked_duration_seconds": 1200, "linked_distance_metres": 3000},
    )
    assert confirmed.status_code == 201
    assert confirmed.json()["linked_duration_seconds"] == 1200
    assert confirmed.json()["linked_distance_metres"] == 3000

    duplicate = client.post(confirm_url, json={})
    assert duplicate.status_code == 409
    assert duplicate.json() == {
        "detail": "This Planned Session and Completed Activity are already linked."
    }


def test_confirmation_distinguishes_default_distance_from_no_distance(client: TestClient) -> None:
    default_run = create_run(client)
    default_activity = create_activity(
        client, start="2026-09-20T08:00:00+00:00", distance=4000
    )
    defaulted = client.post(
        f"/api/planned-runs/{default_run['id']}/linking/suggestions/{default_activity['id']}/confirm",
        json={},
    )
    assert defaulted.status_code == 201
    assert defaulted.json()["linked_distance_metres"] == 4000

    no_distance_run = create_run(client, "2026-09-22")
    no_distance_activity = create_activity(
        client, start="2026-09-22T08:00:00+00:00", distance=4000
    )
    duration_only = client.post(
        f"/api/planned-runs/{no_distance_run['id']}/linking/suggestions/{no_distance_activity['id']}/confirm",
        json={"linked_distance_metres": None},
    )
    assert duration_only.status_code == 201
    assert duration_only.json()["linked_distance_metres"] is None


def test_confirmation_revalidates_eligibility_and_distance_presence(client: TestClient) -> None:
    run = create_run(client)
    no_distance = create_activity(
        client, start="2026-09-20T10:00:00+00:00", distance=None
    )
    invalid_distance = client.post(
        f"/api/planned-runs/{run['id']}/linking/suggestions/{no_distance['id']}/confirm",
        json={"linked_distance_metres": 1},
    )
    assert invalid_distance.status_code == 409
    assert invalid_distance.json() == {
        "detail": "Distance cannot be linked because the activity has no recorded distance."
    }

    incompatible = create_activity(
        client, start="2026-09-24T10:00:00+00:00", modality="running"
    )
    stale = client.post(
        f"/api/planned-runs/{run['id']}/linking/suggestions/{incompatible['id']}/confirm",
        json={},
    )
    assert stale.status_code == 409
    assert stale.json() == {
        "detail": "These records are no longer eligible for this match suggestion."
    }


def test_concurrent_confirmations_cannot_overlink_activity(
    client: TestClient, database_url: str
) -> None:
    first_run = create_run(client)
    second_run = create_run(client)
    activity = create_activity(
        client, start="2026-09-20T10:00:00+00:00", duration=1800, distance=4000
    )

    def confirm(run_id: str):
        return client.post(
            f"/api/planned-runs/{run_id}/linking/suggestions/{activity['id']}/confirm",
            json={},
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(confirm, [first_run["id"], second_run["id"]]))

    assert sorted(response.status_code for response in responses) == [201, 409]
    with Session(create_engine(database_url)) as session:
        duration, distance = session.execute(
            select(
                func.sum(Link.linked_duration_seconds),
                func.sum(Link.linked_distance_metres),
            ).where(Link.completed_activity_id == activity["id"])
        ).one()
        assert duration == 1800
        assert distance == 4000


def test_concurrent_reject_and_confirm_cannot_both_succeed(client: TestClient) -> None:
    run = create_run(client)
    activity = create_activity(client, start="2026-09-20T10:00:00+00:00")
    base_url = f"/api/planned-runs/{run['id']}/linking/suggestions/{activity['id']}"

    with ThreadPoolExecutor(max_workers=2) as executor:
        reject_future = executor.submit(client.post, f"{base_url}/reject")
        confirm_future = executor.submit(client.post, f"{base_url}/confirm", json={})
        responses = [reject_future.result(), confirm_future.result()]

    assert len([response for response in responses if response.status_code in (200, 201)]) == 1
    assert len([response for response in responses if response.status_code == 409]) == 1
    assert client.get(
        f"/api/planned-runs/{run['id']}/linking/suggestions"
    ).json() == []


def test_linking_is_available_to_a_restarted_client(client: TestClient) -> None:
    run = create_run(client)
    activity = create_activity(client, start="2026-09-20T10:00:00+00:00")
    response = client.post(
        f"/api/planned-runs/{run['id']}/linking/suggestions/{activity['id']}/confirm",
        json={},
    )
    assert response.status_code == 201

    with TestClient(app) as restarted_client:
        evidence = restarted_client.get(
            f"/api/planned-runs/{run['id']}/linking"
        ).json()
        assert evidence["links"][0]["link"]["completed_activity_id"] == activity["id"]
        assert restarted_client.get(f"/api/activities/{activity['id']}").json()[
            "link_status"
        ] == "linked"


def test_direct_links_represent_split_and_combined_evidence(client: TestClient) -> None:
    first_run = create_run(client, "2026-09-20")
    second_run = create_run(client, "2026-09-24")
    combined_activity = create_activity(
        client,
        start="2026-09-22T08:00:00+00:00",
        duration=5400,
        distance=12_000,
        title="Combined recording",
    )
    split_activity = create_activity(
        client,
        start="2026-09-20T18:00:00+00:00",
        duration=1200,
        distance=3000,
        title="Second recording",
    )
    direct_url = f"/api/activities/{combined_activity['id']}/linking/links"

    first = client.post(
        direct_url,
        json={
            "planned_session_id": first_run["id"],
            "linked_duration_seconds": 2400,
            "linked_distance_metres": 5000,
        },
    )
    second = client.post(
        direct_url,
        json={
            "planned_session_id": second_run["id"],
            "linked_duration_seconds": 1800,
            "linked_distance_metres": 4000,
        },
    )
    split = client.post(
        f"/api/activities/{split_activity['id']}/linking/links",
        json={
            "planned_session_id": first_run["id"],
            "linked_duration_seconds": 1200,
            "linked_distance_metres": 3000,
        },
    )

    assert [first.status_code, second.status_code, split.status_code] == [201, 201, 201]
    assert first.json()["confirmation_source"] == "direct"
    assert first.json()["version"] == 1
    activity_evidence = client.get(
        f"/api/activities/{combined_activity['id']}/linking"
    ).json()
    assert [item["planned_run"]["id"] for item in activity_evidence["links"]] == [
        first_run["id"],
        second_run["id"],
    ]
    assert activity_evidence["remaining_duration_seconds"] == 1200
    assert activity_evidence["remaining_distance_metres"] == 3000
    first_run_evidence = client.get(
        f"/api/planned-runs/{first_run['id']}/linking"
    ).json()
    assert len(first_run_evidence["links"]) == 2
    assert first_run_evidence["total_linked_duration_seconds"] == 3600
    assert first_run_evidence["total_linked_distance_metres"] == 8000
    assert first_run_evidence["duration_difference_seconds"] == 0
    assert first_run_evidence["distance_difference_metres"] == 2000
    assert first_run_evidence["links"][0]["activity"]["link_status"] in {
        "partly_linked",
        "linked",
    }


def test_direct_link_adjustment_removal_and_stale_write(client: TestClient) -> None:
    run = create_run(client, "2026-09-20")
    activity = create_activity(
        client, start="2026-09-28T08:00:00+00:00", duration=3600, distance=8000
    )
    links_url = f"/api/activities/{activity['id']}/linking/links"
    created = client.post(
        links_url,
        json={
            "planned_session_id": run["id"],
            "linked_duration_seconds": 1200,
            "linked_distance_metres": 2000,
        },
    )
    assert created.status_code == 201
    link = created.json()

    updated = client.put(
        f"{links_url}/{link['id']}",
        json={
            "linked_duration_seconds": 1800,
            "linked_distance_metres": 3000,
            "expected_version": 1,
        },
    )
    assert updated.status_code == 200
    assert updated.json()["version"] == 2

    stale = client.put(
        f"{links_url}/{link['id']}",
        json={
            "linked_duration_seconds": 2400,
            "linked_distance_metres": 4000,
            "expected_version": 1,
        },
    )
    assert stale.status_code == 409
    assert stale.json() == {
        "detail": "This link changed since it was loaded. Reload and try again."
    }

    removed = client.delete(
        f"{links_url}/{link['id']}", params={"expected_version": 2}
    )
    assert removed.status_code == 204
    evidence = client.get(f"/api/activities/{activity['id']}/linking").json()
    assert evidence["links"] == []
    assert evidence["remaining_duration_seconds"] == 3600
    assert evidence["remaining_distance_metres"] == 8000
    assert client.get(f"/api/activities/{activity['id']}").json()[
        "link_status"
    ] == "unmatched"


def test_direct_link_revalidates_aggregate_capacity_and_duplicates(
    client: TestClient,
) -> None:
    first_run = create_run(client)
    second_run = create_run(client)
    activity = create_activity(
        client, start="2026-09-20T08:00:00+00:00", duration=1800, distance=4000
    )
    url = f"/api/activities/{activity['id']}/linking/links"
    payload = {
        "planned_session_id": first_run["id"],
        "linked_duration_seconds": 1200,
        "linked_distance_metres": 3000,
    }
    assert client.post(url, json=payload).status_code == 201

    duplicate = client.post(url, json=payload)
    assert duplicate.status_code == 409
    assert duplicate.json() == {
        "detail": "This Planned Session and Completed Activity are already linked."
    }
    overlinked = client.post(
        url,
        json={
            "planned_session_id": second_run["id"],
            "linked_duration_seconds": 601,
            "linked_distance_metres": 1001,
        },
    )
    assert overlinked.status_code == 409
    assert "remaining 600 seconds" in overlinked.json()["detail"]

    no_distance = create_activity(
        client, start="2026-09-20T09:00:00+00:00", distance=None
    )
    invalid_distance = client.post(
        f"/api/activities/{no_distance['id']}/linking/links",
        json={
            "planned_session_id": second_run["id"],
            "linked_duration_seconds": 600,
            "linked_distance_metres": 1,
        },
    )
    assert invalid_distance.status_code == 409
    assert invalid_distance.json() == {
        "detail": "Distance cannot be linked because the activity has no recorded distance."
    }


def test_concurrent_direct_links_cannot_overlink_activity(
    client: TestClient, database_url: str
) -> None:
    first_run = create_run(client)
    second_run = create_run(client)
    activity = create_activity(
        client, start="2026-09-20T08:00:00+00:00", duration=1800, distance=4000
    )
    url = f"/api/activities/{activity['id']}/linking/links"

    def link(run_id: str):
        return client.post(
            url,
            json={
                "planned_session_id": run_id,
                "linked_duration_seconds": 1200,
                "linked_distance_metres": 3000,
            },
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(link, [first_run["id"], second_run["id"]]))

    assert sorted(response.status_code for response in responses) == [201, 409]
    with Session(create_engine(database_url)) as session:
        duration, distance = session.execute(
            select(
                func.sum(Link.linked_duration_seconds),
                func.sum(Link.linked_distance_metres),
            ).where(Link.completed_activity_id == activity["id"])
        ).one()
        assert duration == 1200
        assert distance == 3000


def test_direct_links_are_available_to_a_restarted_client(client: TestClient) -> None:
    run = create_run(client)
    activity = create_activity(
        client, start="2026-09-22T08:00:00+00:00", duration=2400, distance=5000
    )
    created = client.post(
        f"/api/activities/{activity['id']}/linking/links",
        json={
            "planned_session_id": run["id"],
            "linked_duration_seconds": 1200,
            "linked_distance_metres": 2000,
        },
    )
    assert created.status_code == 201

    with TestClient(app) as restarted_client:
        evidence = restarted_client.get(
            f"/api/activities/{activity['id']}/linking"
        ).json()
        assert evidence["links"][0]["link"]["id"] == created.json()["id"]
        assert evidence["remaining_duration_seconds"] == 1200
        assert evidence["remaining_distance_metres"] == 3000


def test_planned_distance_is_not_compared_when_any_link_omits_distance(
    client: TestClient,
) -> None:
    run = create_run(client)
    first_activity = create_activity(
        client, start="2026-09-20T08:00:00+00:00", duration=1800, distance=5000
    )
    second_activity = create_activity(
        client, start="2026-09-20T10:00:00+00:00", duration=1800, distance=5000
    )
    for activity, distance in ((first_activity, 4000), (second_activity, None)):
        response = client.post(
            f"/api/activities/{activity['id']}/linking/links",
            json={
                "planned_session_id": run["id"],
                "linked_duration_seconds": 1800,
                "linked_distance_metres": distance,
            },
        )
        assert response.status_code == 201

    evidence = client.get(f"/api/planned-runs/{run['id']}/linking").json()
    assert evidence["total_linked_duration_seconds"] == 3600
    assert evidence["duration_difference_seconds"] == 0
    assert evidence["total_linked_distance_metres"] is None
    assert evidence["distance_difference_metres"] is None
