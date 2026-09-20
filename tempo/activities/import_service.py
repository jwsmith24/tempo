import fcntl
import json
import os
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import BinaryIO, Iterator

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from tempo.activities.fit_adapter import IMPORTER_NAME, IMPORTER_VERSION, decode_running_activity
from tempo.activities.models import ActivityImportProvenance, CompletedActivity
from tempo.database import application_data_directory

ADAPTER_TYPE = "garmin_fit"


@contextmanager
def import_lock() -> Iterator[Path]:
    raw_directory = application_data_directory() / "raw" / "fit"
    raw_directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    raw_directory.chmod(0o700)
    lock_path = raw_directory / ".import.lock"
    with lock_path.open("a+b") as lock_file:
        lock_path.chmod(0o600)
        fcntl.flock(lock_file, fcntl.LOCK_EX)
        try:
            yield raw_directory
        finally:
            fcntl.flock(lock_file, fcntl.LOCK_UN)


def sync_file(file: BinaryIO) -> None:
    file.flush()
    os.fsync(file.fileno())


def sync_directory(directory: Path) -> None:
    descriptor = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def reconcile_raw_files(session: Session, raw_directory: Path) -> None:
    committed = set(session.scalars(select(ActivityImportProvenance.checksum_sha256)))
    for pending in raw_directory.glob(".*.pending"):
        checksum = pending.name[1:-8]
        if checksum in committed:
            pending.replace(raw_directory / f"{checksum}.fit")
        else:
            pending.unlink(missing_ok=True)
    for final in raw_directory.glob("*.fit"):
        if final.stem not in committed:
            final.unlink(missing_ok=True)
    sync_directory(raw_directory)


def ensure_raw_files(session: Session) -> None:
    with import_lock() as raw_directory:
        reconcile_raw_files(session, raw_directory)


def import_fit_activity(content: bytes, session: Session) -> CompletedActivity:
    decoded = decode_running_activity(content)
    with import_lock() as raw_directory:
        reconcile_raw_files(session, raw_directory)
        existing = session.scalar(
            select(ActivityImportProvenance).where(
                or_(
                    and_(
                        ActivityImportProvenance.adapter_type == ADAPTER_TYPE,
                        ActivityImportProvenance.source_identity == decoded.source_identity,
                    ),
                    ActivityImportProvenance.checksum_sha256 == decoded.checksum_sha256,
                )
            )
        )
        if existing is not None:
            return existing.activity

        logical_identity = f"sha256/{decoded.checksum_sha256}.fit"
        pending = raw_directory / f".{decoded.checksum_sha256}.pending"
        destination = raw_directory / f"{decoded.checksum_sha256}.fit"
        now = datetime.now(UTC)
        activity = CompletedActivity(
            modality="running",
            start_instant=decoded.start_instant,
            duration_seconds=decoded.duration_seconds,
            distance_metres=decoded.distance_metres,
            title=None,
            notes=None,
            entry_source="fit_import",
            creation_provenance="fit_adapter",
            created_at=now,
        )
        activity.import_provenance = ActivityImportProvenance(
            adapter_type=ADAPTER_TYPE,
            source_identity=decoded.source_identity,
            importer_name=IMPORTER_NAME,
            importer_version=IMPORTER_VERSION,
            imported_at=now,
            raw_file_identity=logical_identity,
            checksum_sha256=decoded.checksum_sha256,
            original_normalized_values=json.dumps(decoded.original_values, sort_keys=True),
        )

        try:
            with pending.open("wb") as staged:
                pending.chmod(0o600)
                staged.write(content)
                sync_file(staged)
            sync_directory(raw_directory)
            session.add(activity)
            session.flush()
            from tempo.linking.service import evaluate_after_ingestion

            evaluate_after_ingestion(session, activity)
            session.commit()
        except Exception:
            session.rollback()
            pending.unlink(missing_ok=True)
            sync_directory(raw_directory)
            raise

        pending.replace(destination)
        destination.chmod(0o600)
        sync_directory(raw_directory)
        session.refresh(activity)
        return activity
