from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from tempo.database import Base
from tempo.planning.models import UTCInstant, new_id


class Link(Base):
    __tablename__ = "links"
    __table_args__ = (
        CheckConstraint("source IN ('automatic', 'athlete_confirmed', 'direct')", name="ck_link_source"),
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
    reasons: Mapped[str | None] = mapped_column(Text)
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
