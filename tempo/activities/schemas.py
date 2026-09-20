from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ActivityModality(StrEnum):
    running = "running"
    cycling = "cycling"
    strength = "strength"
    other = "other"


class ActivityEntrySource(StrEnum):
    manual = "manual"
    fit_import = "fit_import"


class ManualActivityCreate(BaseModel):
    modality: ActivityModality
    start_instant: datetime
    duration_seconds: int = Field(gt=0, le=604_800)
    distance_metres: int | None = Field(default=None, gt=0, le=1_000_000_000)
    title: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("start_instant")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Start instant must include a timezone or UTC offset.")
        return value


class CompletedActivityRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    modality: ActivityModality
    start_instant: datetime
    duration_seconds: int
    distance_metres: int | None
    title: str | None
    notes: str | None
    entry_source: ActivityEntrySource
    creation_provenance: str
    created_at: datetime
    reconciliation_status: str = "unmatched"
