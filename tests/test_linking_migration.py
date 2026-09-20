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


def seed_revision_0005(database: Path) -> None:
    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys=ON")
        for suffix, source in (("suggested", "suggestion"), ("direct", "direct")):
            plan_id = f"plan-{suffix}"
            revision_id = f"revision-{suffix}"
            activity_id = f"activity-{suffix}"
            connection.execute(
                """
                INSERT INTO planned_sessions
                    (id, modality, scheduled_date, training_intent, priority, notes,
                     created_at, active_revision_id)
                VALUES (?, 'running', '2026-09-20', 'aerobic_base', 'normal', NULL,
                        '2026-09-20T00:00:00+00:00', NULL)
                """,
                (plan_id,),
            )
            connection.execute(
                """
                INSERT INTO prescription_revisions
                    (id, planned_session_id, revision_number, duration_seconds,
                     distance_metres, reason, provenance, created_at)
                VALUES (?, ?, 1, 3600, 10000, 'initial_entry', 'athlete_entry',
                        '2026-09-20T00:00:00+00:00')
                """,
                (revision_id, plan_id),
            )
            connection.execute(
                "UPDATE planned_sessions SET active_revision_id = ? WHERE id = ?",
                (revision_id, plan_id),
            )
            connection.execute(
                """
                INSERT INTO completed_activities
                    (id, modality, start_instant, duration_seconds, distance_metres,
                     title, notes, entry_source, creation_provenance, created_at)
                VALUES (?, 'running', '2026-09-20T08:00:00+00:00', 3300, 9000,
                        NULL, NULL, 'manual', 'athlete_entry',
                        '2026-09-20T00:00:00+00:00')
                """,
                (activity_id,),
            )
            connection.execute(
                """
                INSERT INTO reconciliation_allocations
                    (id, planned_session_id, completed_activity_id,
                     allocated_duration_seconds, allocated_distance_metres,
                     confirmation_source, version, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"link-{suffix}",
                    plan_id,
                    activity_id,
                    1200 if source == "suggestion" else 1800,
                    3000 if source == "suggestion" else None,
                    source,
                    2 if source == "suggestion" else 4,
                    f"2026-09-20T0{1 if source == 'suggestion' else 2}:00:00+00:00",
                ),
            )


def rows(connection: sqlite3.Connection, table: str, duration: str, distance: str):
    return connection.execute(
        f"""
        SELECT id, planned_session_id, completed_activity_id, {duration}, {distance},
               confirmation_source, version, created_at
        FROM {table} ORDER BY id
        """
    ).fetchall()


def schema_sql(connection: sqlite3.Connection, table: str) -> str:
    result = connection.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
    ).fetchone()
    assert result is not None
    return result[0]


def foreign_keys(connection: sqlite3.Connection, table: str) -> set[tuple[str, str, str, str]]:
    return {
        (foreign_key[2], foreign_key[3], foreign_key[4], foreign_key[6])
        for foreign_key in connection.execute(f"PRAGMA foreign_key_list({table})")
    }


def test_link_migration_preserves_populated_records_and_schema(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    database = tmp_path / "link-migration.db"
    monkeypatch.setenv("TEMPO_DATABASE_URL", f"sqlite:///{database}")
    config = Config("alembic.ini")
    migrate(config, "0005")
    seed_revision_0005(database)

    with sqlite3.connect(database) as connection:
        before = rows(
            connection,
            "reconciliation_allocations",
            "allocated_duration_seconds",
            "allocated_distance_metres",
        )

    migrate(config, "0006")

    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys=ON")
        assert rows(
            connection, "links", "linked_duration_seconds", "linked_distance_metres"
        ) == before
        columns = {
            column[1]: column[3] for column in connection.execute("PRAGMA table_info(links)")
        }
        assert set(columns) == {
            "id",
            "planned_session_id",
            "completed_activity_id",
            "linked_duration_seconds",
            "linked_distance_metres",
            "confirmation_source",
            "created_at",
            "version",
        }
        assert columns == {
            "id": 1,
            "planned_session_id": 1,
            "completed_activity_id": 1,
            "linked_duration_seconds": 1,
            "linked_distance_metres": 0,
            "confirmation_source": 1,
            "created_at": 1,
            "version": 1,
        }
        assert {index[1] for index in connection.execute("PRAGMA index_list(links)")} >= {
            "ix_link_planned_session",
            "ix_link_completed_activity",
        }
        assert foreign_keys(connection, "links") == {
            ("completed_activities", "completed_activity_id", "id", "CASCADE"),
            ("planned_sessions", "planned_session_id", "id", "CASCADE"),
        }
        table_sql = schema_sql(connection, "links")
        for constraint in (
            "ck_link_positive_duration",
            "ck_link_positive_distance",
            "ck_link_confirmation_source",
            "ck_link_positive_version",
            "uq_link_pair",
        ):
            assert constraint in table_sql
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []

        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                INSERT INTO links
                    (id, planned_session_id, completed_activity_id,
                     linked_duration_seconds, linked_distance_metres,
                     confirmation_source, version, created_at)
                VALUES ('duplicate', 'plan-direct', 'activity-direct', 1, NULL,
                        'direct', 1, '2026-09-20T03:00:00+00:00')
                """
            )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "UPDATE links SET linked_duration_seconds = 0 WHERE id = 'link-direct'"
            )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "UPDATE links SET linked_distance_metres = 0 WHERE id = 'link-direct'"
            )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "UPDATE links SET confirmation_source = 'automatic' WHERE id = 'link-direct'"
            )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute("UPDATE links SET version = 0 WHERE id = 'link-direct'")

        connection.execute("SAVEPOINT cascade_check")
        connection.execute("DELETE FROM completed_activities WHERE id = 'activity-suggested'")
        assert connection.execute(
            "SELECT count(*) FROM links WHERE id = 'link-suggested'"
        ).fetchone() == (0,)
        connection.execute("ROLLBACK TO cascade_check")
        connection.execute("RELEASE cascade_check")
        connection.execute("SAVEPOINT plan_cascade_check")
        connection.execute("DELETE FROM planned_sessions WHERE id = 'plan-direct'")
        assert connection.execute(
            "SELECT count(*) FROM links WHERE id = 'link-direct'"
        ).fetchone() == (0,)
        connection.execute("ROLLBACK TO plan_cascade_check")
        connection.execute("RELEASE plan_cascade_check")

    migrate(config, "-0005")

    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys=ON")
        assert rows(
            connection,
            "reconciliation_allocations",
            "allocated_duration_seconds",
            "allocated_distance_metres",
        ) == before
        columns = {
            column[1]: column[3]
            for column in connection.execute(
                "PRAGMA table_info(reconciliation_allocations)"
            )
        }
        assert set(columns) == {
            "id",
            "planned_session_id",
            "completed_activity_id",
            "allocated_duration_seconds",
            "allocated_distance_metres",
            "confirmation_source",
            "created_at",
            "version",
        }
        assert columns["allocated_duration_seconds"] == 1
        assert columns["allocated_distance_metres"] == 0
        assert {index[1] for index in connection.execute(
            "PRAGMA index_list(reconciliation_allocations)"
        )} >= {
            "ix_reconciliation_planned_session",
            "ix_reconciliation_completed_activity",
        }
        assert foreign_keys(connection, "reconciliation_allocations") == {
            ("completed_activities", "completed_activity_id", "id", "CASCADE"),
            ("planned_sessions", "planned_session_id", "id", "CASCADE"),
        }
        table_sql = schema_sql(connection, "reconciliation_allocations")
        for constraint in (
            "ck_allocation_positive_duration",
            "ck_allocation_positive_distance",
            "ck_allocation_confirmation_source",
            "ck_allocation_positive_version",
            "uq_reconciliation_pair",
        ):
            assert constraint in table_sql
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                INSERT INTO reconciliation_allocations
                    (id, planned_session_id, completed_activity_id,
                     allocated_duration_seconds, allocated_distance_metres,
                     confirmation_source, version, created_at)
                VALUES ('duplicate-restored', 'plan-direct', 'activity-direct', 1,
                        NULL, 'direct', 1, '2026-09-20T03:00:00+00:00')
                """
            )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                UPDATE reconciliation_allocations
                SET allocated_duration_seconds = 0 WHERE id = 'link-direct'
                """
            )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                UPDATE reconciliation_allocations
                SET allocated_distance_metres = 0 WHERE id = 'link-direct'
                """
            )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                UPDATE reconciliation_allocations
                SET confirmation_source = 'automatic' WHERE id = 'link-direct'
                """
            )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "UPDATE reconciliation_allocations SET version = 0 WHERE id = 'link-direct'"
            )
        connection.execute("SAVEPOINT restored_cascade_check")
        connection.execute("DELETE FROM planned_sessions WHERE id = 'plan-suggested'")
        assert connection.execute(
            "SELECT count(*) FROM reconciliation_allocations WHERE id = 'link-suggested'"
        ).fetchone() == (0,)
        connection.execute("ROLLBACK TO restored_cascade_check")
        connection.execute("RELEASE restored_cascade_check")
        connection.execute("SAVEPOINT restored_activity_cascade_check")
        connection.execute("DELETE FROM completed_activities WHERE id = 'activity-direct'")
        assert connection.execute(
            "SELECT count(*) FROM reconciliation_allocations WHERE id = 'link-direct'"
        ).fetchone() == (0,)
        connection.execute("ROLLBACK TO restored_activity_cascade_check")
        connection.execute("RELEASE restored_activity_cascade_check")
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []

    with pytest.raises(RuntimeError, match="direct Reconciliation allocations exist"):
        migrate(config, "-0004")

    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT version_num FROM alembic_version").fetchone() == (
            "0005",
        )
        assert rows(
            connection,
            "reconciliation_allocations",
            "allocated_duration_seconds",
            "allocated_distance_metres",
        ) == before
