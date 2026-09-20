from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from tempo.activities.models import CompletedActivity
from tempo.activities.schemas import CompletedActivityRead, ManualActivityCreate
from tempo.database import get_session

router = APIRouter(prefix="/api/activities", tags=["completed-activities"])


@router.post("", response_model=CompletedActivityRead, status_code=status.HTTP_201_CREATED)
def create_manual_activity(
    request: ManualActivityCreate, session: Session = Depends(get_session)
) -> CompletedActivity:
    activity = CompletedActivity(
        modality=request.modality.value,
        start_instant=request.start_instant,
        duration_seconds=request.duration_seconds,
        distance_metres=request.distance_metres,
        title=request.title or None,
        notes=request.notes or None,
        entry_source="manual",
        creation_provenance="athlete_entry",
        created_at=datetime.now(UTC),
    )
    session.add(activity)
    session.commit()
    session.refresh(activity)
    return activity


@router.get("", response_model=list[CompletedActivityRead])
def list_activities(session: Session = Depends(get_session)) -> list[CompletedActivity]:
    activities = list(session.scalars(select(CompletedActivity)))
    return sorted(
        activities,
        key=lambda activity: (activity.start_instant.timestamp(), activity.id),
        reverse=True,
    )


@router.get("/{activity_id}", response_model=CompletedActivityRead)
def get_activity(
    activity_id: str, session: Session = Depends(get_session)
) -> CompletedActivity:
    activity = session.get(CompletedActivity, activity_id)
    if activity is None:
        raise HTTPException(status_code=404, detail="Completed Activity not found.")
    return activity
