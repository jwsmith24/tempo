"""Rename the legacy planned-to-actual table to Links."""

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("reconciliation_allocations") as batch_op:
        batch_op.drop_constraint("ck_allocation_positive_duration", type_="check")
        batch_op.drop_constraint("ck_allocation_positive_distance", type_="check")
        batch_op.drop_constraint("ck_allocation_confirmation_source", type_="check")
        batch_op.drop_constraint("ck_allocation_positive_version", type_="check")
        batch_op.drop_constraint("uq_reconciliation_pair", type_="unique")
        batch_op.alter_column(
            "allocated_duration_seconds", new_column_name="linked_duration_seconds"
        )
        batch_op.alter_column(
            "allocated_distance_metres", new_column_name="linked_distance_metres"
        )
        batch_op.create_check_constraint("ck_link_positive_duration", "linked_duration_seconds > 0")
        batch_op.create_check_constraint(
            "ck_link_positive_distance",
            "linked_distance_metres IS NULL OR linked_distance_metres > 0",
        )
        batch_op.create_check_constraint(
            "ck_link_confirmation_source",
            "confirmation_source IN ('suggestion', 'direct')",
        )
        batch_op.create_check_constraint("ck_link_positive_version", "version > 0")
        batch_op.create_unique_constraint(
            "uq_link_pair", ["planned_session_id", "completed_activity_id"]
        )
    op.drop_index(
        "ix_reconciliation_planned_session", table_name="reconciliation_allocations"
    )
    op.drop_index(
        "ix_reconciliation_completed_activity", table_name="reconciliation_allocations"
    )
    op.rename_table("reconciliation_allocations", "links")
    op.create_index("ix_link_planned_session", "links", ["planned_session_id"])
    op.create_index("ix_link_completed_activity", "links", ["completed_activity_id"])


def downgrade() -> None:
    op.drop_index("ix_link_completed_activity", table_name="links")
    op.drop_index("ix_link_planned_session", table_name="links")
    op.rename_table("links", "reconciliation_allocations")
    with op.batch_alter_table("reconciliation_allocations") as batch_op:
        batch_op.drop_constraint("ck_link_positive_duration", type_="check")
        batch_op.drop_constraint("ck_link_positive_distance", type_="check")
        batch_op.drop_constraint("ck_link_confirmation_source", type_="check")
        batch_op.drop_constraint("ck_link_positive_version", type_="check")
        batch_op.drop_constraint("uq_link_pair", type_="unique")
        batch_op.alter_column(
            "linked_duration_seconds", new_column_name="allocated_duration_seconds"
        )
        batch_op.alter_column(
            "linked_distance_metres", new_column_name="allocated_distance_metres"
        )
        batch_op.create_check_constraint(
            "ck_allocation_positive_duration", "allocated_duration_seconds > 0"
        )
        batch_op.create_check_constraint(
            "ck_allocation_positive_distance",
            "allocated_distance_metres IS NULL OR allocated_distance_metres > 0",
        )
        batch_op.create_check_constraint(
            "ck_allocation_confirmation_source",
            "confirmation_source IN ('suggestion', 'direct')",
        )
        batch_op.create_check_constraint("ck_allocation_positive_version", "version > 0")
        batch_op.create_unique_constraint(
            "uq_reconciliation_pair", ["planned_session_id", "completed_activity_id"]
        )
    op.create_index(
        "ix_reconciliation_planned_session",
        "reconciliation_allocations",
        ["planned_session_id"],
    )
    op.create_index(
        "ix_reconciliation_completed_activity",
        "reconciliation_allocations",
        ["completed_activity_id"],
    )
