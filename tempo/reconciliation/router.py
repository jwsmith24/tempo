from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from tempo.activities.models import CompletedActivity
from tempo.activities.router import activity_reconciliation_status, activity_response
from tempo.database import get_session
from tempo.planning.models import PlannedSession
from tempo.reconciliation.models import ReconciliationAllocation
from tempo.reconciliation.schemas import (
    AllocationEvidenceRead,
    AllocationRead,
    ActivityMatchSuggestionRead,
    MatchSuggestionRead,
    ReconciliationEvidenceRead,
    SuggestionConfirm,
    SuggestionDecisionRead,
)
from tempo.reconciliation.service import (
    ALGORITHM_VERSION,
    ReconciliationConflict,
    allocated_totals,
    confirm_suggestion,
    list_suggestions,
    load_planned_session,
    reject_suggestion,
)

router = APIRouter(prefix="/api/planned-runs", tags=["reconciliation"])
activity_router = APIRouter(prefix="/api/activities", tags=["reconciliation"])


@activity_router.get(
    "/{activity_id}/reconciliation/suggestions",
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
    "/{planned_session_id}/reconciliation/suggestions",
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
                activity, activity_reconciliation_status(session, activity.id)
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


@router.post(
    "/{planned_session_id}/reconciliation/suggestions/{activity_id}/reject",
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
    except ReconciliationConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return SuggestionDecisionRead(decision="rejected")


@router.post(
    "/{planned_session_id}/reconciliation/suggestions/{activity_id}/confirm",
    response_model=AllocationRead,
    status_code=status.HTTP_201_CREATED,
)
def confirm_match_suggestion(
    planned_session_id: str,
    activity_id: str,
    request: SuggestionConfirm,
    session: Session = Depends(get_session),
) -> ReconciliationAllocation:
    # SQLite has no row-level locks; reserve the single writer before reading capacity.
    session.connection().exec_driver_sql("BEGIN IMMEDIATE")
    planned_session, activity = require_records(session, planned_session_id, activity_id)
    try:
        return confirm_suggestion(
            session,
            planned_session,
            activity,
            request.allocated_duration_seconds,
            request.allocated_distance_metres,
            "allocated_distance_metres" not in request.model_fields_set,
        )
    except ReconciliationConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.get(
    "/{planned_session_id}/reconciliation",
    response_model=ReconciliationEvidenceRead,
)
def get_reconciliation_evidence(
    planned_session_id: str, session: Session = Depends(get_session)
) -> ReconciliationEvidenceRead:
    planned_session = load_planned_session(session, planned_session_id)
    if planned_session is None:
        raise HTTPException(status_code=404, detail="Planned Run not found.")
    revision = planned_session.active_revision
    allocations = list(
        session.scalars(
            select(ReconciliationAllocation)
            .where(ReconciliationAllocation.planned_session_id == planned_session_id)
            .order_by(ReconciliationAllocation.created_at, ReconciliationAllocation.id)
        )
    )
    evidence: list[AllocationEvidenceRead] = []
    allocated_duration = 0
    allocated_distances: list[int] = []
    for allocation in allocations:
        activity = session.get(CompletedActivity, allocation.completed_activity_id)
        if activity is None:
            continue
        total_duration, total_distance = allocated_totals(session, activity.id)
        allocated_duration += allocation.allocated_duration_seconds
        if allocation.allocated_distance_metres is not None:
            allocated_distances.append(allocation.allocated_distance_metres)
        evidence.append(
            AllocationEvidenceRead(
                allocation=allocation,
                activity=activity_response(activity, "allocated"),
                unmatched_duration_seconds=activity.duration_seconds - total_duration,
                unmatched_distance_metres=(
                    activity.distance_metres - total_distance
                    if activity.distance_metres is not None
                    else None
                ),
            )
        )
    allocated_distance = sum(allocated_distances) if allocated_distances else None
    return ReconciliationEvidenceRead(
        planned_run=planned_session,
        allocations=evidence,
        allocated_duration_seconds=allocated_duration,
        allocated_distance_metres=allocated_distance,
        duration_difference_seconds=(
            revision.duration_seconds - allocated_duration
            if revision is not None and revision.duration_seconds is not None and allocations
            else None
        ),
        distance_difference_metres=(
            revision.distance_metres - allocated_distance
            if revision is not None
            and revision.distance_metres is not None
            and allocated_distance is not None
            else None
        ),
    )
