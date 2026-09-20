from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from tempo.activities.models import CompletedActivity
from tempo.activities.router import activity_link_status, activity_response
from tempo.database import get_session
from tempo.planning.models import PlannedSession
from tempo.linking.models import Link
from tempo.linking.schemas import (
    ActivityLinkRead,
    ActivityLinkingRead,
    ActivityMatchSuggestionRead,
    DirectLinkCreate,
    LinkActivityEvidenceRead,
    LinkEvidenceRead,
    LinkRead,
    LinkUpdate,
    MatchSuggestionRead,
    SuggestionConfirm,
    SuggestionDecisionRead,
)
from tempo.linking.service import (
    ALGORITHM_VERSION,
    LinkConflict,
    linked_totals,
    confirm_suggestion,
    create_link,
    list_suggestions,
    load_planned_session,
    reject_suggestion,
    remove_link,
    update_link,
)

router = APIRouter(prefix="/api/planned-runs", tags=["linking"])
activity_router = APIRouter(prefix="/api/activities", tags=["linking"])


@activity_router.get(
    "/{activity_id}/linking/suggestions",
    response_model=list[ActivityMatchSuggestionRead],
)
def get_activity_suggestions(
    activity_id: str, session: Session = Depends(get_session)
) -> list[ActivityMatchSuggestionRead]:
    activity = session.get(CompletedActivity, activity_id)
    if activity is None:
        raise HTTPException(status_code=404, detail="Completed Activity not found.")
    suggestions: list[tuple[float, str, ActivityMatchSuggestionRead]] = []
    for planned_session in session.scalars(select(PlannedSession)):
        candidate = next(
            (
                values
                for values in list_suggestions(session, planned_session)
                if values[0].id == activity.id
            ),
            None,
        )
        if candidate is None or planned_session.active_revision is None:
            continue
        _, reasons, duration, distance = candidate
        day_distance = abs((activity.start_instant.date() - planned_session.scheduled_date).days)
        suggestions.append(
            (
                day_distance,
                planned_session.id,
                ActivityMatchSuggestionRead(
                    activity_id=activity.id,
                    planned_run=planned_session,
                    algorithm_version=ALGORITHM_VERSION,
                    reasons=reasons,
                    proposed_duration_seconds=duration,
                    proposed_distance_metres=distance,
                ),
            )
        )
    suggestions.sort(key=lambda item: (item[0], item[1]))
    return [item[2] for item in suggestions]


@router.get(
    "/{planned_session_id}/linking/suggestions",
    response_model=list[MatchSuggestionRead],
)
def get_suggestions(
    planned_session_id: str, session: Session = Depends(get_session)
) -> list[MatchSuggestionRead]:
    planned_session = load_planned_session(session, planned_session_id)
    if planned_session is None:
        raise HTTPException(status_code=404, detail="Planned Run not found.")
    revision = planned_session.active_revision
    if revision is None:
        return []
    return [
        MatchSuggestionRead(
            planned_session_id=planned_session.id,
            prescription_revision_id=revision.id,
            activity=activity_response(
                activity, activity_link_status(session, activity.id)
            ),
            algorithm_version=ALGORITHM_VERSION,
            reasons=reasons,
            proposed_duration_seconds=duration,
            proposed_distance_metres=distance,
        )
        for activity, reasons, duration, distance in list_suggestions(session, planned_session)
    ]


def require_records(
    session: Session, planned_session_id: str, activity_id: str
) -> tuple[PlannedSession, CompletedActivity]:
    planned_session = load_planned_session(session, planned_session_id)
    if planned_session is None:
        raise HTTPException(status_code=404, detail="Planned Run not found.")
    activity = session.get(CompletedActivity, activity_id)
    if activity is None:
        raise HTTPException(status_code=404, detail="Completed Activity not found.")
    return planned_session, activity


def require_activity(session: Session, activity_id: str) -> CompletedActivity:
    activity = session.get(CompletedActivity, activity_id)
    if activity is None:
        raise HTTPException(status_code=404, detail="Completed Activity not found.")
    return activity


def require_link(session: Session, activity_id: str, link_id: str) -> Link:
    link = session.scalar(
        select(Link).where(
            Link.id == link_id,
            Link.completed_activity_id == activity_id,
        )
    )
    if link is None:
        raise HTTPException(status_code=404, detail="Link not found.")
    return link


@activity_router.get(
    "/{activity_id}/linking", response_model=ActivityLinkingRead
)
def get_activity_linking(
    activity_id: str, session: Session = Depends(get_session)
) -> ActivityLinkingRead:
    activity = require_activity(session, activity_id)
    links = list(
        session.scalars(
            select(Link)
            .where(Link.completed_activity_id == activity_id)
            .order_by(Link.created_at, Link.id)
        )
    )
    link_reads: list[ActivityLinkRead] = []
    for link in links:
        planned_session = load_planned_session(session, link.planned_session_id)
        if planned_session is not None:
            link_reads.append(ActivityLinkRead(link=link, planned_run=planned_session))
    linked_duration, linked_distance = linked_totals(session, activity_id)
    return ActivityLinkingRead(
        activity=activity_response(activity, activity_link_status(session, activity_id)),
        links=link_reads,
        remaining_duration_seconds=activity.duration_seconds - linked_duration,
        remaining_distance_metres=(
            activity.distance_metres - linked_distance
            if activity.distance_metres is not None
            else None
        ),
    )


@activity_router.post(
    "/{activity_id}/linking/links",
    response_model=LinkRead,
    status_code=status.HTTP_201_CREATED,
)
def create_direct_link(
    activity_id: str,
    request: DirectLinkCreate,
    session: Session = Depends(get_session),
) -> Link:
    session.connection().exec_driver_sql("BEGIN IMMEDIATE")
    planned_session, activity = require_records(
        session, request.planned_session_id, activity_id
    )
    try:
        return create_link(
            session,
            planned_session,
            activity,
            request.linked_duration_seconds,
            request.linked_distance_metres,
            "direct",
        )
    except LinkConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@activity_router.put(
    "/{activity_id}/linking/links/{link_id}",
    response_model=LinkRead,
)
def adjust_link(
    activity_id: str,
    link_id: str,
    request: LinkUpdate,
    session: Session = Depends(get_session),
) -> Link:
    session.connection().exec_driver_sql("BEGIN IMMEDIATE")
    activity = require_activity(session, activity_id)
    link = require_link(session, activity_id, link_id)
    try:
        return update_link(
            session,
            link,
            activity,
            request.linked_duration_seconds,
            request.linked_distance_metres,
            request.expected_version,
        )
    except LinkConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@activity_router.delete(
    "/{activity_id}/linking/links/{link_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_link(
    activity_id: str,
    link_id: str,
    expected_version: int,
    session: Session = Depends(get_session),
) -> None:
    session.connection().exec_driver_sql("BEGIN IMMEDIATE")
    require_activity(session, activity_id)
    link = require_link(session, activity_id, link_id)
    try:
        remove_link(session, link, expected_version)
    except LinkConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.post(
    "/{planned_session_id}/linking/suggestions/{activity_id}/reject",
    response_model=SuggestionDecisionRead,
)
def reject_match_suggestion(
    planned_session_id: str,
    activity_id: str,
    session: Session = Depends(get_session),
) -> SuggestionDecisionRead:
    session.connection().exec_driver_sql("BEGIN IMMEDIATE")
    planned_session, activity = require_records(session, planned_session_id, activity_id)
    try:
        reject_suggestion(session, planned_session, activity)
    except LinkConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return SuggestionDecisionRead(decision="rejected")


@router.post(
    "/{planned_session_id}/linking/suggestions/{activity_id}/confirm",
    response_model=LinkRead,
    status_code=status.HTTP_201_CREATED,
)
def confirm_match_suggestion(
    planned_session_id: str,
    activity_id: str,
    request: SuggestionConfirm,
    session: Session = Depends(get_session),
) -> Link:
    # SQLite has no row-level locks; reserve the single writer before reading capacity.
    session.connection().exec_driver_sql("BEGIN IMMEDIATE")
    planned_session, activity = require_records(session, planned_session_id, activity_id)
    try:
        return confirm_suggestion(
            session,
            planned_session,
            activity,
            request.linked_duration_seconds,
            request.linked_distance_metres,
            "linked_distance_metres" not in request.model_fields_set,
        )
    except LinkConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.get(
    "/{planned_session_id}/linking",
    response_model=LinkEvidenceRead,
)
def get_link_evidence(
    planned_session_id: str, session: Session = Depends(get_session)
) -> LinkEvidenceRead:
    planned_session = load_planned_session(session, planned_session_id)
    if planned_session is None:
        raise HTTPException(status_code=404, detail="Planned Run not found.")
    revision = planned_session.active_revision
    links = list(
        session.scalars(
            select(Link)
            .where(Link.planned_session_id == planned_session_id)
            .order_by(Link.created_at, Link.id)
        )
    )
    evidence: list[LinkActivityEvidenceRead] = []
    total_linked_duration = 0
    linked_distances: list[int] = []
    for link in links:
        activity = session.get(CompletedActivity, link.completed_activity_id)
        if activity is None:
            continue
        total_duration, total_distance = linked_totals(session, activity.id)
        total_linked_duration += link.linked_duration_seconds
        if link.linked_distance_metres is not None:
            linked_distances.append(link.linked_distance_metres)
        evidence.append(
            LinkActivityEvidenceRead(
                link=link,
                activity=activity_response(activity, activity_link_status(session, activity.id)),
                unmatched_duration_seconds=activity.duration_seconds - total_duration,
                unmatched_distance_metres=(
                    activity.distance_metres - total_distance
                    if activity.distance_metres is not None
                    else None
                ),
            )
        )
    total_linked_distance = (
        sum(linked_distances)
        if links and len(linked_distances) == len(links)
        else None
    )
    return LinkEvidenceRead(
        planned_run=planned_session,
        links=evidence,
        total_linked_duration_seconds=total_linked_duration,
        total_linked_distance_metres=total_linked_distance,
        duration_difference_seconds=(
            revision.duration_seconds - total_linked_duration
            if revision is not None and revision.duration_seconds is not None and links
            else None
        ),
        distance_difference_metres=(
            revision.distance_metres - total_linked_distance
            if revision is not None
            and revision.distance_metres is not None
            and total_linked_distance is not None
            else None
        ),
    )
