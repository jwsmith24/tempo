"""Add append-only Session Outcome and Check-in records."""

from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "session_outcomes",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("planned_session_id", sa.String(36), nullable=False),
        sa.Column("disposition", sa.String(32), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("recorded_at", sa.String(32), nullable=False),
        sa.ForeignKeyConstraint(["planned_session_id"], ["planned_sessions.id"], ondelete="CASCADE"),
        sa.CheckConstraint("disposition IN ('completed', 'modified', 'rescheduled', 'intentionally_skipped', 'unintentionally_missed', 'replaced')", name="ck_session_outcome_disposition"),
    )
    op.create_index("ix_session_outcome_planned_session", "session_outcomes", ["planned_session_id"])
    op.create_table(
        "check_ins",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("planned_session_id", sa.String(36), nullable=False),
        sa.Column("readiness", sa.Integer(), nullable=True),
        sa.Column("post_session_effort", sa.Integer(), nullable=True),
        sa.Column("feel", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("recorded_at", sa.String(32), nullable=False),
        sa.ForeignKeyConstraint(["planned_session_id"], ["planned_sessions.id"], ondelete="CASCADE"),
        sa.CheckConstraint("readiness IS NULL OR readiness BETWEEN 1 AND 5", name="ck_check_in_readiness"),
        sa.CheckConstraint("post_session_effort IS NULL OR post_session_effort BETWEEN 1 AND 10", name="ck_check_in_post_session_effort"),
        sa.CheckConstraint("feel IS NULL OR feel BETWEEN 1 AND 5", name="ck_check_in_feel"),
        sa.CheckConstraint("readiness IS NOT NULL OR post_session_effort IS NOT NULL OR feel IS NOT NULL OR notes IS NOT NULL", name="ck_check_in_has_observation"),
    )
    op.create_index("ix_check_in_planned_session", "check_ins", ["planned_session_id"])


def downgrade() -> None:
    op.drop_index("ix_check_in_planned_session", table_name="check_ins")
    op.drop_table("check_ins")
    op.drop_index("ix_session_outcome_planned_session", table_name="session_outcomes")
    op.drop_table("session_outcomes")
