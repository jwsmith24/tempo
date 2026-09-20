"""Add append-only Completed Activity Corrections."""

from alembic import op
import sqlalchemy as sa

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "corrections",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("completed_activity_id", sa.String(36), nullable=False),
        sa.Column("field_name", sa.String(32), nullable=False),
        sa.Column("source_value", sa.Text(), nullable=False),
        sa.Column("replacement_value", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("recorded_at", sa.String(32), nullable=False),
        sa.ForeignKeyConstraint(["completed_activity_id"], ["completed_activities.id"], ondelete="CASCADE"),
        sa.CheckConstraint("field_name IN ('start_instant', 'modality', 'duration_seconds', 'distance_metres', 'title', 'notes')", name="ck_correction_field_name"),
    )
    op.create_index("ix_correction_activity", "corrections", ["completed_activity_id"])


def downgrade() -> None:
    op.drop_index("ix_correction_activity", table_name="corrections")
    op.drop_table("corrections")
