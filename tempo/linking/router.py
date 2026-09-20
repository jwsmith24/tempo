from datetime import UTC, datetime
from collections.abc import Callable

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from tempo.activities.models import CompletedActivity
from tempo.activities.corrections import effective_activity
from tempo.activities.router import activity_link_status, activity_response
from tempo.database import get_session
from tempo.linking.models import CheckIn, LegacyLinkRecord, LegacyLinkResolution, Link, SessionOutcome
from tempo.linking.schemas import (
    ActivityLinkRead,
    ActivityLinkingRead,
    CheckInCreate,
    CheckInRead,
    DirectLinkCreate,
    LegacyLinkRecordRead,
    LegacyResolutionRead,
    LegacyResolutionRequest,
    LinkActivityEvidenceRead,
    LinkChange,
    LinkEvidenceRead,
    LinkRead,
    LinkRemove,
    MatchCandidateRead,
    SessionOutcomeCreate,
    SessionOutcomeRead,
)
from tempo.linking.service import (
    ALGORITHM_VERSION,
    LinkConflict,
    change_link,
    confirm_candidate,
    create_direct_link as create_direct,
    list_candidates,
    load_planned_session,
    reasons_for,
    remove_link,
)
from tempo.planning.models import PlannedSession

router = APIRouter(prefix="/api/planned-runs", tags=["linking"])
activity_router = APIRouter(prefix="/api/activities", tags=["linking"])


def require_activity(session: Session, activity_id: str) -> CompletedActivity:
    activity = session.get(CompletedActivity, activity_id)
    if activity is None:
        raise HTTPException(status_code=404, detail="Completed Activity not found.")
    return activity


def require_plan(session: Session, planned_session_id: str) -> PlannedSession:
    planned_session = load_planned_session(session, planned_session_id)
    if planned_session is None:
        raise HTTPException(status_code=404, detail="Planned Run not found.")
    return planned_session


def link_read(link: Link) -> LinkRead:
    return LinkRead(
        id=link.id,
        planned_session_id=link.planned_session_id,
        completed_activity_id=link.completed_activity_id,
        source=link.source,
        algorithm_version=link.algorithm_version,
        reasons=reasons_for(link),
        version=link.version,
        created_at=link.created_at,
    )


def legacy_read(session: Session, resolution: LegacyLinkResolution) -> LegacyResolutionRead:
    records = []
    for record in session.scalars(
        select(LegacyLinkRecord)
        .where(LegacyLinkRecord.resolution_id == resolution.id)
        .order_by(LegacyLinkRecord.created_at, LegacyLinkRecord.id)
    ):
        planned_run = require_plan(session, record.planned_session_id)
        records.append(
            LegacyLinkRecordRead(
                id=record.id,
                planned_session_id=record.planned_session_id,
                planned_run=planned_run,
                linked_duration_seconds=record.linked_duration_seconds,
                linked_distance_metres=record.linked_distance_metres,
                confirmation_source=record.confirmation_source,
                version=record.version,
                created_at=record.created_at,
            )
        )
    return LegacyResolutionRead(
        id=resolution.id,
        status=resolution.status,
        selected_planned_session_id=resolution.selected_planned_session_id,
        resolved_at=resolution.resolved_at,
        records=records,
    )


def outcome_read(outcome: SessionOutcome) -> SessionOutcomeRead:
    return SessionOutcomeRead.model_validate(outcome)


def check_in_read(check_in: CheckIn) -> CheckInRead:
    return CheckInRead.model_validate(check_in)


@router.post("/{planned_session_id}/outcomes", response_model=SessionOutcomeRead, status_code=status.HTTP_201_CREATED)
def record_session_outcome(
    planned_session_id: str,
    request: SessionOutcomeCreate,
    session: Session = Depends(get_session),
) -> SessionOutcomeRead:
    require_plan(session, planned_session_id)
    outcome = SessionOutcome(
        planned_session_id=planned_session_id,
        disposition=request.disposition,
        reason=request.reason,
        recorded_at=datetime.now(UTC),
    )
    session.add(outcome)
    session.commit()
    session.refresh(outcome)
    return outcome_read(outcome)


@router.post("/{planned_session_id}/check-ins", response_model=CheckInRead, status_code=status.HTTP_201_CREATED)
def record_check_in(
    planned_session_id: str,
    request: CheckInCreate,
    session: Session = Depends(get_session),
) -> CheckInRead:
    require_plan(session, planned_session_id)
    check_in = CheckIn(
        planned_session_id=planned_session_id,
        readiness=request.readiness,
        post_session_effort=request.post_session_effort,
        feel=request.feel,
        notes=request.notes,
        recorded_at=datetime.now(UTC),
    )
    session.add(check_in)
    session.commit()
    session.refresh(check_in)
    return check_in_read(check_in)


@activity_router.get("/{activity_id}/linking", response_model=ActivityLinkingRead)
def get_activity_linking(
    activity_id: str, session: Session = Depends(get_session)
) -> ActivityLinkingRead:
    activity = require_activity(session, activity_id)
    link = session.scalar(select(Link).where(Link.completed_activity_id == activity_id))
    activity_link = None
    if link is not None:
        activity_link = ActivityLinkRead(
            link=link_read(link), planned_run=require_plan(session, link.planned_session_id)
        )
    resolution = session.scalar(
        select(LegacyLinkResolution).where(
            LegacyLinkResolution.completed_activity_id == activity_id
        )
    )
    return ActivityLinkingRead(
        activity=activity_response(session, activity, activity_link_status(session, activity_id)),
        link=activity_link,
        candidates=[
            MatchCandidateRead(
                planned_run=planned_run,
                algorithm_version=ALGORITHM_VERSION,
                reasons=reasons,
            )
            for planned_run, reasons in list_candidates(session, effective_activity(session, activity))
        ],
        legacy_resolution=legacy_read(session, resolution) if resolution else None,
    )


def mutate_link(
    session: Session, operation: Callable[[], Link]
) -> Link:
    try:
        link = operation()
        session.commit()
        session.refresh(link)
        return link
    except LinkConflict as error:
        session.rollback()
        raise HTTPException(status_code=409, detail=str(error)) from error


@activity_router.post(
    "/{activity_id}/linking/candidates/{planned_session_id}/confirm",
    response_model=LinkRead,
    status_code=status.HTTP_201_CREATED,
)
def confirm_match(
    activity_id: str,
    planned_session_id: str,
    session: Session = Depends(get_session),
) -> LinkRead:
    session.connection().exec_driver_sql("BEGIN IMMEDIATE")
    activity = require_activity(session, activity_id)
    planned_session = require_plan(session, planned_session_id)
    return link_read(
        mutate_link(session, lambda: confirm_candidate(session, planned_session, activity))
    )


@activity_router.post(
    "/{activity_id}/linking/link",
    response_model=LinkRead,
    status_code=status.HTTP_201_CREATED,
)
def create_direct_link(
    activity_id: str,
    request: DirectLinkCreate,
    session: Session = Depends(get_session),
) -> LinkRead:
    session.connection().exec_driver_sql("BEGIN IMMEDIATE")
    activity = require_activity(session, activity_id)
    planned_session = require_plan(session, request.planned_session_id)
    return link_read(mutate_link(session, lambda: create_direct(session, planned_session, activity)))


@activity_router.put("/{activity_id}/linking/link", response_model=LinkRead)
def change_current_link(
    activity_id: str,
    request: LinkChange,
    session: Session = Depends(get_session),
) -> LinkRead:
    session.connection().exec_driver_sql("BEGIN IMMEDIATE")
    require_activity(session, activity_id)
    link = session.scalar(select(Link).where(Link.completed_activity_id == activity_id))
    if link is None:
        raise HTTPException(status_code=404, detail="Link not found.")
    planned_session = require_plan(session, request.planned_session_id)
    return link_read(
        mutate_link(
            session,
            lambda: change_link(session, link, planned_session, request.expected_version),
        )
    )


@activity_router.delete(
    "/{activity_id}/linking/link", status_code=status.HTTP_204_NO_CONTENT
)
def remove_current_link(
    activity_id: str,
    request: LinkRemove,
    session: Session = Depends(get_session),
) -> None:
    session.connection().exec_driver_sql("BEGIN IMMEDIATE")
    require_activity(session, activity_id)
    link = session.scalar(select(Link).where(Link.completed_activity_id == activity_id))
    if link is None:
        raise HTTPException(status_code=404, detail="Link not found.")
    try:
        remove_link(session, link, request.expected_version)
        session.commit()
    except LinkConflict as error:
        session.rollback()
        raise HTTPException(status_code=409, detail=str(error)) from error


@activity_router.post(
    "/{activity_id}/linking/legacy-resolution", response_model=ActivityLinkingRead
)
def resolve_legacy_links(
    activity_id: str,
    request: LegacyResolutionRequest,
    session: Session = Depends(get_session),
) -> ActivityLinkingRead:
    session.connection().exec_driver_sql("BEGIN IMMEDIATE")
    activity = require_activity(session, activity_id)
    resolution = session.scalar(
        select(LegacyLinkResolution).where(
            LegacyLinkResolution.completed_activity_id == activity_id,
            LegacyLinkResolution.status == "unresolved",
        )
    )
    if resolution is None:
        raise HTTPException(status_code=409, detail="No unresolved legacy Links remain.")
    if request.planned_session_id is not None:
        preserved = session.scalar(
            select(LegacyLinkRecord.id).where(
                LegacyLinkRecord.resolution_id == resolution.id,
                LegacyLinkRecord.planned_session_id == request.planned_session_id,
            )
        )
        if preserved is None:
            raise HTTPException(status_code=409, detail="Select one of the preserved legacy Links.")
        planned_session = require_plan(session, request.planned_session_id)
        try:
            create_direct(session, planned_session, activity, allow_legacy_resolution=True)
        except LinkConflict as error:
            session.rollback()
            raise HTTPException(status_code=409, detail=str(error)) from error
    resolution.status = "resolved"
    resolution.selected_planned_session_id = request.planned_session_id
    resolution.resolved_at = datetime.now(UTC)
    session.commit()
    return get_activity_linking(activity_id, session)


@router.get("/{planned_session_id}/linking", response_model=LinkEvidenceRead)
def get_link_evidence(
    planned_session_id: str, session: Session = Depends(get_session)
) -> LinkEvidenceRead:
    planned_session = require_plan(session, planned_session_id)
    links = list(
        session.scalars(
            select(Link)
            .where(Link.planned_session_id == planned_session_id)
            .order_by(Link.created_at, Link.id)
        )
    )
    evidence = []
    total_duration = 0
    distances = []
    for link in links:
        activity = require_activity(session, link.completed_activity_id)
        effective = effective_activity(session, activity)
        total_duration += effective.duration_seconds
        distances.append(effective.distance_metres)
        evidence.append(
            LinkActivityEvidenceRead(
                link=link_read(link),
                activity=activity_response(session, activity, "linked"),
            )
        )
    total_distance = (
        sum(distance for distance in distances if distance is not None)
        if links and all(distance is not None for distance in distances)
        else None
    )
    revision = planned_session.active_revision
    outcomes = list(
        session.scalars(
            select(SessionOutcome)
            .where(SessionOutcome.planned_session_id == planned_session_id)
            .order_by(SessionOutcome.recorded_at, SessionOutcome.id)
        )
    )
    check_ins = list(
        session.scalars(
            select(CheckIn)
            .where(CheckIn.planned_session_id == planned_session_id)
            .order_by(CheckIn.recorded_at, CheckIn.id)
        )
    )
    return LinkEvidenceRead(
        planned_run=planned_session,
        links=evidence,
        total_duration_seconds=total_duration,
        total_distance_metres=total_distance,
        duration_difference_seconds=(
            revision.duration_seconds - total_duration
            if revision and revision.duration_seconds is not None and links
            else None
        ),
        distance_difference_metres=(
            revision.distance_metres - total_distance
            if revision and revision.distance_metres is not None and total_distance is not None
            else None
        ),
        session_outcome=outcome_read(outcomes[-1]) if outcomes else None,
        session_outcome_history=[outcome_read(outcome) for outcome in outcomes],
        check_in=check_in_read(check_ins[-1]) if check_ins else None,
        check_in_history=[check_in_read(check_in) for check_in in check_ins],
    )
