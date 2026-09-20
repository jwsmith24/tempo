import os
from collections.abc import Generator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from tempo.database import get_session
from tempo.main import app


@pytest.fixture
def database_url(tmp_path: Path) -> str:
    return f"sqlite:///{tmp_path / 'tempo-test.db'}"


@pytest.fixture
def data_directory(tmp_path: Path) -> Path:
    return tmp_path / "application-data"


@pytest.fixture
def client(database_url: str, data_directory: Path) -> Generator[TestClient, None, None]:
    previous_url = os.environ.get("TEMPO_DATABASE_URL")
    previous_data_directory = os.environ.get("TEMPO_DATA_DIR")
    os.environ["TEMPO_DATABASE_URL"] = database_url
    os.environ["TEMPO_DATA_DIR"] = str(data_directory)
    config = Config("alembic.ini")
    command.upgrade(config, "head")
    test_engine = create_engine(database_url)

    def override_session() -> Generator[Session, None, None]:
        with Session(test_engine) as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    with TestClient(app, base_url="http://127.0.0.1") as test_client:
        yield test_client
    app.dependency_overrides.clear()
    test_engine.dispose()
    if previous_url is None:
        os.environ.pop("TEMPO_DATABASE_URL", None)
    else:
        os.environ["TEMPO_DATABASE_URL"] = previous_url
    if previous_data_directory is None:
        os.environ.pop("TEMPO_DATA_DIR", None)
    else:
        os.environ["TEMPO_DATA_DIR"] = previous_data_directory
