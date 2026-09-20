from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator

from tempo.database import Base
from tempo.planning.models import UTCInstant, new_id


class OffsetInstant(TypeDecorator[datetime]):
    impl = String(40)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: object) -> str | None:
        if value is None:
            return None
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Activity start instant must include a timezone or UTC offset")
        return value.isoformat()

    def process_result_value(self, value: str | None, dialect: object) -> datetime | None:
        return datetime.fromisoformat(value) if value else None


class CompletedActivity(Base):
    __tablename__ = "completed_activities"
    __table_args__ = (
        CheckConstraint(
            "modality IN ('running', 'cycling', 'strength', 'other')",
            name="ck_completed_activity_modality",
        ),
        CheckConstraint("duration_seconds > 0", name="ck_completed_activity_positive_duration"),
        CheckConstraint(
            "distance_metres IS NULL OR distance_metres > 0",
            name="ck_completed_activity_positive_distance",
        ),
        CheckConstraint(
            "entry_source IN ('manual', 'fit_import')",
            name="ck_completed_activity_entry_source",
        ),
        Index("ix_completed_activities_start_instant", "start_instant"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    modality: Mapped[str] = mapped_column(String(16))
    start_instant: Mapped[datetime] = mapped_column(OffsetInstant())
    duration_seconds: Mapped[int] = mapped_column(Integer)
    distance_metres: Mapped[int | None] = mapped_column(Integer)
    title: Mapped[str | None] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text)
    entry_source: Mapped[str] = mapped_column(String(16), default="manual")
    creation_provenance: Mapped[str] = mapped_column(String(32), default="athlete_entry")
    created_at: Mapped[datetime] = mapped_column(UTCInstant())
    import_provenance: Mapped["ActivityImportProvenance | None"] = relationship(
        back_populates="activity", uselist=False
    )


class ActivityImportProvenance(Base):
    __tablename__ = "activity_import_provenance"
    __table_args__ = (
        Index("uq_activity_import_source_identity", "adapter_type", "source_identity", unique=True),
        Index("uq_activity_import_checksum", "checksum_sha256", unique=True),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    completed_activity_id: Mapped[str] = mapped_column(
        ForeignKey("completed_activities.id", ondelete="CASCADE"), unique=True
    )
    adapter_type: Mapped[str] = mapped_column(String(32))
    source_identity: Mapped[str] = mapped_column(String(500))
    importer_name: Mapped[str] = mapped_column(String(64))
    importer_version: Mapped[str] = mapped_column(String(32))
    imported_at: Mapped[datetime] = mapped_column(UTCInstant())
    raw_file_identity: Mapped[str] = mapped_column(String(80), unique=True)
    checksum_sha256: Mapped[str] = mapped_column(String(64))
    original_normalized_values: Mapped[str] = mapped_column(Text)

    activity: Mapped[CompletedActivity] = relationship(back_populates="import_provenance")


class Correction(Base):
    __tablename__ = "corrections"
    __table_args__ = (
        CheckConstraint(
            "field_name IN ('start_instant', 'modality', 'duration_seconds', "
            "'distance_metres', 'title', 'notes')",
            name="ck_correction_field_name",
        ),
        Index("ix_correction_activity", "completed_activity_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    completed_activity_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("completed_activities.id", ondelete="CASCADE")
    )
    field_name: Mapped[str] = mapped_column(String(32))
    source_value: Mapped[str] = mapped_column(Text)
    replacement_value: Mapped[str] = mapped_column(Text)
    reason: Mapped[str] = mapped_column(Text)
    recorded_at: Mapped[datetime] = mapped_column(UTCInstant())
