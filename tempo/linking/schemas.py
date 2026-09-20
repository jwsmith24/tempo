from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from tempo.activities.schemas import CompletedActivityRead
from tempo.planning.schemas import PlannedRunRead


class MatchSuggestionRead(BaseModel):
    planned_session_id: str
    prescription_revision_id: str
    activity: CompletedActivityRead
    algorithm_version: str
    reasons: list[str]
    proposed_duration_seconds: int
    proposed_distance_metres: int | None


class ActivityMatchSuggestionRead(BaseModel):
    activity_id: str
    planned_run: PlannedRunRead
    algorithm_version: str
    reasons: list[str]
    proposed_duration_seconds: int
    proposed_distance_metres: int | None


class SuggestionDecisionRead(BaseModel):
    decision: str


class SuggestionConfirm(BaseModel):
    linked_duration_seconds: int | None = Field(default=None, gt=0)
    linked_distance_metres: int | None = Field(default=None, gt=0)


class DirectLinkCreate(BaseModel):
    planned_session_id: str
    linked_duration_seconds: int = Field(gt=0)
    linked_distance_metres: int | None = Field(default=None, gt=0)


class LinkUpdate(BaseModel):
    linked_duration_seconds: int = Field(gt=0)
    linked_distance_metres: int | None = Field(default=None, gt=0)
    expected_version: int = Field(gt=0)


class LinkRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    planned_session_id: str
    completed_activity_id: str
    linked_duration_seconds: int
    linked_distance_metres: int | None
    confirmation_source: str
    version: int
    created_at: datetime


class ActivityLinkRead(BaseModel):
    link: LinkRead
    planned_run: PlannedRunRead


class ActivityLinkingRead(BaseModel):
    activity: CompletedActivityRead
    links: list[ActivityLinkRead]
    remaining_duration_seconds: int
    remaining_distance_metres: int | None


class LinkActivityEvidenceRead(BaseModel):
    link: LinkRead
    activity: CompletedActivityRead
    unmatched_duration_seconds: int
    unmatched_distance_metres: int | None


class LinkEvidenceRead(BaseModel):
    planned_run: PlannedRunRead
    links: list[LinkActivityEvidenceRead]
    total_linked_duration_seconds: int
    total_linked_distance_metres: int | None
    duration_difference_seconds: int | None
    distance_difference_metres: int | None
    session_outcome: None = None
