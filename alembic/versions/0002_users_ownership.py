"""users-tabell + projekt-ägarskap (multi-tenant)

Revision ID: 0002_users_ownership
Revises: 0001_initial
Create Date: 2026-07-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0002_users_ownership"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=True),
        sa.Column("name", sa.String(length=200), nullable=True),
        sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    with op.batch_alter_table("projects") as batch:
        batch.add_column(sa.Column("owner_id", sa.Integer(), nullable=True))
        batch.create_index("ix_projects_owner_id", ["owner_id"])
        batch.create_foreign_key("fk_projects_owner", "users", ["owner_id"], ["id"])


def downgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.drop_constraint("fk_projects_owner", type_="foreignkey")
        batch.drop_index("ix_projects_owner_id")
        batch.drop_column("owner_id")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
