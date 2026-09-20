from datetime import datetime

from pydantic import BaseModel, ConfigDict

from tempo.activities.schemas import CompletedActivityRead
from tempo.planning.schemas import PlannedRunRead


class MatchCandidateRead(BaseModel):
    planned_run: PlannedRunRead
    algorithm_version: str
    reasons: list[str]


class DirectLinkCreate(BaseModel):
    planned_session_id: str


class LinkChange(BaseModel):
    planned_session_id: str


class LinkRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    planned_session_id: str
    completed_activity_id: str
    source: str
    algorithm_version: str | None
    reasons: list[str]
    created_at: datetime


class ActivityLinkRead(BaseModel):
    link: LinkRead
    planned_run: PlannedRunRead


class LegacyLinkRecordRead(BaseModel):
    id: str
    planned_session_id: str
    planned_run: PlannedRunRead
    linked_duration_seconds: int
    linked_distance_metres: int | None
    confirmation_source: str
    version: int
    created_at: datetime


class LegacyResolutionRead(BaseModel):
    id: str
    status: str
    selected_planned_session_id: str | None
    resolved_at: datetime | None
    records: list[LegacyLinkRecordRead]


class LegacyResolutionRequest(BaseModel):
    planned_session_id: str | None = None


class ActivityLinkingRead(BaseModel):
    activity: CompletedActivityRead
    link: ActivityLinkRead | None
    candidates: list[MatchCandidateRead]
    legacy_resolution: LegacyResolutionRead | None


class LinkActivityEvidenceRead(BaseModel):
    link: LinkRead
    activity: CompletedActivityRead


class LinkEvidenceRead(BaseModel):
    planned_run: PlannedRunRead
    links: list[LinkActivityEvidenceRead]
    total_duration_seconds: int
    total_distance_metres: int | None
    duration_difference_seconds: int | None
    distance_difference_metres: int | None
    session_outcome: None = None
