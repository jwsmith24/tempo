import hashlib
import io
import json
import re
import threading
from datetime import UTC, datetime
from pathlib import Path
from zipfile import ZipFile

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from tempo.activities.models import CompletedActivity
from tempo.exporting import manifest_checksum
from tempo.linking.models import (
    CheckIn,
    LegacyLinkRecord,
    LegacyLinkResolution,
    Link,
    SessionOutcome,
    SuggestionRejection,
)
from tempo.main import app
from tempo.planning.models import PlannedSession

FIXTURE = Path(__file__).parent / "fixtures" / "garmin-fenix-5-run.fit"


def create_run(client: TestClient) -> dict:
    response = client.post(
        "/api/planned-runs",
        json={
            "scheduled_date": "2017-06-11",
            "training_intent": "aerobic_base",
            "priority": "normal",
            "duration_seconds": 3600,
            "distance_metres": 10_000,
        },
    )
    assert response.status_code == 201
    return response.json()


def read_bundle(content: bytes) -> dict[str, object]:
    with ZipFile(io.BytesIO(content)) as bundle:
        return {
            path: json.loads(bundle.read(path))
            for path in bundle.namelist()
            if path.endswith(".json")
        }


def validate_schema(instance: object, schema: dict, catalog: dict, path: str = "$") -> None:
    if "$ref" in schema:
        referenced = catalog
        for component in schema["$ref"].removeprefix("#/").split("/"):
            referenced = referenced[component]
        validate_schema(instance, referenced, catalog, path)
        return
    if "oneOf" in schema:
        matches = 0
        for option in schema["oneOf"]:
            try:
                validate_schema(instance, option, catalog, path)
                matches += 1
            except AssertionError:
                pass
        assert matches == 1, (path, "oneOf", matches)
        return

    allowed_types = schema.get("type")
    if allowed_types:
        allowed_types = [allowed_types] if isinstance(allowed_types, str) else allowed_types
        checks = {
            "array": lambda value: isinstance(value, list),
            "integer": lambda value: isinstance(value, int) and not isinstance(value, bool),
            "null": lambda value: value is None,
            "object": lambda value: isinstance(value, dict),
            "string": lambda value: isinstance(value, str),
        }
        assert any(checks[kind](instance) for kind in allowed_types), (path, allowed_types, instance)
    if instance is None:
        return
    if "const" in schema:
        assert instance == schema["const"], path
    if "enum" in schema:
        assert instance in schema["enum"], path
    if isinstance(instance, str):
        assert len(instance) >= schema.get("minLength", 0), path
        if "pattern" in schema:
            assert re.fullmatch(schema["pattern"], instance), path
        if schema.get("format") == "date":
            datetime.fromisoformat(instance)
        if schema.get("format") == "date-time":
            assert datetime.fromisoformat(instance.replace("Z", "+00:00")).tzinfo is not None, path
    if isinstance(instance, int) and not isinstance(instance, bool):
        assert instance >= schema.get("minimum", instance), path
        assert instance <= schema.get("maximum", instance), path
    if isinstance(instance, list) and "items" in schema:
        for index, item in enumerate(instance):
            validate_schema(item, schema["items"], catalog, f"{path}[{index}]")
    if isinstance(instance, dict):
        required = schema.get("required", [])
        assert set(required) <= set(instance), (path, set(required) - set(instance))
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            assert set(instance) <= set(properties), (path, set(instance) - set(properties))
        for key, subschema in properties.items():
            if key in instance:
                validate_schema(instance[key], subschema, catalog, f"{path}.{key}")


def test_export_contains_complete_inspectable_stage_one_snapshot(client: TestClient) -> None:
    run = create_run(client)
    imported = client.post(
        "/api/activities/imports/fit",
        files={"file": ("run.fit", FIXTURE.read_bytes(), "application/octet-stream")},
    ).json()
    assert imported["link_status"] == "linked"
    assert client.post(
        f"/api/activities/{imported['id']}/corrections",
        json={"field_name": "duration_seconds", "replacement_value": 120, "reason": "Watch stopped late"},
    ).status_code == 201
    assert client.post(f"/api/planned-runs/{run['id']}/outcomes", json={"disposition": "completed"}).status_code == 201
    assert client.post(f"/api/planned-runs/{run['id']}/check-ins", json={"feel": 4}).status_code == 201

    response = client.post("/api/export")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    with ZipFile(io.BytesIO(response.content)) as bundle:
        names = bundle.namelist()
        assert names == sorted(names)
        assert "manifest.json" in names
        assert "schemas/stage1-v1.json" in names
        raw_path = f"raw/sha256/{imported['import_provenance']['checksum_sha256']}.fit"
        assert raw_path in names
        assert bundle.read(raw_path) == FIXTURE.read_bytes()
        manifest = json.loads(bundle.read("manifest.json"))
        assert manifest["export_schema_version"] == "stage1-v1"
        assert manifest["record_counts"]["completed_activities.json"] == 1
        assert {item["path"] for item in manifest["files"]} == set(names)
        assert manifest_checksum(manifest) == manifest["manifest_content_sha256"]
        for item in manifest["files"]:
            if item["path"] == "manifest.json":
                continue
            assert hashlib.sha256(bundle.read(item["path"])).hexdigest() == item["sha256"]
            assert len(bundle.read(item["path"])) == item["bytes"]
        activity = json.loads(bundle.read("completed_activities.json"))[0]
        assert activity["original_values"]["duration_seconds"] == 57
        assert activity["effective_values"]["duration_seconds"] == 120
        assert json.loads(bundle.read("import_provenance.json"))[0]["export_path"] == raw_path
        assert isinstance(json.loads(bundle.read("links.json"))[0]["reasons"], list)
        assert json.loads(bundle.read("corrections.json"))[0]["reason"] == "Watch stopped late"
        assert json.loads(bundle.read("session_outcomes.json"))[0]["planned_session_id"] == run["id"]
        assert json.loads(bundle.read("check_ins.json"))[0]["feel"] == 4


def test_export_catalog_validates_every_populated_document_and_manifest(
    client: TestClient, database_url: str
) -> None:
    first_run = create_run(client)
    second_run = create_run(client)
    activity = client.post(
        "/api/activities/imports/fit",
        files={"file": ("run.fit", FIXTURE.read_bytes(), "application/octet-stream")},
    ).json()
    link_url = f"/api/activities/{activity['id']}/linking/link"
    assert client.post(
        f"/api/activities/{activity['id']}/linking/candidates/{first_run['id']}/confirm"
    ).status_code == 201
    assert client.put(
        link_url, json={"planned_session_id": second_run["id"], "expected_version": 1}
    ).status_code == 200
    assert client.post(
        f"/api/activities/{activity['id']}/corrections",
        json={"field_name": "duration_seconds", "replacement_value": 60, "reason": "Review"},
    ).status_code == 201
    for disposition in ("modified", "completed"):
        assert client.post(
            f"/api/planned-runs/{second_run['id']}/outcomes",
            json={"disposition": disposition, "reason": None},
        ).status_code == 201
    for payload in ({"readiness": 3}, {"post_session_effort": 7, "feel": 4}):
        assert client.post(
            f"/api/planned-runs/{second_run['id']}/check-ins", json=payload
        ).status_code == 201

    legacy_activity = client.post(
        "/api/activities",
        json={
            "modality": "running",
            "start_instant": "2017-07-11T08:00:00+00:00",
            "duration_seconds": 600,
        },
    ).json()
    with Session(create_engine(database_url)) as session:
        revision_id = session.get(PlannedSession, first_run["id"]).active_revision_id
        resolution = LegacyLinkResolution(
            completed_activity_id=legacy_activity["id"],
            status="resolved",
            selected_planned_session_id=first_run["id"],
            resolved_at=datetime.now(UTC),
        )
        session.add(resolution)
        session.flush()
        session.add_all(
            [
                LegacyLinkRecord(
                    id="legacy-export-record",
                    resolution_id=resolution.id,
                    planned_session_id=first_run["id"],
                    completed_activity_id=legacy_activity["id"],
                    linked_duration_seconds=600,
                    linked_distance_metres=None,
                    confirmation_source="direct",
                    version=1,
                    created_at=datetime.now(UTC),
                ),
                SuggestionRejection(
                    prescription_revision_id=revision_id,
                    completed_activity_id=legacy_activity["id"],
                    activity_effective_version=legacy_activity["created_at"],
                    algorithm_version="stage1-date-noon-v2",
                    rejected_at=datetime.now(UTC),
                ),
            ]
        )
        session.commit()

    response = client.post("/api/export")
    assert response.status_code == 200
    documents = read_bundle(response.content)
    catalog = documents["schemas/stage1-v1.json"]
    assert set(catalog["documents"]) == set(documents)
    for filename, document_schema in catalog["documents"].items():
        validate_schema(documents[filename], document_schema, catalog, filename)

    manifest = documents["manifest.json"]
    record_files = set(catalog["documents"]) - {"manifest.json", "schemas/stage1-v1.json"}
    assert all(documents[path] for path in record_files)
    assert manifest["record_counts"] == {path: len(documents[path]) for path in record_files}
    with ZipFile(io.BytesIO(response.content)) as bundle:
        assert {item["path"] for item in manifest["files"]} == set(bundle.namelist())
        for item in manifest["files"]:
            if item["path"] == "manifest.json":
                assert item["sha256"] == manifest_checksum(manifest)
                assert item["checksum_scope"] == (
                    "canonical manifest content excluding manifest_content_sha256 and this inventory entry"
                )
            else:
                content = bundle.read(item["path"])
                assert hashlib.sha256(content).hexdigest() == item["sha256"]
                assert len(content) == item["bytes"]


def test_split_links_survive_client_restart_and_export_complete_effective_evidence(
    client: TestClient,
) -> None:
    run = create_run(client)
    activities = []
    for start, duration, distance in (
        ("2017-06-11T08:00:00+00:00", 1200, 3000),
        ("2017-06-11T09:00:00+00:00", 1800, 4000),
    ):
        activity = client.post(
            "/api/activities",
            json={
                "modality": "running",
                "start_instant": start,
                "duration_seconds": duration,
                "distance_metres": distance,
            },
        ).json()
        assert activity["link_status"] == "linked"
        activities.append(activity)
    assert client.post(
        f"/api/activities/{activities[1]['id']}/corrections",
        json={"field_name": "duration_seconds", "replacement_value": 1900, "reason": "Review"},
    ).status_code == 201

    with TestClient(app, base_url="http://127.0.0.1") as restarted_client:
        exported = read_bundle(restarted_client.post("/api/export").content)

    links = exported["links.json"]
    assert {item["completed_activity_id"] for item in links} == {
        activity["id"] for activity in activities
    }
    assert {item["planned_session_id"] for item in links} == {run["id"]}
    exported_activities = {item["id"]: item for item in exported["completed_activities.json"]}
    assert exported_activities[activities[0]["id"]]["effective_values"]["duration_seconds"] == 1200
    assert exported_activities[activities[1]["id"]]["original_values"]["duration_seconds"] == 1800
    assert exported_activities[activities[1]["id"]]["effective_values"]["duration_seconds"] == 1900


def test_equivalent_snapshots_have_identical_logical_record_json(
    client: TestClient,
) -> None:
    create_run(client)
    first = read_bundle(client.post("/api/export").content)
    second = read_bundle(client.post("/api/export").content)
    first.pop("manifest.json")
    second.pop("manifest.json")
    assert first == second


def test_export_snapshot_never_mixes_a_concurrent_related_write(
    client: TestClient, database_url: str, monkeypatch
) -> None:
    run = create_run(client)
    activity = client.post(
        "/api/activities",
        json={
            "modality": "running",
            "start_instant": "2017-06-11T08:00:00+00:00",
            "duration_seconds": 1200,
        },
    ).json()
    entered_snapshot = threading.Event()
    release_snapshot = threading.Event()
    from tempo import exporting

    original_snapshot = exporting.snapshot

    def paused_snapshot(session, raw_directory):
        entered_snapshot.set()
        assert release_snapshot.wait(timeout=5)
        return original_snapshot(session, raw_directory)

    monkeypatch.setattr(exporting, "snapshot", paused_snapshot)
    exported: list[bytes] = []
    export_thread = threading.Thread(target=lambda: exported.append(client.post("/api/export").content))
    export_thread.start()
    assert entered_snapshot.wait(timeout=5)

    write_finished = threading.Event()

    def write_related_records() -> None:
        with Session(create_engine(database_url)) as session:
            session.add(
                SessionOutcome(
                    planned_session_id=run["id"],
                    disposition="completed",
                    reason=None,
                    recorded_at=datetime.now(UTC),
                )
            )
            session.add(
                CheckIn(
                    planned_session_id=run["id"],
                    readiness=4,
                    post_session_effort=None,
                    feel=None,
                    notes=None,
                    recorded_at=datetime.now(UTC),
                )
            )
            session.commit()
        write_finished.set()

    writer = threading.Thread(target=write_related_records)
    writer.start()
    assert not write_finished.wait(timeout=0.1)
    release_snapshot.set()
    export_thread.join(timeout=5)
    writer.join(timeout=5)
    assert not export_thread.is_alive()
    assert not writer.is_alive()

    documents = read_bundle(exported[0])
    assert documents["session_outcomes.json"] == []
    assert documents["check_ins.json"] == []
    with Session(create_engine(database_url)) as session:
        assert len(list(session.scalars(select(SessionOutcome)))) == 1
        assert len(list(session.scalars(select(CheckIn)))) == 1
    assert activity["id"]


def test_export_does_not_mutate_canonical_records(client: TestClient, monkeypatch) -> None:
    run = create_run(client)
    activity = client.post(
        "/api/activities",
        json={
            "modality": "running",
            "start_instant": "2017-06-11T08:00:00+00:00",
            "duration_seconds": 1200,
            "distance_metres": 3000,
        },
    ).json()
    from tempo import export_router

    observed: list[tuple[int, int, int, int]] = []
    original = export_router.archive

    def inspect(session):
        before = (
            session.query(CompletedActivity).count(),
            session.query(Link).count(),
            session.query(SessionOutcome).count(),
            session.query(CheckIn).count(),
        )
        exported = original(session)
        after = (
            session.query(CompletedActivity).count(),
            session.query(Link).count(),
            session.query(SessionOutcome).count(),
            session.query(CheckIn).count(),
        )
        observed.extend([before, after])
        return exported

    monkeypatch.setattr(export_router, "archive", inspect)
    assert client.post("/api/export").status_code == 200
    assert observed == [(1, 1, 0, 0), (1, 1, 0, 0)]
    assert activity["link_status"] == "linked"
    assert run["id"]


def test_export_rejects_corrupted_retained_raw_input(client: TestClient, data_directory: Path) -> None:
    imported = client.post(
        "/api/activities/imports/fit",
        files={"file": ("run.fit", FIXTURE.read_bytes(), "application/octet-stream")},
    ).json()
    checksum = imported["import_provenance"]["checksum_sha256"]
    raw_file = data_directory / "raw" / "fit" / f"{checksum}.fit"
    raw_file.write_bytes(b"corrupted")

    response = client.post("/api/export")

    assert response.status_code == 409
    assert "checksum does not match provenance" in response.json()["detail"]
