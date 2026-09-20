import json
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from tempo.activities.models import CompletedActivity, Correction

CORRECTABLE_FIELDS = (
    "start_instant",
    "modality",
    "duration_seconds",
    "distance_metres",
    "title",
    "notes",
)


@dataclass(frozen=True)
class EffectiveActivity:
    id: str
    modality: str
    start_instant: datetime
    duration_seconds: int
    distance_metres: int | None
    title: str | None
    notes: str | None
    created_at: datetime


def serialize_value(value: object) -> str:
    if isinstance(value, datetime):
        value = value.isoformat()
    return json.dumps(value)


def deserialize_value(value: str) -> str | int | None:
    return json.loads(value)


def list_corrections(session: Session, activity_id: str) -> list[Correction]:
    return list(
        session.scalars(
            select(Correction)
            .where(Correction.completed_activity_id == activity_id)
            .order_by(Correction.recorded_at, Correction.id)
        )
    )


def original_values(activity: CompletedActivity) -> dict[str, str | int | None]:
    return {
        "start_instant": activity.start_instant.isoformat(),
        "modality": activity.modality,
        "duration_seconds": activity.duration_seconds,
        "distance_metres": activity.distance_metres,
        "title": activity.title,
        "notes": activity.notes,
    }


def effective_activity(
    session: Session, activity: CompletedActivity, corrections: list[Correction] | None = None
) -> EffectiveActivity:
    values = original_values(activity)
    for correction in corrections if corrections is not None else list_corrections(session, activity.id):
        values[correction.field_name] = deserialize_value(correction.replacement_value)
    return EffectiveActivity(
        id=activity.id,
        modality=str(values["modality"]),
        start_instant=datetime.fromisoformat(str(values["start_instant"])),
        duration_seconds=int(values["duration_seconds"]),
        distance_metres=int(values["distance_metres"]) if values["distance_metres"] is not None else None,
        title=str(values["title"]) if values["title"] is not None else None,
        notes=str(values["notes"]) if values["notes"] is not None else None,
        created_at=activity.created_at,
    )


def effective_version(activity: CompletedActivity, corrections: list[Correction]) -> str:
    return corrections[-1].id if corrections else activity.created_at.isoformat()
