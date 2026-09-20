"""Replace allocated Links with whole-activity ownership."""

from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    op.create_table(
        "legacy_link_resolutions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("completed_activity_id", sa.String(36), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("selected_planned_session_id", sa.String(36), nullable=True),
        sa.Column("resolved_at", sa.String(32), nullable=True),
        sa.ForeignKeyConstraint(["completed_activity_id"], ["completed_activities.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["selected_planned_session_id"], ["planned_sessions.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("completed_activity_id", name="uq_legacy_resolution_activity"),
        sa.CheckConstraint("status IN ('unresolved', 'resolved')", name="ck_legacy_resolution_status"),
    )
    op.create_table(
        "legacy_link_records",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("resolution_id", sa.String(36), nullable=True),
        sa.Column("planned_session_id", sa.String(36), nullable=False),
        sa.Column("completed_activity_id", sa.String(36), nullable=False),
        sa.Column("linked_duration_seconds", sa.Integer(), nullable=False),
        sa.Column("linked_distance_metres", sa.Integer(), nullable=True),
        sa.Column("confirmation_source", sa.String(32), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.String(32), nullable=False),
        sa.ForeignKeyConstraint(["resolution_id"], ["legacy_link_resolutions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["planned_session_id"], ["planned_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["completed_activity_id"], ["completed_activities.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_legacy_link_record_activity", "legacy_link_records", ["completed_activity_id"])

    rows = connection.execute(sa.text("SELECT * FROM links ORDER BY id")).mappings().all()
    counts: dict[str, int] = {}
    resolution_ids: dict[str, str] = {}
    for row in rows:
        activity_id = row["completed_activity_id"]
        counts[activity_id] = counts.get(activity_id, 0) + 1
        resolution_ids.setdefault(activity_id, row["id"])
    for activity_id, count in counts.items():
        if count > 1:
            connection.execute(
                sa.text("INSERT INTO legacy_link_resolutions (id, completed_activity_id, status) VALUES (:id, :activity_id, 'unresolved')"),
                {"id": resolution_ids[activity_id], "activity_id": activity_id},
            )
    for row in rows:
        resolution_id = resolution_ids[row["completed_activity_id"]] if counts[row["completed_activity_id"]] > 1 else None
        connection.execute(
            sa.text("""
                INSERT INTO legacy_link_records
                    (id, resolution_id, planned_session_id, completed_activity_id,
                     linked_duration_seconds, linked_distance_metres,
                     confirmation_source, version, created_at)
                VALUES (:id, :resolution_id, :planned_session_id, :completed_activity_id,
                        :linked_duration_seconds, :linked_distance_metres,
                        :confirmation_source, :version, :created_at)
            """),
            {**dict(row), "resolution_id": resolution_id},
        )

    op.drop_index("ix_link_completed_activity", table_name="links")
    op.drop_index("ix_link_planned_session", table_name="links")
    op.rename_table("links", "allocated_links_0006")
    op.create_table(
        "links",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("planned_session_id", sa.String(36), nullable=False),
        sa.Column("completed_activity_id", sa.String(36), nullable=False),
        sa.Column("source", sa.String(32), nullable=False),
        sa.Column("algorithm_version", sa.String(64), nullable=True),
        sa.Column("reasons", sa.Text(), nullable=True),
        sa.Column("created_at", sa.String(32), nullable=False),
        sa.ForeignKeyConstraint(["planned_session_id"], ["planned_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["completed_activity_id"], ["completed_activities.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("completed_activity_id", name="uq_link_completed_activity"),
        sa.CheckConstraint("source IN ('automatic', 'athlete_confirmed', 'direct')", name="ck_link_source"),
    )
    op.create_index("ix_link_planned_session", "links", ["planned_session_id"])
    op.create_index("ix_link_completed_activity", "links", ["completed_activity_id"])
    connection.execute(sa.text("""
        INSERT INTO links (id, planned_session_id, completed_activity_id, source,
                           algorithm_version, reasons, created_at)
        SELECT id, planned_session_id, completed_activity_id,
               CASE confirmation_source WHEN 'suggestion' THEN 'athlete_confirmed' ELSE 'direct' END,
               CASE confirmation_source WHEN 'suggestion' THEN 'stage1-date-noon-v1' ELSE NULL END,
               '["Migrated from the athlete-confirmed allocated Link."]', created_at
        FROM allocated_links_0006
        WHERE completed_activity_id IN (
            SELECT completed_activity_id FROM allocated_links_0006
            GROUP BY completed_activity_id HAVING count(*) = 1
        )
    """))
    op.drop_table("allocated_links_0006")


def downgrade() -> None:
    connection = op.get_bind()
    unarchived = connection.execute(sa.text("""
        SELECT count(*) FROM links l
        LEFT JOIN legacy_link_records r ON r.id = l.id
        WHERE r.id IS NULL
    """)).scalar_one()
    resolved = connection.execute(sa.text("SELECT count(*) FROM legacy_link_resolutions WHERE status = 'resolved'")).scalar_one()
    if unarchived or resolved:
        raise RuntimeError("Cannot downgrade whole-activity Links after new or resolved Link data exists")
    op.drop_index("ix_link_completed_activity", table_name="links")
    op.drop_index("ix_link_planned_session", table_name="links")
    op.drop_table("links")
    op.create_table(
        "links",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("planned_session_id", sa.String(36), nullable=False),
        sa.Column("completed_activity_id", sa.String(36), nullable=False),
        sa.Column("linked_duration_seconds", sa.Integer(), nullable=False),
        sa.Column("linked_distance_metres", sa.Integer(), nullable=True),
        sa.Column("confirmation_source", sa.String(32), nullable=False),
        sa.Column("created_at", sa.String(32), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["planned_session_id"], ["planned_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["completed_activity_id"], ["completed_activities.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("planned_session_id", "completed_activity_id", name="uq_link_pair"),
        sa.CheckConstraint("linked_duration_seconds > 0", name="ck_link_positive_duration"),
        sa.CheckConstraint("linked_distance_metres IS NULL OR linked_distance_metres > 0", name="ck_link_positive_distance"),
        sa.CheckConstraint("confirmation_source IN ('suggestion', 'direct')", name="ck_link_confirmation_source"),
        sa.CheckConstraint("version > 0", name="ck_link_positive_version"),
    )
    op.create_index("ix_link_planned_session", "links", ["planned_session_id"])
    op.create_index("ix_link_completed_activity", "links", ["completed_activity_id"])
    connection.execute(sa.text("""
        INSERT INTO links SELECT id, planned_session_id, completed_activity_id,
            linked_duration_seconds, linked_distance_metres, confirmation_source,
            created_at, version FROM legacy_link_records
    """))
    op.drop_index("ix_legacy_link_record_activity", table_name="legacy_link_records")
    op.drop_table("legacy_link_records")
    op.drop_table("legacy_link_resolutions")
