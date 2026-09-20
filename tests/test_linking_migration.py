import sqlite3
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config


def migrate(config: Config, revision: str) -> None:
    if revision.startswith("-"):
        command.downgrade(config, revision[1:])
    else:
        command.upgrade(config, revision)


def seed_plan(connection: sqlite3.Connection, suffix: str) -> None:
    connection.execute(
        "INSERT INTO planned_sessions VALUES (?, 'running', '2026-09-20', 'aerobic_base', 'normal', NULL, '2026-09-20T00:00:00Z', NULL)",
        (f"plan-{suffix}",),
    )
    connection.execute(
        "INSERT INTO prescription_revisions VALUES (?, ?, 1, 3600, 10000, 'initial_entry', 'athlete_entry', '2026-09-20T00:00:00Z')",
        (f"revision-{suffix}", f"plan-{suffix}"),
    )
    connection.execute(
        "UPDATE planned_sessions SET active_revision_id = ? WHERE id = ?",
        (f"revision-{suffix}", f"plan-{suffix}"),
    )


def seed_activity(connection: sqlite3.Connection, suffix: str) -> None:
    connection.execute(
        "INSERT INTO completed_activities VALUES (?, 'running', '2026-09-20T08:00:00+00:00', 3300, 9000, NULL, NULL, 'manual', 'athlete_entry', '2026-09-20T00:00:00Z')",
        (f"activity-{suffix}",),
    )


def seed_link(
    connection: sqlite3.Connection, suffix: str, activity_suffix: str, duration: int
) -> None:
    connection.execute(
        "INSERT INTO links VALUES (?, ?, ?, ?, ?, 'direct', 1, '2026-09-20T01:00:00Z')",
        (
            f"link-{suffix}",
            f"plan-{suffix}",
            f"activity-{activity_suffix}",
            duration,
            duration * 2,
        ),
    )


def test_migration_preserves_zero_one_and_multiple_link_activities(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    database = tmp_path / "whole-links.db"
    monkeypatch.setenv("TEMPO_DATABASE_URL", f"sqlite:///{database}")
    config = Config("alembic.ini")
    migrate(config, "0006")
    with sqlite3.connect(database) as connection:
        for suffix in ("one", "multi-a", "multi-b"):
            seed_plan(connection, suffix)
        for suffix in ("zero", "one", "multi"):
            seed_activity(connection, suffix)
        seed_link(connection, "one", "one", 3300)
        seed_link(connection, "multi-a", "multi", 1200)
        seed_link(connection, "multi-b", "multi", 1800)

    migrate(config, "0007")

    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys=ON")
        assert connection.execute(
            "SELECT id, planned_session_id, completed_activity_id, source FROM links"
        ).fetchall() == [("link-one", "plan-one", "activity-one", "direct")]
        columns = {row[1] for row in connection.execute("PRAGMA table_info(links)")}
        assert columns == {
            "id",
            "planned_session_id",
            "completed_activity_id",
            "source",
            "algorithm_version",
            "reasons",
            "version",
            "created_at",
        }
        assert connection.execute(
            "SELECT completed_activity_id, status FROM legacy_link_resolutions"
        ).fetchall() == [("activity-multi", "unresolved")]
        preserved = connection.execute(
            "SELECT id, planned_session_id, completed_activity_id, linked_duration_seconds, linked_distance_metres FROM legacy_link_records ORDER BY id"
        ).fetchall()
        assert preserved == [
            ("link-multi-a", "plan-multi-a", "activity-multi", 1200, 2400),
            ("link-multi-b", "plan-multi-b", "activity-multi", 1800, 3600),
            ("link-one", "plan-one", "activity-one", 3300, 6600),
        ]
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "INSERT INTO links VALUES ('duplicate', 'plan-multi-a', 'activity-one', 'direct', NULL, '[]', 1, '2026-09-20T02:00:00Z')"
            )
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []

    migrate(config, "-0006")
    with sqlite3.connect(database) as connection:
        restored = connection.execute(
            "SELECT id, planned_session_id, completed_activity_id, linked_duration_seconds FROM links ORDER BY id"
        ).fetchall()
        assert restored == [
            ("link-multi-a", "plan-multi-a", "activity-multi", 1200),
            ("link-multi-b", "plan-multi-b", "activity-multi", 1800),
            ("link-one", "plan-one", "activity-one", 3300),
        ]


@pytest.mark.parametrize("mutation", ["change", "remove"])
def test_downgrade_refuses_changed_or_removed_migrated_link(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, mutation: str
) -> None:
    database = tmp_path / f"unsafe-{mutation}.db"
    monkeypatch.setenv("TEMPO_DATABASE_URL", f"sqlite:///{database}")
    config = Config("alembic.ini")
    migrate(config, "0006")
    with sqlite3.connect(database) as connection:
        seed_plan(connection, "one")
        seed_plan(connection, "other")
        seed_activity(connection, "one")
        seed_link(connection, "one", "one", 3300)
    migrate(config, "0007")
    with sqlite3.connect(database) as connection:
        if mutation == "change":
            connection.execute(
                "UPDATE links SET planned_session_id = 'plan-other' WHERE id = 'link-one'"
            )
        else:
            connection.execute("DELETE FROM links WHERE id = 'link-one'")
    with pytest.raises(RuntimeError, match="Cannot downgrade"):
        migrate(config, "-0006")
