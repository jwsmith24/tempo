from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from tempo.database import Base
from tempo.planning.models import UTCInstant, new_id


class Link(Base):
    __tablename__ = "links"
    __table_args__ = (
        CheckConstraint("source IN ('automatic', 'athlete_confirmed', 'direct')", name="ck_link_source"),
        CheckConstraint("version > 0", name="ck_link_version"),
        CheckConstraint("reasons IS NOT NULL", name="ck_link_reasons"),
        CheckConstraint("source = 'direct' OR algorithm_version IS NOT NULL", name="ck_link_algorithm_provenance"),
        UniqueConstraint("completed_activity_id", name="uq_link_completed_activity"),
        Index("ix_link_planned_session", "planned_session_id"),
        Index("ix_link_completed_activity", "completed_activity_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    planned_session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("planned_sessions.id", ondelete="CASCADE")
    )
    completed_activity_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("completed_activities.id", ondelete="CASCADE")
    )
    source: Mapped[str] = mapped_column(String(32))
    algorithm_version: Mapped[str | None] = mapped_column(String(64))
    reasons: Mapped[str] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(UTCInstant())


class LegacyLinkResolution(Base):
    __tablename__ = "legacy_link_resolutions"
    __table_args__ = (
        CheckConstraint("status IN ('unresolved', 'resolved')", name="ck_legacy_resolution_status"),
        UniqueConstraint("completed_activity_id", name="uq_legacy_resolution_activity"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    completed_activity_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("completed_activities.id", ondelete="CASCADE")
    )
    status: Mapped[str] = mapped_column(String(16), default="unresolved")
    selected_planned_session_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("planned_sessions.id", ondelete="SET NULL")
    )
    resolved_at: Mapped[datetime | None] = mapped_column(UTCInstant())


class LegacyLinkRecord(Base):
    __tablename__ = "legacy_link_records"
    __table_args__ = (Index("ix_legacy_link_record_activity", "completed_activity_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    resolution_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("legacy_link_resolutions.id", ondelete="CASCADE")
    )
    planned_session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("planned_sessions.id", ondelete="CASCADE")
    )
    completed_activity_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("completed_activities.id", ondelete="CASCADE")
    )
    linked_duration_seconds: Mapped[int] = mapped_column(Integer)
    linked_distance_metres: Mapped[int | None] = mapped_column(Integer)
    confirmation_source: Mapped[str] = mapped_column(String(32))
    version: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UTCInstant())


class MatchEvaluation(Base):
    __tablename__ = "match_evaluations"
    __table_args__ = (Index("ix_match_evaluation_activity", "completed_activity_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    completed_activity_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("completed_activities.id", ondelete="CASCADE")
    )
    activity_effective_version: Mapped[str] = mapped_column(String(64))
    algorithm_version: Mapped[str] = mapped_column(String(64))
    candidate_results: Mapped[str] = mapped_column(Text)
    evaluated_at: Mapped[datetime] = mapped_column(UTCInstant())


class LinkDecision(Base):
    __tablename__ = "link_decisions"
    __table_args__ = (
        CheckConstraint("action IN ('changed', 'removed')", name="ck_link_decision_action"),
        Index("ix_link_decision_activity", "completed_activity_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    completed_activity_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("completed_activities.id", ondelete="CASCADE")
    )
    link_id: Mapped[str] = mapped_column(String(36))
    action: Mapped[str] = mapped_column(String(16))
    prior_planned_session_id: Mapped[str | None] = mapped_column(String(36))
    planned_session_id: Mapped[str | None] = mapped_column(String(36))
    prior_source: Mapped[str | None] = mapped_column(String(32))
    prior_algorithm_version: Mapped[str | None] = mapped_column(String(64))
    prior_reasons: Mapped[str | None] = mapped_column(Text)
    decided_at: Mapped[datetime] = mapped_column(UTCInstant())


class SuggestionRejection(Base):
    __tablename__ = "suggestion_rejections"
    __table_args__ = (
        UniqueConstraint(
            "prescription_revision_id",
            "completed_activity_id",
            "activity_effective_version",
            "algorithm_version",
            name="uq_suggestion_rejection_version",
        ),
        Index("ix_suggestion_rejection_revision", "prescription_revision_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    prescription_revision_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("prescription_revisions.id", ondelete="CASCADE")
    )
    completed_activity_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("completed_activities.id", ondelete="CASCADE")
    )
    activity_effective_version: Mapped[str] = mapped_column(String(64))
    algorithm_version: Mapped[str] = mapped_column(String(64))
    rejected_at: Mapped[datetime] = mapped_column(UTCInstant())


class SessionOutcome(Base):
    __tablename__ = "session_outcomes"
    __table_args__ = (
        CheckConstraint(
            "disposition IN ('completed', 'modified', 'rescheduled', "
            "'intentionally_skipped', 'unintentionally_missed', 'replaced')",
            name="ck_session_outcome_disposition",
        ),
        Index("ix_session_outcome_planned_session", "planned_session_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    planned_session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("planned_sessions.id", ondelete="CASCADE")
    )
    disposition: Mapped[str] = mapped_column(String(32))
    reason: Mapped[str | None] = mapped_column(Text)
    recorded_at: Mapped[datetime] = mapped_column(UTCInstant())


class CheckIn(Base):
    __tablename__ = "check_ins"
    __table_args__ = (
        CheckConstraint("readiness IS NULL OR readiness BETWEEN 1 AND 5", name="ck_check_in_readiness"),
        CheckConstraint(
            "post_session_effort IS NULL OR post_session_effort BETWEEN 1 AND 10",
            name="ck_check_in_post_session_effort",
        ),
        CheckConstraint("feel IS NULL OR feel BETWEEN 1 AND 5", name="ck_check_in_feel"),
        CheckConstraint(
            "readiness IS NOT NULL OR post_session_effort IS NOT NULL OR feel IS NOT NULL OR notes IS NOT NULL",
            name="ck_check_in_has_observation",
        ),
        Index("ix_check_in_planned_session", "planned_session_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    planned_session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("planned_sessions.id", ondelete="CASCADE")
    )
    readiness: Mapped[int | None] = mapped_column(Integer)
    post_session_effort: Mapped[int | None] = mapped_column(Integer)
    feel: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(Text)
    recorded_at: Mapped[datetime] = mapped_column(UTCInstant())
