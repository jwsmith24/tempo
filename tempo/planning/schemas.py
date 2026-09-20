from datetime import date, datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, model_validator


class TrainingIntent(StrEnum):
    recovery = "recovery"
    aerobic_base = "aerobic_base"
    threshold = "threshold"
    power = "power"
    assessment = "assessment"


class Priority(StrEnum):
    low = "low"
    normal = "normal"
    high = "high"


class PlannedRunCreate(BaseModel):
    scheduled_date: date
    training_intent: TrainingIntent
    priority: Priority = Priority.normal
    notes: str | None = Field(default=None, max_length=2000)
    duration_seconds: int | None = Field(default=None, gt=0)
    distance_metres: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def require_prescription(self) -> "PlannedRunCreate":
        if self.duration_seconds is None and self.distance_metres is None:
            raise ValueError("Enter a prescribed duration, distance, or both.")
        return self


class PrescriptionRevisionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    revision_number: int
    duration_seconds: int | None
    distance_metres: int | None
    reason: str
    provenance: str
    created_at: datetime


class PlannedRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    modality: str
    scheduled_date: date
    training_intent: TrainingIntent
    priority: Priority
    notes: str | None
    created_at: datetime
    active_revision: PrescriptionRevisionRead
