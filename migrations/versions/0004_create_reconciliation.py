"""Add suggestion decisions and Reconciliation allocations."""

from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reconciliation_allocations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("planned_session_id", sa.String(36), sa.ForeignKey("planned_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("completed_activity_id", sa.String(36), sa.ForeignKey("completed_activities.id", ondelete="CASCADE"), nullable=False),
        sa.Column("allocated_duration_seconds", sa.Integer(), nullable=False),
        sa.Column("allocated_distance_metres", sa.Integer(), nullable=True),
        sa.Column("confirmation_source", sa.String(32), nullable=False),
        sa.Column("created_at", sa.String(32), nullable=False),
        sa.CheckConstraint("allocated_duration_seconds > 0", name="ck_allocation_positive_duration"),
        sa.CheckConstraint("allocated_distance_metres IS NULL OR allocated_distance_metres > 0", name="ck_allocation_positive_distance"),
        sa.CheckConstraint("confirmation_source IN ('suggestion')", name="ck_allocation_confirmation_source"),
        sa.UniqueConstraint("planned_session_id", "completed_activity_id", name="uq_reconciliation_pair"),
    )
    op.create_index("ix_reconciliation_planned_session", "reconciliation_allocations", ["planned_session_id"])
    op.create_index("ix_reconciliation_completed_activity", "reconciliation_allocations", ["completed_activity_id"])
    op.create_table(
        "suggestion_rejections",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("prescription_revision_id", sa.String(36), sa.ForeignKey("prescription_revisions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("completed_activity_id", sa.String(36), sa.ForeignKey("completed_activities.id", ondelete="CASCADE"), nullable=False),
        sa.Column("activity_effective_version", sa.String(64), nullable=False),
        sa.Column("algorithm_version", sa.String(64), nullable=False),
        sa.Column("rejected_at", sa.String(32), nullable=False),
        sa.UniqueConstraint("prescription_revision_id", "completed_activity_id", "activity_effective_version", "algorithm_version", name="uq_suggestion_rejection_version"),
    )
    op.create_index("ix_suggestion_rejection_revision", "suggestion_rejections", ["prescription_revision_id"])


def downgrade() -> None:
    op.drop_index("ix_suggestion_rejection_revision", table_name="suggestion_rejections")
    op.drop_table("suggestion_rejections")
    op.drop_index("ix_reconciliation_completed_activity", table_name="reconciliation_allocations")
    op.drop_index("ix_reconciliation_planned_session", table_name="reconciliation_allocations")
    op.drop_table("reconciliation_allocations")
