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
def client(database_url: str) -> Generator[TestClient, None, None]:
    previous_url = os.environ.get("TEMPO_DATABASE_URL")
    os.environ["TEMPO_DATABASE_URL"] = database_url
    config = Config("alembic.ini")
    command.upgrade(config, "head")
    test_engine = create_engine(database_url)

    def override_session() -> Generator[Session, None, None]:
        with Session(test_engine) as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    test_engine.dispose()
    if previous_url is None:
        os.environ.pop("TEMPO_DATABASE_URL", None)
    else:
        os.environ["TEMPO_DATABASE_URL"] = previous_url
