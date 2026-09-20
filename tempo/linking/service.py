import json
from datetime import UTC, date, datetime, time

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from tempo.activities.models import CompletedActivity
from tempo.linking.models import LegacyLinkResolution, Link, LinkDecision, MatchEvaluation
from tempo.planning.models import PlannedSession

ALGORITHM_VERSION = "stage1-date-noon-v2"


class LinkConflict(ValueError):
    pass


def load_planned_session(session: Session, planned_session_id: str) -> PlannedSession | None:
    return session.scalar(
        select(PlannedSession)
        .where(PlannedSession.id == planned_session_id)
        .options(selectinload(PlannedSession.active_revision))
    )


def match_reasons(planned_date: date, activity_date: date) -> list[str]:
    timing = (
        "The activity starts on the Planned Session date."
        if activity_date == planned_date
        else "The activity starts within one adjacent calendar day."
    )
    return ["Both records have running modality.", timing, "The activity has no current Link."]


def candidate_sort_key(planned_session: PlannedSession, activity: CompletedActivity) -> tuple[float, str]:
    local_noon = datetime.combine(
        planned_session.scheduled_date, time(12), tzinfo=activity.start_instant.tzinfo
    )
    return abs((activity.start_instant - local_noon).total_seconds()), planned_session.id


def current_link(session: Session, activity_id: str) -> Link | None:
    return session.scalar(select(Link).where(Link.completed_activity_id == activity_id))


def unresolved_legacy(session: Session, activity_id: str) -> LegacyLinkResolution | None:
    return session.scalar(
        select(LegacyLinkResolution).where(
            LegacyLinkResolution.completed_activity_id == activity_id,
            LegacyLinkResolution.status == "unresolved",
        )
    )


def list_candidates(
    session: Session, activity: CompletedActivity
) -> list[tuple[PlannedSession, list[str]]]:
    if (
        activity.modality != "running"
        or current_link(session, activity.id) is not None
        or unresolved_legacy(session, activity.id) is not None
    ):
        return []
    candidates = []
    for planned_session in session.scalars(
        select(PlannedSession).options(selectinload(PlannedSession.active_revision))
    ):
        if planned_session.modality != "running":
            continue
        if abs((activity.start_instant.date() - planned_session.scheduled_date).days) > 1:
            continue
        candidates.append(
            (
                candidate_sort_key(planned_session, activity),
                planned_session,
                match_reasons(planned_session.scheduled_date, activity.start_instant.date()),
            )
        )
    candidates.sort(key=lambda item: item[0])
    return [(item[1], item[2]) for item in candidates]


def _new_link(
    session: Session,
    planned_session: PlannedSession,
    activity: CompletedActivity,
    source: str,
    algorithm_version: str | None = None,
    reasons: list[str] | None = None,
    allow_legacy_resolution: bool = False,
) -> Link:
    if current_link(session, activity.id) is not None:
        raise LinkConflict("This Completed Activity already has a Link.")
    if not allow_legacy_resolution and unresolved_legacy(session, activity.id) is not None:
        raise LinkConflict("Resolve the preserved legacy Links before creating a current Link.")
    link = Link(
        planned_session_id=planned_session.id,
        completed_activity_id=activity.id,
        source=source,
        algorithm_version=algorithm_version,
        reasons=json.dumps(reasons or []),
        created_at=datetime.now(UTC),
    )
    session.add(link)
    try:
        session.flush()
    except IntegrityError as error:
        raise LinkConflict("This Completed Activity already has a Link.") from error
    return link


def evaluate_after_ingestion(session: Session, activity: CompletedActivity) -> Link | None:
    candidates = list_candidates(session, activity)
    session.add(
        MatchEvaluation(
            completed_activity_id=activity.id,
            activity_effective_version=activity.created_at.astimezone(UTC).isoformat(),
            algorithm_version=ALGORITHM_VERSION,
            candidate_results=json.dumps(
                [
                    {"planned_session_id": planned_session.id, "reasons": reasons}
                    for planned_session, reasons in candidates
                ]
            ),
            evaluated_at=datetime.now(UTC),
        )
    )
    if len(candidates) != 1:
        return None
    planned_session, reasons = candidates[0]
    return _new_link(
        session, planned_session, activity, "automatic", ALGORITHM_VERSION, reasons
    )


def confirm_candidate(
    session: Session, planned_session: PlannedSession, activity: CompletedActivity
) -> Link:
    candidate = next(
        ((plan, reasons) for plan, reasons in list_candidates(session, activity) if plan.id == planned_session.id),
        None,
    )
    if candidate is None:
        raise LinkConflict("These records are no longer eligible for this match candidate.")
    return _new_link(
        session,
        planned_session,
        activity,
        "athlete_confirmed",
        ALGORITHM_VERSION,
        candidate[1],
    )


def create_direct_link(
    session: Session,
    planned_session: PlannedSession,
    activity: CompletedActivity,
    allow_legacy_resolution: bool = False,
) -> Link:
    return _new_link(
        session,
        planned_session,
        activity,
        "direct",
        allow_legacy_resolution=allow_legacy_resolution,
    )


def change_link(
    session: Session, link: Link, planned_session: PlannedSession, expected_version: int
) -> Link:
    if link.version != expected_version:
        raise LinkConflict("This Link changed since it was loaded. Reload and try again.")
    session.add(
        LinkDecision(
            completed_activity_id=link.completed_activity_id,
            link_id=link.id,
            action="changed",
            prior_planned_session_id=link.planned_session_id,
            planned_session_id=planned_session.id,
            prior_source=link.source,
            prior_algorithm_version=link.algorithm_version,
            prior_reasons=link.reasons,
            decided_at=datetime.now(UTC),
        )
    )
    link.planned_session_id = planned_session.id
    link.source = "direct"
    link.algorithm_version = None
    link.reasons = "[]"
    link.version += 1
    session.flush()
    return link


def reasons_for(link: Link) -> list[str]:
    return json.loads(link.reasons or "[]")


def remove_link(session: Session, link: Link, expected_version: int) -> None:
    if link.version != expected_version:
        raise LinkConflict("This Link changed since it was loaded. Reload and try again.")
    session.add(
        LinkDecision(
            completed_activity_id=link.completed_activity_id,
            link_id=link.id,
            action="removed",
            prior_planned_session_id=link.planned_session_id,
            planned_session_id=None,
            prior_source=link.source,
            prior_algorithm_version=link.algorithm_version,
            prior_reasons=link.reasons,
            decided_at=datetime.now(UTC),
        )
    )
    session.delete(link)
