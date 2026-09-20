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


class ActivityLinkStatus(StrEnum):
    unmatched = "unmatched"
    linked = "linked"
    legacy_unresolved = "legacy_unresolved"


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


class ImportProvenanceRead(BaseModel):
    adapter_type: str
    source_identity: str
    importer_name: str
    importer_version: str
    imported_at: datetime
    raw_file_identity: str
    checksum_sha256: str
    original_normalized_values: dict[str, str | int | None]


class CorrectionCreate(BaseModel):
    field_name: str = Field(
        pattern="^(start_instant|modality|duration_seconds|distance_metres|title|notes)$"
    )
    replacement_value: str | int | None
    reason: str = Field(min_length=1, max_length=2000)

    @field_validator("reason")
    @classmethod
    def reason_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Reason must not be blank.")
        return value


class CorrectionRead(BaseModel):
    id: str
    completed_activity_id: str
    field_name: str
    source_value: str | int | None
    replacement_value: str | int | None
    reason: str
    recorded_at: datetime


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
    link_status: ActivityLinkStatus = ActivityLinkStatus.unmatched
    import_provenance: ImportProvenanceRead | None = None
    original_values: dict[str, str | int | None]
    corrections: list[CorrectionRead]
