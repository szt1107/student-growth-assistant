"""Local calendar entries, occurrence exceptions and idempotent writes."""
from alembic import op
import sqlalchemy as sa
revision='0006_calendar'
down_revision='0005_secretary_memory'
branch_labels=depends_on=None

def upgrade():
    if 'calendar_entries' not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table('calendar_entries',sa.Column('id',sa.Integer,primary_key=True),
            sa.Column('source_key',sa.String(160),unique=True),
            sa.Column('source_rule_id',sa.Integer,sa.ForeignKey('time_rules.id')),sa.Column('source_date',sa.Date),
            sa.Column('title',sa.String(160),nullable=False),sa.Column('description',sa.Text,nullable=False),
            sa.Column('start_at',sa.DateTime,nullable=False),sa.Column('end_at',sa.DateTime,nullable=False),
            sa.Column('all_day',sa.Boolean,nullable=False),sa.Column('blocks_time',sa.Boolean,nullable=False),sa.Column('deleted',sa.Boolean,nullable=False),
            sa.CheckConstraint('end_at > start_at',name='calendar_positive_interval'))
        op.create_index('ix_calendar_entries_start_at','calendar_entries',['start_at'])
    if 'calendar_mutations' not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table('calendar_mutations',sa.Column('id',sa.Integer,primary_key=True),
            sa.Column('request_id',sa.String(100),nullable=False,unique=True),
            sa.Column('fingerprint',sa.String(64),nullable=False),sa.Column('result',sa.JSON,nullable=False))

def downgrade():
    op.drop_table('calendar_mutations')
    op.drop_table('calendar_entries')
