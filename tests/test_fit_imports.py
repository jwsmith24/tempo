from hashlib import sha256
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from tempo.activities.models import ActivityImportProvenance, CompletedActivity
from tempo.activities.import_service import import_fit_activity
from tempo.activities import router as activities_router
from tempo.activities import fit_adapter

FIXTURE = Path(__file__).parent / "fixtures" / "garmin-fenix-5-run.fit"
UNSUPPORTED_FIXTURE = Path(__file__).parent / "fixtures" / "garmin-fenix-5-bike.fit"


def import_fixture(client: TestClient, content: bytes | None = None):
    return client.post(
        "/api/activities/imports/fit",
        files={"file": ("run.fit", content if content is not None else FIXTURE.read_bytes(), "application/octet-stream")},
    )


def test_fit_without_file_identity_uses_checksum_source_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fields = [
        SimpleNamespace(name="sport", value="running"),
        SimpleNamespace(name="start_time", value=datetime(2026, 9, 20, 6, 30, tzinfo=UTC)),
        SimpleNamespace(name="total_elapsed_time", value=1200.0),
        SimpleNamespace(name="total_distance", value=3210.0),
    ]
    frame = SimpleNamespace(
        frame_type=fit_adapter.fitdecode.FIT_FRAME_DATA,
        name="session",
        fields=fields,
    )

    class Reader:
        def __enter__(self):
            return iter([frame])

        def __exit__(self, *args):
            return None

    monkeypatch.setattr(fit_adapter.fitdecode, "FitReader", lambda *args, **kwargs: Reader())
    decoded = fit_adapter.decode_running_activity(b"valid session without file id")

    assert decoded.source_identity == f"sha256:{decoded.checksum_sha256}"
    assert decoded.duration_seconds == 1200


def test_imports_and_revisits_garmin_run_with_provenance(
    client: TestClient, database_url: str, data_directory: Path
) -> None:
    response = import_fixture(client)

    assert response.status_code == 201
    activity = response.json()
    assert activity["modality"] == "running"
    assert activity["start_instant"] == "2017-06-11T14:34:09Z"
    assert activity["duration_seconds"] == 57
    assert activity["distance_metres"] == 158
    assert activity["entry_source"] == "fit_import"
    assert activity["creation_provenance"] == "fit_adapter"
    assert activity["link_status"] == "unmatched"
    provenance = activity["import_provenance"]
    assert provenance["adapter_type"] == "garmin_fit"
    assert provenance["source_identity"] == "fit:garmin:fenix5:3945849289:2017-06-11T14:34:09+00:00"
    assert provenance["importer_name"] == "fitdecode"
    assert provenance["importer_version"] == "0.11.0"
    assert provenance["checksum_sha256"] == sha256(FIXTURE.read_bytes()).hexdigest()
    assert provenance["raw_file_identity"] == f"sha256/{provenance['checksum_sha256']}.fit"
    assert provenance["original_normalized_values"]["duration_seconds"] == 57
    assert "raw/fit" not in str(provenance)
    assert "planned_session_id" not in activity
    assert "session_outcome" not in activity

    assert client.get(f"/api/activities/{activity['id']}").json() == activity
    raw_file = data_directory / "raw" / "fit" / f"{provenance['checksum_sha256']}.fit"
    assert raw_file.read_bytes() == FIXTURE.read_bytes()
    assert raw_file.stat().st_mode & 0o777 == 0o600

    with Session(create_engine(database_url)) as restarted_session:
        persisted = restarted_session.get(CompletedActivity, activity["id"])
        assert persisted is not None
        assert persisted.import_provenance is not None


def test_identical_import_is_idempotent(
    client: TestClient, database_url: str, data_directory: Path
) -> None:
    first = import_fixture(client).json()
    second = import_fixture(client).json()

    assert second == first
    with Session(create_engine(database_url)) as session:
        assert session.scalar(select(func.count()).select_from(CompletedActivity)) == 1
        assert session.scalar(select(func.count()).select_from(ActivityImportProvenance)) == 1
    assert len(list((data_directory / "raw" / "fit").glob("*.fit"))) == 1


def test_same_fit_identity_with_different_valid_bytes_is_idempotent(
    client: TestClient, database_url: str, data_directory: Path
) -> None:
    content = FIXTURE.read_bytes()
    first = import_fixture(client, content).json()
    second = import_fixture(client, content + content).json()

    assert second == first
    with Session(create_engine(database_url)) as session:
        assert session.scalar(select(func.count()).select_from(CompletedActivity)) == 1
        assert session.scalar(select(func.count()).select_from(ActivityImportProvenance)) == 1
    assert len(list((data_directory / "raw" / "fit").glob("*.fit"))) == 1


def test_concurrent_identical_imports_keep_one_activity_and_raw_file(
    client: TestClient, database_url: str, data_directory: Path
) -> None:
    content = FIXTURE.read_bytes()

    def run_import(_: int) -> str:
        engine = create_engine(database_url)
        try:
            with Session(engine) as session:
                return import_fit_activity(content, session).id
        finally:
            engine.dispose()

    with ThreadPoolExecutor(max_workers=2) as pool:
        activity_ids = list(pool.map(run_import, range(2)))

    assert activity_ids[0] == activity_ids[1]
    with Session(create_engine(database_url)) as session:
        assert session.scalar(select(func.count()).select_from(CompletedActivity)) == 1
        provenance = session.scalar(select(ActivityImportProvenance))
        assert provenance is not None
    raw_file = data_directory / "raw" / "fit" / f"{provenance.checksum_sha256}.fit"
    assert raw_file.read_bytes() == content


def test_commit_failure_removes_staged_file_and_rolls_back(
    client: TestClient, database_url: str, data_directory: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    engine = create_engine(database_url)
    with Session(engine) as session:
        monkeypatch.setattr(session, "commit", lambda: (_ for _ in ()).throw(RuntimeError("commit failed")))
        with pytest.raises(RuntimeError, match="commit failed"):
            import_fit_activity(FIXTURE.read_bytes(), session)
    engine.dispose()

    with Session(create_engine(database_url)) as session:
        assert session.scalar(select(func.count()).select_from(CompletedActivity)) == 0
        assert session.scalar(select(func.count()).select_from(ActivityImportProvenance)) == 0
    raw_directory = data_directory / "raw" / "fit"
    assert not list(raw_directory.glob("*.fit"))
    assert not list(raw_directory.glob("*.pending"))


def test_restart_recovers_committed_pending_raw_file(
    client: TestClient, database_url: str, data_directory: Path
) -> None:
    activity = import_fixture(client).json()
    checksum = activity["import_provenance"]["checksum_sha256"]
    raw_directory = data_directory / "raw" / "fit"
    final = raw_directory / f"{checksum}.fit"
    pending = raw_directory / f".{checksum}.pending"
    final.replace(pending)

    with TestClient(client.app) as restarted_client:
        response = restarted_client.get(f"/api/activities/{activity['id']}")

    assert response.status_code == 200
    assert final.read_bytes() == FIXTURE.read_bytes()
    assert not pending.exists()


def test_unsupported_fit_activity_is_actionable_and_atomic(
    client: TestClient, database_url: str, data_directory: Path
) -> None:
    response = import_fixture(client, UNSUPPORTED_FIXTURE.read_bytes())

    assert response.status_code == 422
    assert response.json()["detail"] == "Only running FIT activities are supported in Stage 1."
    with Session(create_engine(database_url)) as session:
        assert session.scalar(select(func.count()).select_from(CompletedActivity)) == 0
    assert not (data_directory / "raw" / "fit").exists()


def test_oversized_fit_upload_is_rejected_before_decode(
    client: TestClient, database_url: str, data_directory: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(activities_router, "MAX_FIT_BYTES", 10)
    response = import_fixture(client, b"x" * 11)

    assert response.status_code == 413
    assert response.json()["detail"] == "FIT activity files must be 32 MB or smaller."
    with Session(create_engine(database_url)) as session:
        assert session.scalar(select(func.count()).select_from(CompletedActivity)) == 0
    assert not (data_directory / "raw" / "fit").exists()


@pytest.mark.parametrize("content", [b"not a fit file", b""])
def test_invalid_import_is_actionable_and_atomic(
    client: TestClient, database_url: str, data_directory: Path, content: bytes
) -> None:
    response = import_fixture(client, content)

    assert response.status_code == 422
    assert "FIT" in response.json()["detail"]
    with Session(create_engine(database_url)) as session:
        assert session.scalar(select(func.count()).select_from(CompletedActivity)) == 0
        assert session.scalar(select(func.count()).select_from(ActivityImportProvenance)) == 0
    assert not (data_directory / "raw" / "fit").exists()
