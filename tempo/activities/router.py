from datetime import UTC, datetime

import json

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tempo.activities.fit_adapter import FitImportError
from tempo.activities.import_service import ensure_raw_files, import_fit_activity
from tempo.activities.models import CompletedActivity
from tempo.activities.schemas import CompletedActivityRead, ImportProvenanceRead, ManualActivityCreate
from tempo.database import get_session

router = APIRouter(prefix="/api/activities", tags=["completed-activities"])
MAX_FIT_BYTES = 32 * 1024 * 1024
UPLOAD_CHUNK_BYTES = 1024 * 1024


def activity_response(
    activity: CompletedActivity, link_status: str = "unmatched"
) -> CompletedActivityRead:
    provenance = activity.import_provenance
    return CompletedActivityRead(
        id=activity.id,
        modality=activity.modality,
        start_instant=activity.start_instant,
        duration_seconds=activity.duration_seconds,
        distance_metres=activity.distance_metres,
        title=activity.title,
        notes=activity.notes,
        entry_source=activity.entry_source,
        creation_provenance=activity.creation_provenance,
        created_at=activity.created_at,
        link_status=link_status,
        import_provenance=(
            ImportProvenanceRead(
                adapter_type=provenance.adapter_type,
                source_identity=provenance.source_identity,
                importer_name=provenance.importer_name,
                importer_version=provenance.importer_version,
                imported_at=provenance.imported_at,
                raw_file_identity=provenance.raw_file_identity,
                checksum_sha256=provenance.checksum_sha256,
                original_normalized_values=json.loads(provenance.original_normalized_values),
            )
            if provenance is not None
            else None
        ),
    )


def activity_link_status(session: Session, activity_id: str) -> str:
    from tempo.linking.models import Link

    activity = session.get(CompletedActivity, activity_id)
    linked = session.scalar(
        select(func.coalesce(func.sum(Link.linked_duration_seconds), 0)).where(
            Link.completed_activity_id == activity_id
        )
    )
    if activity is None or not linked:
        return "unmatched"
    return "linked" if linked >= activity.duration_seconds else "partly_linked"


@router.post(
    "",
    response_model=CompletedActivityRead,
    response_model_exclude_none=True,
    status_code=status.HTTP_201_CREATED,
)
def create_manual_activity(
    request: ManualActivityCreate, session: Session = Depends(get_session)
) -> CompletedActivityRead:
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
    return activity_response(activity, activity_link_status(session, activity.id))


@router.post(
    "/imports/fit",
    response_model=CompletedActivityRead,
    response_model_exclude_none=True,
    status_code=status.HTTP_201_CREATED,
)
async def import_fit(
    file: UploadFile = File(...), session: Session = Depends(get_session)
) -> CompletedActivityRead:
    chunks: list[bytes] = []
    total = 0
    while chunk := await file.read(UPLOAD_CHUNK_BYTES):
        total += len(chunk)
        if total > MAX_FIT_BYTES:
            raise HTTPException(status_code=413, detail="FIT activity files must be 32 MB or smaller.")
        chunks.append(chunk)
    content = b"".join(chunks)
    if not content:
        raise HTTPException(status_code=422, detail="Choose a non-empty FIT activity file.")
    try:
        activity = import_fit_activity(content, session)
    except FitImportError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return activity_response(activity, activity_link_status(session, activity.id))


@router.get("", response_model=list[CompletedActivityRead], response_model_exclude_none=True)
def list_activities(session: Session = Depends(get_session)) -> list[CompletedActivityRead]:
    ensure_raw_files(session)
    activities = list(session.scalars(select(CompletedActivity)))
    sorted_activities = sorted(
        activities,
        key=lambda activity: (activity.start_instant.timestamp(), activity.id),
        reverse=True,
    )
    return [
        activity_response(activity, activity_link_status(session, activity.id))
        for activity in sorted_activities
    ]


@router.get("/{activity_id}", response_model=CompletedActivityRead, response_model_exclude_none=True)
def get_activity(
    activity_id: str, session: Session = Depends(get_session)
) -> CompletedActivityRead:
    activity = session.get(CompletedActivity, activity_id)
    if activity is None:
        raise HTTPException(status_code=404, detail="Completed Activity not found.")
    if activity.import_provenance is not None:
        ensure_raw_files(session)
    return activity_response(activity, activity_link_status(session, activity.id))
