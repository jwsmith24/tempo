"""Create source-neutral Completed Activities."""

from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "completed_activities",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("modality", sa.String(16), nullable=False),
        sa.Column("start_instant", sa.String(40), nullable=False),
        sa.Column("duration_seconds", sa.Integer(), nullable=False),
        sa.Column("distance_metres", sa.Integer(), nullable=True),
        sa.Column("title", sa.String(200), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("entry_source", sa.String(16), nullable=False),
        sa.Column("creation_provenance", sa.String(32), nullable=False),
        sa.Column("created_at", sa.String(32), nullable=False),
        sa.CheckConstraint(
            "modality IN ('running', 'cycling', 'strength', 'other')",
            name="ck_completed_activity_modality",
        ),
        sa.CheckConstraint("duration_seconds > 0", name="ck_completed_activity_positive_duration"),
        sa.CheckConstraint(
            "distance_metres IS NULL OR distance_metres > 0",
            name="ck_completed_activity_positive_distance",
        ),
        sa.CheckConstraint(
            "entry_source IN ('manual', 'fit_import')",
            name="ck_completed_activity_entry_source",
        ),
    )
    op.create_index(
        "ix_completed_activities_start_instant",
        "completed_activities",
        ["start_instant"],
    )


def downgrade() -> None:
    op.drop_index("ix_completed_activities_start_instant", table_name="completed_activities")
    op.drop_table("completed_activities")
