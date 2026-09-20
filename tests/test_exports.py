import hashlib
import io
import json
from pathlib import Path
from zipfile import ZipFile

from fastapi.testclient import TestClient

from tempo.activities.models import CompletedActivity
from tempo.exporting import manifest_checksum
from tempo.linking.models import CheckIn, Link, SessionOutcome

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
