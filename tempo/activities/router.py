from datetime import UTC, datetime

import json

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from tempo.activities.fit_adapter import FitImportError
from tempo.activities.corrections import (
    deserialize_value,
    effective_activity,
    list_corrections,
    original_values,
    serialize_value,
)
from tempo.activities.import_service import ensure_raw_files, import_fit_activity
from tempo.activities.models import CompletedActivity, Correction
from tempo.activities.schemas import (
    CompletedActivityRead,
    CorrectionCreate,
    CorrectionRead,
    ImportProvenanceRead,
    ManualActivityCreate,
)
from tempo.database import get_session

router = APIRouter(prefix="/api/activities", tags=["completed-activities"])
MAX_FIT_BYTES = 32 * 1024 * 1024
UPLOAD_CHUNK_BYTES = 1024 * 1024


def correction_read(correction: Correction) -> CorrectionRead:
    return CorrectionRead(
        id=correction.id,
        completed_activity_id=correction.completed_activity_id,
        field_name=correction.field_name,
        source_value=deserialize_value(correction.source_value),
        replacement_value=deserialize_value(correction.replacement_value),
        reason=correction.reason,
        recorded_at=correction.recorded_at,
    )


def activity_response(
    session: Session, activity: CompletedActivity, link_status: str = "unmatched"
) -> CompletedActivityRead:
    provenance = activity.import_provenance
    corrections = list_corrections(session, activity.id)
    effective = effective_activity(session, activity, corrections)
    return CompletedActivityRead(
        id=activity.id,
        modality=effective.modality,
        start_instant=effective.start_instant,
        duration_seconds=effective.duration_seconds,
        distance_metres=effective.distance_metres,
        title=effective.title,
        notes=effective.notes,
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
        original_values=original_values(activity),
        corrections=[correction_read(correction) for correction in corrections],
    )


def activity_link_status(session: Session, activity_id: str) -> str:
    from tempo.linking.models import LegacyLinkResolution, Link

    unresolved = session.scalar(
        select(LegacyLinkResolution.id).where(
            LegacyLinkResolution.completed_activity_id == activity_id,
            LegacyLinkResolution.status == "unresolved",
        )
    )
    if unresolved is not None:
        return "legacy_unresolved"
    linked = session.scalar(select(Link.id).where(Link.completed_activity_id == activity_id))
    return "linked" if linked is not None else "unmatched"


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
    session.flush()
    from tempo.linking.service import evaluate_after_ingestion

    evaluate_after_ingestion(session, activity)
    session.commit()
    session.refresh(activity)
    return activity_response(session, activity, activity_link_status(session, activity.id))


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
    return activity_response(session, activity, activity_link_status(session, activity.id))


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
        activity_response(session, activity, activity_link_status(session, activity.id))
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
    return activity_response(session, activity, activity_link_status(session, activity.id))


def validate_replacement(activity: CompletedActivity, request: CorrectionCreate) -> object:
    value = request.replacement_value
    field = request.field_name
    if field in ("title", "notes") and getattr(activity, field) is None:
        raise HTTPException(status_code=422, detail=f"{field.replace('_', ' ').title()} was not present in the original activity.")
    if field == "start_instant":
        if not isinstance(value, str):
            raise HTTPException(status_code=422, detail="Start instant must be a timezone-aware ISO instant.")
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as error:
            raise HTTPException(status_code=422, detail="Start instant must be a timezone-aware ISO instant.") from error
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise HTTPException(status_code=422, detail="Start instant must include a timezone or UTC offset.")
        return parsed.isoformat()
    if field == "modality":
        if value not in ("running", "cycling", "strength", "other"):
            raise HTTPException(status_code=422, detail="Choose a supported activity modality.")
        return value
    if field == "duration_seconds":
        if isinstance(value, bool) or not isinstance(value, int) or not 0 < value <= 604_800:
            raise HTTPException(status_code=422, detail="Duration must be between 1 and 604800 seconds.")
        return value
    if field == "distance_metres":
        if value is not None and (
            isinstance(value, bool) or not isinstance(value, int) or not 0 < value <= 1_000_000_000
        ):
            raise HTTPException(status_code=422, detail="Distance must be null or between 1 and 1000000000 metres.")
        return value
    if not isinstance(value, str) or not value.strip():
        raise HTTPException(status_code=422, detail=f"{field.title()} must be non-blank text.")
    maximum = 200 if field == "title" else 2000
    if len(value) > maximum:
        raise HTTPException(status_code=422, detail=f"{field.title()} must be {maximum} characters or fewer.")
    return value


@router.post(
    "/{activity_id}/corrections",
    response_model=CompletedActivityRead,
    status_code=status.HTTP_201_CREATED,
)
def create_correction(
    activity_id: str, request: CorrectionCreate, session: Session = Depends(get_session)
) -> CompletedActivityRead:
    session.connection().exec_driver_sql("BEGIN IMMEDIATE")
    activity = session.get(CompletedActivity, activity_id)
    if activity is None:
        raise HTTPException(status_code=404, detail="Completed Activity not found.")
    corrections = list_corrections(session, activity.id)
    effective = effective_activity(session, activity, corrections)
    replacement = validate_replacement(activity, request)
    correction = Correction(
        completed_activity_id=activity.id,
        field_name=request.field_name,
        source_value=serialize_value(getattr(effective, request.field_name)),
        replacement_value=serialize_value(replacement),
        reason=request.reason,
        recorded_at=datetime.now(UTC),
    )
    session.add(correction)
    session.flush()
    if activity_link_status(session, activity.id) == "unmatched":
        from tempo.linking.service import evaluate_after_ingestion

        evaluate_after_ingestion(session, activity)
    session.commit()
    session.refresh(activity)
    return activity_response(session, activity, activity_link_status(session, activity.id))
