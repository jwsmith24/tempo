from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from tempo.database import get_session
from tempo.planning.models import PlannedSession, PrescriptionRevision
from tempo.planning.schemas import PlannedRunCreate, PlannedRunRead

router = APIRouter(prefix="/api/planned-runs", tags=["planned-runs"])


@router.post("", response_model=PlannedRunRead, status_code=status.HTTP_201_CREATED)
def create_planned_run(
    request: PlannedRunCreate, session: Session = Depends(get_session)
) -> PlannedSession:
    now = datetime.now(UTC)
    planned_session = PlannedSession(
        modality="running",
        scheduled_date=request.scheduled_date,
        training_intent=request.training_intent.value,
        priority=request.priority.value,
        notes=request.notes or None,
        created_at=now,
    )
    revision = PrescriptionRevision(
        planned_session=planned_session,
        revision_number=1,
        duration_seconds=request.duration_seconds,
        distance_metres=request.distance_metres,
        reason="initial_entry",
        provenance="athlete_entry",
        created_at=now,
    )
    session.add(planned_session)
    session.flush()
    planned_session.active_revision = revision
    session.commit()
    session.refresh(planned_session)
    return planned_session


@router.get("/{planned_run_id}", response_model=PlannedRunRead)
def get_planned_run(
    planned_run_id: str, session: Session = Depends(get_session)
) -> PlannedSession:
    planned_run = session.scalar(
        select(PlannedSession)
        .where(PlannedSession.id == planned_run_id)
        .options(selectinload(PlannedSession.active_revision))
    )
    if planned_run is None:
        raise HTTPException(status_code=404, detail="Planned Run not found.")
    return planned_run
