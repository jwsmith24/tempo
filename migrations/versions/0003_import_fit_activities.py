"""Add FIT activity import provenance."""

from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "activity_import_provenance",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "completed_activity_id",
            sa.String(36),
            sa.ForeignKey("completed_activities.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("adapter_type", sa.String(32), nullable=False),
        sa.Column("source_identity", sa.String(500), nullable=False),
        sa.Column("importer_name", sa.String(64), nullable=False),
        sa.Column("importer_version", sa.String(32), nullable=False),
        sa.Column("imported_at", sa.String(32), nullable=False),
        sa.Column("raw_file_identity", sa.String(80), nullable=False, unique=True),
        sa.Column("checksum_sha256", sa.String(64), nullable=False),
        sa.Column("original_normalized_values", sa.Text(), nullable=False),
    )
    op.create_index(
        "uq_activity_import_source_identity",
        "activity_import_provenance",
        ["adapter_type", "source_identity"],
        unique=True,
    )
    op.create_index(
        "uq_activity_import_checksum",
        "activity_import_provenance",
        ["checksum_sha256"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_activity_import_checksum", table_name="activity_import_provenance")
    op.drop_index("uq_activity_import_source_identity", table_name="activity_import_provenance")
    op.drop_table("activity_import_provenance")
