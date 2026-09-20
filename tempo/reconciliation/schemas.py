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
    allocated_duration_seconds: int | None = Field(default=None, gt=0)
    allocated_distance_metres: int | None = Field(default=None, gt=0)


class AllocationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    planned_session_id: str
    completed_activity_id: str
    allocated_duration_seconds: int
    allocated_distance_metres: int | None
    confirmation_source: str
    created_at: datetime


class AllocationEvidenceRead(BaseModel):
    allocation: AllocationRead
    activity: CompletedActivityRead
    unmatched_duration_seconds: int
    unmatched_distance_metres: int | None


class ReconciliationEvidenceRead(BaseModel):
    planned_run: PlannedRunRead
    allocations: list[AllocationEvidenceRead]
    allocated_duration_seconds: int
    allocated_distance_metres: int | None
    duration_difference_seconds: int | None
    distance_difference_metres: int | None
    session_outcome: None = None
