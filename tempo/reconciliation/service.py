from datetime import UTC, date, datetime, time

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from tempo.activities.models import CompletedActivity
from tempo.planning.models import PlannedSession
from tempo.reconciliation.models import ReconciliationAllocation, SuggestionRejection

ALGORITHM_VERSION = "stage1-date-noon-v1"


def activity_effective_version(activity: CompletedActivity) -> str:
    # Ticket 07 can advance this token when append-only Corrections are introduced.
    return activity.created_at.astimezone(UTC).isoformat()


def load_planned_session(session: Session, planned_session_id: str) -> PlannedSession | None:
    return session.scalar(
        select(PlannedSession)
        .where(PlannedSession.id == planned_session_id)
        .options(selectinload(PlannedSession.active_revision))
    )


def allocated_totals(session: Session, activity_id: str) -> tuple[int, int]:
    duration, distance = session.execute(
        select(
            func.coalesce(func.sum(ReconciliationAllocation.allocated_duration_seconds), 0),
            func.coalesce(func.sum(ReconciliationAllocation.allocated_distance_metres), 0),
        ).where(ReconciliationAllocation.completed_activity_id == activity_id)
    ).one()
    return int(duration), int(distance)


def suggestion_reasons(planned_date: date, activity_date: date) -> list[str]:
    timing = (
        "The activity starts on the Planned Session date."
        if activity_date == planned_date
        else "The activity starts within one adjacent calendar day."
    )
    return [
        "Both records have running modality.",
        timing,
        "The activity has unallocated duration available.",
    ]


def candidate_sort_key(planned_date: date, activity: CompletedActivity) -> tuple[float, str]:
    local_noon = datetime.combine(planned_date, time(12), tzinfo=activity.start_instant.tzinfo)
    return abs((activity.start_instant - local_noon).total_seconds()), activity.id


def list_suggestions(
    session: Session, planned_session: PlannedSession
) -> list[tuple[CompletedActivity, list[str], int, int | None]]:
    revision = planned_session.active_revision
    if revision is None or planned_session.modality != "running":
        return []
    rejected = set(
        session.execute(
            select(
                SuggestionRejection.completed_activity_id,
                SuggestionRejection.activity_effective_version,
            ).where(
                SuggestionRejection.prescription_revision_id == revision.id,
                SuggestionRejection.algorithm_version == ALGORITHM_VERSION,
            )
        ).all()
    )
    candidates: list[tuple[float, str, CompletedActivity, list[str], int, int | None]] = []
    for activity in session.scalars(select(CompletedActivity).options(selectinload(CompletedActivity.import_provenance))):
        activity_date = activity.start_instant.date()
        if activity.modality != "running" or abs((activity_date - planned_session.scheduled_date).days) > 1:
            continue
        if (activity.id, activity_effective_version(activity)) in rejected:
            continue
        allocated_duration, allocated_distance = allocated_totals(session, activity.id)
        remaining_duration = activity.duration_seconds - allocated_duration
        if remaining_duration <= 0:
            continue
        existing_pair = session.scalar(
            select(ReconciliationAllocation.id).where(
                ReconciliationAllocation.planned_session_id == planned_session.id,
                ReconciliationAllocation.completed_activity_id == activity.id,
            )
        )
        if existing_pair is not None:
            continue
        remaining_distance = (
            activity.distance_metres - allocated_distance
            if activity.distance_metres is not None
            else None
        )
        if remaining_distance is not None and remaining_distance <= 0:
            remaining_distance = None
        distance_from_noon, activity_id = candidate_sort_key(
            planned_session.scheduled_date, activity
        )
        candidates.append(
            (
                distance_from_noon,
                activity_id,
                activity,
                suggestion_reasons(planned_session.scheduled_date, activity_date),
                remaining_duration,
                remaining_distance,
            )
        )
    candidates.sort(key=lambda item: (item[0], item[1]))
    return [(item[2], item[3], item[4], item[5]) for item in candidates]


class ReconciliationConflict(ValueError):
    pass


def suggestion_is_eligible(
    session: Session, planned_session: PlannedSession, activity: CompletedActivity
) -> bool:
    return any(candidate.id == activity.id for candidate, *_ in list_suggestions(session, planned_session))


def reject_suggestion(
    session: Session, planned_session: PlannedSession, activity: CompletedActivity
) -> SuggestionRejection:
    revision = planned_session.active_revision
    if revision is None or not suggestion_is_eligible(session, planned_session, activity):
        raise ReconciliationConflict("These records are no longer eligible for this match suggestion.")
    rejection = SuggestionRejection(
        prescription_revision_id=revision.id,
        completed_activity_id=activity.id,
        activity_effective_version=activity_effective_version(activity),
        algorithm_version=ALGORITHM_VERSION,
        rejected_at=datetime.now(UTC),
    )
    session.add(rejection)
    try:
        session.commit()
    except IntegrityError as error:
        session.rollback()
        existing = session.scalar(
            select(SuggestionRejection).where(
                SuggestionRejection.prescription_revision_id == revision.id,
                SuggestionRejection.completed_activity_id == activity.id,
                SuggestionRejection.activity_effective_version
                == activity_effective_version(activity),
                SuggestionRejection.algorithm_version == ALGORITHM_VERSION,
            )
        )
        if existing is not None:
            return existing
        raise ReconciliationConflict("The suggestion decision could not be saved.") from error
    return rejection


def confirm_suggestion(
    session: Session,
    planned_session: PlannedSession,
    activity: CompletedActivity,
    requested_duration: int | None,
    requested_distance: int | None,
    default_distance: bool,
) -> ReconciliationAllocation:
    existing = session.scalar(
        select(ReconciliationAllocation).where(
            ReconciliationAllocation.planned_session_id == planned_session.id,
            ReconciliationAllocation.completed_activity_id == activity.id,
        )
    )
    if existing is not None:
        raise ReconciliationConflict(
            "This Planned Session and Completed Activity are already reconciled."
        )
    if not suggestion_is_eligible(session, planned_session, activity):
        raise ReconciliationConflict("These records are no longer eligible for this match suggestion.")
    allocated_duration, allocated_distance = allocated_totals(session, activity.id)
    remaining_duration = activity.duration_seconds - allocated_duration
    remaining_distance = (
        activity.distance_metres - allocated_distance
        if activity.distance_metres is not None
        else None
    )
    duration = requested_duration if requested_duration is not None else remaining_duration
    if duration > remaining_duration:
        raise ReconciliationConflict(
            f"Allocated duration exceeds the activity's remaining {remaining_duration} seconds."
        )
    if requested_distance is not None and remaining_distance is None:
        raise ReconciliationConflict(
            "Distance cannot be allocated because the activity has no recorded distance."
        )
    distance = remaining_distance if default_distance else requested_distance
    if distance is not None and remaining_distance is not None and distance > remaining_distance:
        raise ReconciliationConflict(
            f"Allocated distance exceeds the activity's remaining {remaining_distance} metres."
        )
    allocation = ReconciliationAllocation(
        planned_session_id=planned_session.id,
        completed_activity_id=activity.id,
        allocated_duration_seconds=duration,
        allocated_distance_metres=distance,
        confirmation_source="suggestion",
        created_at=datetime.now(UTC),
    )
    session.add(allocation)
    try:
        session.commit()
    except IntegrityError as error:
        session.rollback()
        raise ReconciliationConflict(
            "This Planned Session and Completed Activity are already reconciled."
        ) from error
    session.refresh(allocation)
    return allocation
