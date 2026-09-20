import os
import sqlite3
import sys
from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session


class Base(DeclarativeBase):
    pass


def database_url() -> str:
    configured = os.getenv("TEMPO_DATABASE_URL")
    if configured:
        return configured
    parent = (
        Path.home() / "Library" / "Application Support" / "Tempo"
        if sys.platform == "darwin"
        else Path.home() / ".local" / "share" / "tempo"
    )
    parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    parent.chmod(0o700)
    database = parent / "tempo.db"
    database.touch(mode=0o600, exist_ok=True)
    database.chmod(0o600)
    return f"sqlite:///{database}"


def application_data_directory() -> Path:
    configured = os.getenv("TEMPO_DATA_DIR")
    if configured:
        directory = Path(configured)
    else:
        directory = (
            Path.home() / "Library" / "Application Support" / "Tempo"
            if sys.platform == "darwin"
            else Path.home() / ".local" / "share" / "tempo"
        )
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    directory.chmod(0o700)
    return directory


@event.listens_for(Engine, "connect")
def configure_sqlite(connection: object, _: object) -> None:
    if not isinstance(connection, sqlite3.Connection):
        return
    connection.execute("PRAGMA foreign_keys=ON")
    for _, _, filename in connection.execute("PRAGMA database_list"):
        if filename:
            Path(filename).chmod(0o600)


engine = create_engine(database_url())


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session
