from datetime import UTC, date, datetime
from uuid import uuid4

from sqlalchemy import CheckConstraint, Date, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator

from tempo.database import Base


def new_id() -> str:
    return str(uuid4())


class UTCInstant(TypeDecorator[datetime]):
    impl = String(32)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: object) -> str | None:
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("UTC instants must include timezone information")
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z")

    def process_result_value(self, value: str | None, dialect: object) -> datetime | None:
        return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


class PlannedSession(Base):
    __tablename__ = "planned_sessions"
    __table_args__ = (
        CheckConstraint("modality = 'running'", name="ck_planned_session_running"),
        CheckConstraint(
            "training_intent IN ('recovery', 'aerobic_base', 'threshold', 'power', 'assessment')",
            name="ck_planned_session_training_intent",
        ),
        CheckConstraint("priority IN ('low', 'normal', 'high')", name="ck_planned_session_priority"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    modality: Mapped[str] = mapped_column(String(16), default="running")
    scheduled_date: Mapped[date] = mapped_column(Date)
    training_intent: Mapped[str] = mapped_column(String(32))
    priority: Mapped[str] = mapped_column(String(16))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCInstant())
    active_revision_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("prescription_revisions.id"), nullable=True
    )
    revisions: Mapped[list["PrescriptionRevision"]] = relationship(
        back_populates="planned_session",
        foreign_keys="PrescriptionRevision.planned_session_id",
        cascade="all, delete-orphan",
    )
    active_revision: Mapped["PrescriptionRevision | None"] = relationship(
        foreign_keys=[active_revision_id], post_update=True
    )


class PrescriptionRevision(Base):
    __tablename__ = "prescription_revisions"
    __table_args__ = (
        CheckConstraint(
            "duration_seconds IS NOT NULL OR distance_metres IS NOT NULL",
            name="ck_prescription_has_measure",
        ),
        CheckConstraint(
            "duration_seconds IS NULL OR duration_seconds > 0",
            name="ck_prescription_positive_duration",
        ),
        CheckConstraint(
            "distance_metres IS NULL OR distance_metres > 0",
            name="ck_prescription_positive_distance",
        ),
        UniqueConstraint(
            "planned_session_id", "revision_number", name="uq_prescription_revision_number"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    planned_session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("planned_sessions.id", ondelete="CASCADE")
    )
    revision_number: Mapped[int] = mapped_column(Integer)
    duration_seconds: Mapped[int | None] = mapped_column(Integer)
    distance_metres: Mapped[int | None] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(64))
    provenance: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(UTCInstant())
    planned_session: Mapped[PlannedSession] = relationship(
        back_populates="revisions", foreign_keys=[planned_session_id]
    )
