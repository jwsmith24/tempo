from datetime import date, datetime

from tempo.activities.models import CompletedActivity
from tempo.linking.service import candidate_sort_key, match_reasons
from tempo.planning.models import PlannedSession


def activity(activity_id: str, start: str) -> CompletedActivity:
    return CompletedActivity(
        id=activity_id,
        modality="running",
        start_instant=datetime.fromisoformat(start),
        duration_seconds=1800,
        entry_source="manual",
        creation_provenance="athlete_entry",
        created_at=datetime.fromisoformat("2026-09-20T00:00:00+00:00"),
    )


def test_candidate_ranking_uses_recorded_offset_noon_then_stable_id() -> None:
    observed = activity("activity", "2026-09-20T15:00:00+05:30")
    same_day = PlannedSession(id="b", modality="running", scheduled_date=date(2026, 9, 20))
    adjacent = PlannedSession(id="a", modality="running", scheduled_date=date(2026, 9, 19))
    tied = PlannedSession(id="a", modality="running", scheduled_date=date(2026, 9, 20))

    assert candidate_sort_key(same_day, observed) < candidate_sort_key(adjacent, observed)
    assert candidate_sort_key(tied, observed) < candidate_sort_key(same_day, observed)
    assert candidate_sort_key(same_day, observed)[0] == 10_800


def test_suggestion_reasons_distinguish_same_and_adjacent_dates() -> None:
    planned_date = date(2026, 9, 20)

    assert match_reasons(planned_date, planned_date)[1] == (
        "The activity starts on the Planned Session date."
    )
    assert match_reasons(planned_date, date(2026, 9, 19))[1] == (
        "The activity starts within one adjacent calendar day."
    )
