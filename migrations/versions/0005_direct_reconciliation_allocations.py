"""Allow direct, versioned Reconciliation allocations."""

from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("reconciliation_allocations") as batch_op:
        batch_op.add_column(sa.Column("version", sa.Integer(), nullable=False, server_default="1"))
        batch_op.drop_constraint("ck_allocation_confirmation_source", type_="check")
        batch_op.create_check_constraint(
            "ck_allocation_confirmation_source",
            "confirmation_source IN ('suggestion', 'direct')",
        )
        batch_op.create_check_constraint("ck_allocation_positive_version", "version > 0")


def downgrade() -> None:
    direct_allocations = op.get_bind().scalar(
        sa.text(
            "SELECT count(*) FROM reconciliation_allocations "
            "WHERE confirmation_source = 'direct'"
        )
    )
    if direct_allocations:
        raise RuntimeError(
            "Cannot downgrade revision 0005 while direct Reconciliation allocations exist."
        )
    with op.batch_alter_table("reconciliation_allocations") as batch_op:
        batch_op.drop_constraint("ck_allocation_positive_version", type_="check")
        batch_op.drop_constraint("ck_allocation_confirmation_source", type_="check")
        batch_op.create_check_constraint(
            "ck_allocation_confirmation_source", "confirmation_source IN ('suggestion')"
        )
        batch_op.drop_column("version")
