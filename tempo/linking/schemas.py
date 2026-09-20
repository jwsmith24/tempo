from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

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
    expected_version: int


class LinkRemove(BaseModel):
    expected_version: int


class LinkRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    planned_session_id: str
    completed_activity_id: str
    source: str
    algorithm_version: str | None
    reasons: list[str]
    version: int
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
    session_outcome: "SessionOutcomeRead | None"
    session_outcome_history: list["SessionOutcomeRead"]
    check_in: "CheckInRead | None"
    check_in_history: list["CheckInRead"]


class SessionOutcomeCreate(BaseModel):
    disposition: str = Field(
        pattern="^(completed|modified|rescheduled|intentionally_skipped|unintentionally_missed|replaced)$"
    )
    reason: str | None = Field(default=None, max_length=2000)


class SessionOutcomeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    planned_session_id: str
    disposition: str
    reason: str | None
    recorded_at: datetime


class CheckInCreate(BaseModel):
    readiness: int | None = Field(default=None, ge=1, le=5)
    post_session_effort: int | None = Field(default=None, ge=1, le=10)
    feel: int | None = Field(default=None, ge=1, le=5)
    notes: str | None = Field(default=None, min_length=1, max_length=2000)

    @model_validator(mode="after")
    def requires_observation(self) -> "CheckInCreate":
        if self.notes is not None:
            self.notes = self.notes.strip() or None
        if all(value is None for value in (self.readiness, self.post_session_effort, self.feel, self.notes)):
            raise ValueError("Record at least one athlete-reported observation.")
        return self


class CheckInRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    planned_session_id: str
    readiness: int | None
    post_session_effort: int | None
    feel: int | None
    notes: str | None
    recorded_at: datetime
