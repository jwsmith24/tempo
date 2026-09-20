"""Create Planned Sessions and initial Prescription Revisions."""

from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "planned_sessions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("modality", sa.String(16), nullable=False),
        sa.Column("scheduled_date", sa.Date(), nullable=False),
        sa.Column("training_intent", sa.String(32), nullable=False),
        sa.Column("priority", sa.String(16), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.String(32), nullable=False),
        sa.Column("active_revision_id", sa.String(36), nullable=True),
        sa.CheckConstraint("modality = 'running'", name="ck_planned_session_running"),
        sa.CheckConstraint(
            "training_intent IN ('recovery', 'aerobic_base', 'threshold', 'power', 'assessment')",
            name="ck_planned_session_training_intent",
        ),
        sa.CheckConstraint(
            "priority IN ('low', 'normal', 'high')",
            name="ck_planned_session_priority",
        ),
    )
    op.create_table(
        "prescription_revisions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "planned_session_id",
            sa.String(36),
            sa.ForeignKey("planned_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("revision_number", sa.Integer(), nullable=False),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("distance_metres", sa.Integer(), nullable=True),
        sa.Column("reason", sa.String(64), nullable=False),
        sa.Column("provenance", sa.String(32), nullable=False),
        sa.Column("created_at", sa.String(32), nullable=False),
        sa.CheckConstraint(
            "duration_seconds IS NOT NULL OR distance_metres IS NOT NULL",
            name="ck_prescription_has_measure",
        ),
        sa.CheckConstraint(
            "duration_seconds IS NULL OR duration_seconds > 0",
            name="ck_prescription_positive_duration",
        ),
        sa.CheckConstraint(
            "distance_metres IS NULL OR distance_metres > 0",
            name="ck_prescription_positive_distance",
        ),
        sa.UniqueConstraint(
            "planned_session_id", "revision_number", name="uq_prescription_revision_number"
        ),
    )
    with op.batch_alter_table("planned_sessions") as batch_op:
        batch_op.create_foreign_key(
            "fk_planned_session_active_revision",
            "prescription_revisions",
            ["active_revision_id"],
            ["id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("planned_sessions") as batch_op:
        batch_op.drop_constraint("fk_planned_session_active_revision", type_="foreignkey")
    op.drop_table("prescription_revisions")
    op.drop_table("planned_sessions")
