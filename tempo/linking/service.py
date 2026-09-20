from datetime import UTC, date, datetime, time

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from tempo.activities.models import CompletedActivity
from tempo.planning.models import PlannedSession
from tempo.linking.models import Link, SuggestionRejection

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


def linked_totals(
    session: Session, activity_id: str, exclude_link_id: str | None = None
) -> tuple[int, int]:
    criteria = [Link.completed_activity_id == activity_id]
    if exclude_link_id is not None:
        criteria.append(Link.id != exclude_link_id)
    duration, distance = session.execute(
        select(
            func.coalesce(func.sum(Link.linked_duration_seconds), 0),
            func.coalesce(func.sum(Link.linked_distance_metres), 0),
        ).where(*criteria)
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
        "The activity has remaining duration available for linking.",
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
        linked_duration, linked_distance = linked_totals(session, activity.id)
        remaining_duration = activity.duration_seconds - linked_duration
        if remaining_duration <= 0:
            continue
        existing_pair = session.scalar(
            select(Link.id).where(
                Link.planned_session_id == planned_session.id,
                Link.completed_activity_id == activity.id,
            )
        )
        if existing_pair is not None:
            continue
        remaining_distance = (
            activity.distance_metres - linked_distance
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


class LinkConflict(ValueError):
    pass


def validate_capacity(
    session: Session,
    activity: CompletedActivity,
    duration: int,
    distance: int | None,
    exclude_link_id: str | None = None,
) -> None:
    linked_duration, linked_distance = linked_totals(
        session, activity.id, exclude_link_id
    )
    remaining_duration = activity.duration_seconds - linked_duration
    if duration > remaining_duration:
        raise LinkConflict(
            f"Linked duration exceeds the activity's remaining {remaining_duration} seconds."
        )
    if distance is not None and activity.distance_metres is None:
        raise LinkConflict(
            "Distance cannot be linked because the activity has no recorded distance."
        )
    remaining_distance = (
        activity.distance_metres - linked_distance
        if activity.distance_metres is not None
        else None
    )
    if distance is not None and remaining_distance is not None and distance > remaining_distance:
        raise LinkConflict(
            f"Linked distance exceeds the activity's remaining {remaining_distance} metres."
        )


def create_link(
    session: Session,
    planned_session: PlannedSession,
    activity: CompletedActivity,
    duration: int,
    distance: int | None,
    confirmation_source: str,
) -> Link:
    existing = session.scalar(
        select(Link.id).where(
            Link.planned_session_id == planned_session.id,
            Link.completed_activity_id == activity.id,
        )
    )
    if existing is not None:
        raise LinkConflict(
            "This Planned Session and Completed Activity are already linked."
        )
    validate_capacity(session, activity, duration, distance)
    link = Link(
        planned_session_id=planned_session.id,
        completed_activity_id=activity.id,
        linked_duration_seconds=duration,
        linked_distance_metres=distance,
        confirmation_source=confirmation_source,
        version=1,
        created_at=datetime.now(UTC),
    )
    session.add(link)
    try:
        session.commit()
    except IntegrityError as error:
        session.rollback()
        raise LinkConflict(
            "This Planned Session and Completed Activity are already linked."
        ) from error
    session.refresh(link)
    return link


def update_link(
    session: Session,
    link: Link,
    activity: CompletedActivity,
    duration: int,
    distance: int | None,
    expected_version: int,
) -> Link:
    if link.version != expected_version:
        raise LinkConflict(
            "This link changed since it was loaded. Reload and try again."
        )
    validate_capacity(session, activity, duration, distance, link.id)
    link.linked_duration_seconds = duration
    link.linked_distance_metres = distance
    link.version += 1
    session.commit()
    session.refresh(link)
    return link


def remove_link(
    session: Session,
    link: Link,
    expected_version: int,
) -> None:
    if link.version != expected_version:
        raise LinkConflict(
            "This link changed since it was loaded. Reload and try again."
        )
    session.delete(link)
    session.commit()


def suggestion_is_eligible(
    session: Session, planned_session: PlannedSession, activity: CompletedActivity
) -> bool:
    return any(candidate.id == activity.id for candidate, *_ in list_suggestions(session, planned_session))


def reject_suggestion(
    session: Session, planned_session: PlannedSession, activity: CompletedActivity
) -> SuggestionRejection:
    revision = planned_session.active_revision
    if revision is None or not suggestion_is_eligible(session, planned_session, activity):
        raise LinkConflict("These records are no longer eligible for this match suggestion.")
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
        raise LinkConflict("The suggestion decision could not be saved.") from error
    return rejection


def confirm_suggestion(
    session: Session,
    planned_session: PlannedSession,
    activity: CompletedActivity,
    requested_duration: int | None,
    requested_distance: int | None,
    default_distance: bool,
) -> Link:
    existing = session.scalar(
        select(Link.id).where(
            Link.planned_session_id == planned_session.id,
            Link.completed_activity_id == activity.id,
        )
    )
    if existing is not None:
        raise LinkConflict(
            "This Planned Session and Completed Activity are already linked."
        )
    if not suggestion_is_eligible(session, planned_session, activity):
        raise LinkConflict("These records are no longer eligible for this match suggestion.")
    linked_duration, linked_distance = linked_totals(session, activity.id)
    remaining_duration = activity.duration_seconds - linked_duration
    remaining_distance = (
        activity.distance_metres - linked_distance
        if activity.distance_metres is not None
        else None
    )
    duration = requested_duration if requested_duration is not None else remaining_duration
    distance = remaining_distance if default_distance else requested_distance
    return create_link(
        session, planned_session, activity, duration, distance, "suggestion"
    )
