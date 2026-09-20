import hashlib
import io
import json
from datetime import UTC, date, datetime
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from tempo.activities.corrections import effective_activity, list_corrections, original_values
from tempo.activities.import_service import import_lock
from tempo.activities.models import ActivityImportProvenance, CompletedActivity, Correction
from tempo.linking.models import (
    CheckIn,
    LegacyLinkRecord,
    LegacyLinkResolution,
    Link,
    LinkDecision,
    MatchEvaluation,
    SessionOutcome,
    SuggestionRejection,
)
from tempo.planning.models import PlannedSession, PrescriptionRevision

EXPORT_SCHEMA_VERSION = "stage1-v1"
APPLICATION_VERSION = "0.1.0"
ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)


def value(value: object) -> object:
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
    if isinstance(value, date):
        return value.isoformat()
    return value


def parsed(value: str | None) -> object:
    return json.loads(value) if value is not None else None


def records(session: Session, model: type, *columns: object) -> list[object]:
    return list(session.scalars(select(model).order_by(*columns)))


def serialize_activity(session: Session, activity: CompletedActivity) -> dict[str, object]:
    effective = effective_activity(session, activity)
    return {
        "id": activity.id,
        "entry_source": activity.entry_source,
        "creation_provenance": activity.creation_provenance,
        "created_at": value(activity.created_at),
        "original_values": original_values(activity),
        "effective_values": {
            "modality": effective.modality,
            "start_instant": value(effective.start_instant),
            "duration_seconds": effective.duration_seconds,
            "distance_metres": effective.distance_metres,
            "title": effective.title,
            "notes": effective.notes,
        },
    }


def serialize_model(model: object, fields: tuple[str, ...]) -> dict[str, object]:
    return {field: value(getattr(model, field)) for field in fields}


def json_bytes(data: object) -> bytes:
    return (json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode()


def manifest_checksum(manifest: dict[str, object]) -> str:
    canonical = dict(manifest)
    canonical.pop("manifest_content_sha256", None)
    canonical["files"] = [item for item in canonical["files"] if item["path"] != "manifest.json"]
    return hashlib.sha256(json_bytes(canonical)).hexdigest()


def schema() -> dict[str, object]:
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "schema_version": EXPORT_SCHEMA_VERSION,
        "type": "object",
        "properties": {
            "record_file": {"type": "array", "items": {"type": "object"}},
            "manifest": {
                "type": "object",
                "required": ["export_schema_version", "application_version", "created_at", "record_counts", "files"],
            },
            "completed_activity": {
                "type": "object",
                "required": ["id", "original_values", "effective_values"],
                "properties": {"original_values": {"type": "object"}, "effective_values": {"type": "object"}},
            },
            "raw_export_path": {"type": "string", "pattern": "^raw/sha256/[a-f0-9]{64}\\.fit$"},
        },
        "description": "Each record JSON file is a UTF-8 array ordered by stable identifiers and timestamps. JSON-backed record fields are exported as their native JSON types.",
    }


def snapshot(session: Session, raw_directory: Path) -> dict[str, bytes]:
    planned_sessions = records(session, PlannedSession, PlannedSession.id)
    activities = records(session, CompletedActivity, CompletedActivity.id)
    provenance = records(session, ActivityImportProvenance, ActivityImportProvenance.id)
    corrections = records(session, Correction, Correction.recorded_at, Correction.id)
    files: dict[str, bytes] = {
        "schemas/stage1-v1.json": json_bytes(schema()),
        "planned_sessions.json": json_bytes([
            serialize_model(item, ("id", "modality", "scheduled_date", "training_intent", "priority", "notes", "created_at", "active_revision_id"))
            for item in planned_sessions
        ]),
        "prescription_revisions.json": json_bytes([
            serialize_model(item, ("id", "planned_session_id", "revision_number", "duration_seconds", "distance_metres", "reason", "provenance", "created_at"))
            for item in records(session, PrescriptionRevision, PrescriptionRevision.id)
        ]),
        "completed_activities.json": json_bytes([serialize_activity(session, item) for item in activities]),
        "import_provenance.json": json_bytes([
            {**serialize_model(item, ("id", "completed_activity_id", "adapter_type", "source_identity", "importer_name", "importer_version", "imported_at", "raw_file_identity", "checksum_sha256")), "original_normalized_values": parsed(item.original_normalized_values), "export_path": f"raw/{item.raw_file_identity}"}
            for item in provenance
        ]),
        "corrections.json": json_bytes([
            {**serialize_model(item, ("id", "completed_activity_id", "field_name", "reason", "recorded_at")), "source_value": parsed(item.source_value), "replacement_value": parsed(item.replacement_value)}
            for item in corrections
        ]),
        "links.json": json_bytes([
            {**serialize_model(item, ("id", "planned_session_id", "completed_activity_id", "source", "algorithm_version", "version", "created_at")), "reasons": parsed(item.reasons)}
            for item in records(session, Link, Link.id)
        ]),
        "match_evaluations.json": json_bytes([
            {**serialize_model(item, ("id", "completed_activity_id", "activity_effective_version", "algorithm_version", "evaluated_at")), "candidate_results": parsed(item.candidate_results)}
            for item in records(session, MatchEvaluation, MatchEvaluation.evaluated_at, MatchEvaluation.id)
        ]),
        "legacy_link_resolutions.json": json_bytes([
            serialize_model(item, ("id", "completed_activity_id", "status", "selected_planned_session_id", "resolved_at"))
            for item in records(session, LegacyLinkResolution, LegacyLinkResolution.id)
        ]),
        "legacy_link_records.json": json_bytes([
            serialize_model(item, ("id", "resolution_id", "planned_session_id", "completed_activity_id", "linked_duration_seconds", "linked_distance_metres", "confirmation_source", "version", "created_at"))
            for item in records(session, LegacyLinkRecord, LegacyLinkRecord.id)
        ]),
        "link_decisions.json": json_bytes([
            {**serialize_model(item, ("id", "completed_activity_id", "link_id", "action", "prior_planned_session_id", "planned_session_id", "prior_source", "prior_algorithm_version", "decided_at")), "prior_reasons": parsed(item.prior_reasons)}
            for item in records(session, LinkDecision, LinkDecision.decided_at, LinkDecision.id)
        ]),
        "suggestion_rejections.json": json_bytes([
            serialize_model(item, ("id", "prescription_revision_id", "completed_activity_id", "activity_effective_version", "algorithm_version", "rejected_at"))
            for item in records(session, SuggestionRejection, SuggestionRejection.id)
        ]),
        "session_outcomes.json": json_bytes([
            serialize_model(item, ("id", "planned_session_id", "disposition", "reason", "recorded_at"))
            for item in records(session, SessionOutcome, SessionOutcome.recorded_at, SessionOutcome.id)
        ]),
        "check_ins.json": json_bytes([
            serialize_model(item, ("id", "planned_session_id", "readiness", "post_session_effort", "feel", "notes", "recorded_at"))
            for item in records(session, CheckIn, CheckIn.recorded_at, CheckIn.id)
        ]),
    }
    for item in provenance:
        checksum = item.checksum_sha256
        raw_file = raw_directory / f"{checksum}.fit"
        raw_bytes = raw_file.read_bytes()
        if hashlib.sha256(raw_bytes).hexdigest() != checksum:
            raise HTTPException(status_code=409, detail=f"Retained raw FIT file checksum does not match provenance: {item.raw_file_identity}")
        files[f"raw/{item.raw_file_identity}"] = raw_bytes
    return files


def archive(session: Session) -> bytes:
    with import_lock() as raw_directory:
        session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        try:
            files = snapshot(session, raw_directory)
        finally:
            session.rollback()
    inventory = [
        {"path": path, "sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content)}
        for path, content in sorted(files.items())
    ]
    counts = {path: len(json.loads(content)) for path, content in files.items() if path.endswith(".json") and path != "schemas/stage1-v1.json"}
    manifest = {
        "export_schema_version": EXPORT_SCHEMA_VERSION,
        "application_version": APPLICATION_VERSION,
        "created_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "record_counts": counts,
        "files": inventory,
    }
    manifest["manifest_content_sha256"] = manifest_checksum(manifest)
    manifest["files"].append({
        "path": "manifest.json",
        "sha256": manifest["manifest_content_sha256"],
        "checksum_scope": "canonical manifest content excluding manifest_content_sha256 and this inventory entry",
    })
    files["manifest.json"] = json_bytes(manifest)
    output = io.BytesIO()
    with ZipFile(output, "w", compression=ZIP_DEFLATED) as bundle:
        for path, content in sorted(files.items()):
            info = ZipInfo(path, ZIP_TIMESTAMP)
            info.compress_type = ZIP_DEFLATED
            bundle.writestr(info, content)
    return output.getvalue()
