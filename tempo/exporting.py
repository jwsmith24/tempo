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
    identifier = {"type": "string", "minLength": 1}
    nullable_identifier = {"type": ["string", "null"], "minLength": 1}
    instant = {"type": "string", "format": "date-time"}
    nullable_instant = {"type": ["string", "null"], "format": "date-time"}
    nullable_text = {"type": ["string", "null"]}
    positive_integer = {"type": "integer", "minimum": 1}
    nullable_positive_integer = {"type": ["integer", "null"], "minimum": 1}

    def object_schema(
        properties: dict[str, object], required: tuple[str, ...] | None = None
    ) -> dict[str, object]:
        return {
            "type": "object",
            "additionalProperties": False,
            "properties": properties,
            "required": list(required or properties),
        }

    def record_file(definition: str) -> dict[str, object]:
        return {"type": "array", "items": {"$ref": f"#/$defs/{definition}"}}

    activity_values = object_schema(
        {
            "modality": {"enum": ["running", "cycling", "strength", "other"]},
            "start_instant": instant,
            "duration_seconds": positive_integer,
            "distance_metres": nullable_positive_integer,
            "title": nullable_text,
            "notes": nullable_text,
        }
    )
    candidate_result = object_schema(
        {
            "planned_session_id": identifier,
            "reasons": {"type": "array", "items": {"type": "string"}},
        }
    )
    definitions = {
        "planned_session": object_schema(
            {
                "id": identifier,
                "modality": {"const": "running"},
                "scheduled_date": {"type": "string", "format": "date"},
                "training_intent": {
                    "enum": ["recovery", "aerobic_base", "threshold", "power", "assessment"]
                },
                "priority": {"enum": ["low", "normal", "high"]},
                "notes": nullable_text,
                "created_at": instant,
                "active_revision_id": identifier,
            }
        ),
        "prescription_revision": object_schema(
            {
                "id": identifier,
                "planned_session_id": identifier,
                "revision_number": positive_integer,
                "duration_seconds": nullable_positive_integer,
                "distance_metres": nullable_positive_integer,
                "reason": {"type": "string"},
                "provenance": {"type": "string"},
                "created_at": instant,
            }
        ),
        "completed_activity": object_schema(
            {
                "id": identifier,
                "entry_source": {"enum": ["manual", "fit_import"]},
                "creation_provenance": {"type": "string"},
                "created_at": instant,
                "original_values": activity_values,
                "effective_values": activity_values,
            }
        ),
        "import_provenance": object_schema(
            {
                "id": identifier,
                "completed_activity_id": identifier,
                "adapter_type": {"type": "string"},
                "source_identity": {"type": "string"},
                "importer_name": {"type": "string"},
                "importer_version": {"type": "string"},
                "imported_at": instant,
                "raw_file_identity": {
                    "type": "string",
                    "pattern": "^sha256/[a-f0-9]{64}\\.fit$",
                },
                "checksum_sha256": {"type": "string", "pattern": "^[a-f0-9]{64}$"},
                "original_normalized_values": activity_values,
                "export_path": {
                    "type": "string",
                    "pattern": "^raw/sha256/[a-f0-9]{64}\\.fit$",
                },
            }
        ),
        "correction": object_schema(
            {
                "id": identifier,
                "completed_activity_id": identifier,
                "field_name": {
                    "enum": [
                        "start_instant",
                        "modality",
                        "duration_seconds",
                        "distance_metres",
                        "title",
                        "notes",
                    ]
                },
                "reason": {"type": "string", "minLength": 1},
                "recorded_at": instant,
                "source_value": {"type": ["string", "integer", "null"]},
                "replacement_value": {"type": ["string", "integer", "null"]},
            }
        ),
        "link": object_schema(
            {
                "id": identifier,
                "planned_session_id": identifier,
                "completed_activity_id": identifier,
                "source": {"enum": ["automatic", "athlete_confirmed", "direct"]},
                "algorithm_version": nullable_text,
                "version": positive_integer,
                "created_at": instant,
                "reasons": {"type": "array", "items": {"type": "string"}},
            }
        ),
        "match_evaluation": object_schema(
            {
                "id": identifier,
                "completed_activity_id": identifier,
                "activity_effective_version": {"type": "string", "minLength": 1},
                "algorithm_version": {"type": "string", "minLength": 1},
                "evaluated_at": instant,
                "candidate_results": {"type": "array", "items": candidate_result},
            }
        ),
        "legacy_link_resolution": object_schema(
            {
                "id": identifier,
                "completed_activity_id": identifier,
                "status": {"enum": ["unresolved", "resolved"]},
                "selected_planned_session_id": nullable_identifier,
                "resolved_at": nullable_instant,
            }
        ),
        "legacy_link_record": object_schema(
            {
                "id": identifier,
                "resolution_id": nullable_identifier,
                "planned_session_id": identifier,
                "completed_activity_id": identifier,
                "linked_duration_seconds": positive_integer,
                "linked_distance_metres": nullable_positive_integer,
                "confirmation_source": {"type": "string"},
                "version": positive_integer,
                "created_at": instant,
            }
        ),
        "link_decision": object_schema(
            {
                "id": identifier,
                "completed_activity_id": identifier,
                "link_id": identifier,
                "action": {"enum": ["changed", "removed"]},
                "prior_planned_session_id": nullable_identifier,
                "planned_session_id": nullable_identifier,
                "prior_source": {
                    "type": ["string", "null"],
                    "enum": ["automatic", "athlete_confirmed", "direct", None],
                },
                "prior_algorithm_version": nullable_text,
                "decided_at": instant,
                "prior_reasons": {
                    "type": ["array", "null"],
                    "items": {"type": "string"},
                },
            }
        ),
        "suggestion_rejection": object_schema(
            {
                "id": identifier,
                "prescription_revision_id": identifier,
                "completed_activity_id": identifier,
                "activity_effective_version": {"type": "string", "minLength": 1},
                "algorithm_version": {"type": "string", "minLength": 1},
                "rejected_at": instant,
            }
        ),
        "session_outcome": object_schema(
            {
                "id": identifier,
                "planned_session_id": identifier,
                "disposition": {
                    "enum": [
                        "completed",
                        "modified",
                        "rescheduled",
                        "intentionally_skipped",
                        "unintentionally_missed",
                        "replaced",
                    ]
                },
                "reason": nullable_text,
                "recorded_at": instant,
            }
        ),
        "check_in": object_schema(
            {
                "id": identifier,
                "planned_session_id": identifier,
                "readiness": {"type": ["integer", "null"], "minimum": 1, "maximum": 5},
                "post_session_effort": {
                    "type": ["integer", "null"],
                    "minimum": 1,
                    "maximum": 10,
                },
                "feel": {"type": ["integer", "null"], "minimum": 1, "maximum": 5},
                "notes": nullable_text,
                "recorded_at": instant,
            }
        ),
    }
    documents = {
        "planned_sessions.json": record_file("planned_session"),
        "prescription_revisions.json": record_file("prescription_revision"),
        "completed_activities.json": record_file("completed_activity"),
        "import_provenance.json": record_file("import_provenance"),
        "corrections.json": record_file("correction"),
        "links.json": record_file("link"),
        "match_evaluations.json": record_file("match_evaluation"),
        "legacy_link_resolutions.json": record_file("legacy_link_resolution"),
        "legacy_link_records.json": record_file("legacy_link_record"),
        "link_decisions.json": record_file("link_decision"),
        "suggestion_rejections.json": record_file("suggestion_rejection"),
        "session_outcomes.json": record_file("session_outcome"),
        "check_ins.json": record_file("check_in"),
    }
    record_count_properties = {path: {"type": "integer", "minimum": 0} for path in documents}
    checksum = {"type": "string", "pattern": "^[a-f0-9]{64}$"}
    inventory_item = {
        "oneOf": [
            object_schema(
                {
                    "path": {"type": "string", "minLength": 1},
                    "sha256": checksum,
                    "bytes": {"type": "integer", "minimum": 0},
                }
            ),
            object_schema(
                {
                    "path": {"const": "manifest.json"},
                    "sha256": checksum,
                    "checksum_scope": {"type": "string", "minLength": 1},
                }
            ),
        ]
    }
    manifest = object_schema(
        {
            "export_schema_version": {"const": EXPORT_SCHEMA_VERSION},
            "application_version": {"type": "string"},
            "created_at": instant,
            "record_counts": object_schema(record_count_properties),
            "files": {"type": "array", "items": inventory_item},
            "manifest_content_sha256": {"type": "string", "pattern": "^[a-f0-9]{64}$"},
        }
    )
    catalog = object_schema(
        {
            "$schema": {"const": "https://json-schema.org/draft/2020-12/schema"},
            "$id": {"const": f"https://tempo.local/schemas/{EXPORT_SCHEMA_VERSION}"},
            "schema_version": {"const": EXPORT_SCHEMA_VERSION},
            "title": {"type": "string"},
            "description": {"type": "string"},
            "documents": {"type": "object"},
            "$defs": {"type": "object"},
        }
    )
    documents["manifest.json"] = manifest
    documents[f"schemas/{EXPORT_SCHEMA_VERSION}.json"] = catalog
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": f"https://tempo.local/schemas/{EXPORT_SCHEMA_VERSION}",
        "schema_version": EXPORT_SCHEMA_VERSION,
        "title": "Tempo Stage 1 portable export schema catalog",
        "description": "Map each exported JSON filename to its schema. Record arrays use deterministic logical ordering; export creation metadata is intentionally variable.",
        "documents": documents,
        "$defs": definitions,
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
