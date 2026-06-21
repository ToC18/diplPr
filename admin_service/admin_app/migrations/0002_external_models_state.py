from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("admin_app", "0001_initial"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.CreateModel(
                    name="Event",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                        ("equipment_id", models.CharField(max_length=64)),
                        ("status", models.CharField(max_length=32)),
                        ("ts", models.DateTimeField()),
                        ("payload", models.JSONField(blank=True, null=True)),
                    ],
                    options={
                        "managed": False,
                        "db_table": "events",
                        "ordering": ["-id"],
                    },
                ),
                migrations.CreateModel(
                    name="DowntimeInterval",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                        ("equipment_id", models.CharField(max_length=64)),
                        ("status", models.CharField(max_length=32)),
                        ("start_ts", models.DateTimeField()),
                        ("end_ts", models.DateTimeField(blank=True, null=True)),
                        ("source", models.CharField(default="auto", max_length=16)),
                        ("note", models.TextField(blank=True, null=True)),
                        ("created_by", models.CharField(blank=True, max_length=64, null=True)),
                    ],
                    options={
                        "managed": False,
                        "db_table": "downtime_intervals",
                        "ordering": ["-id"],
                    },
                ),
                migrations.CreateModel(
                    name="EquipmentState",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                        ("equipment_id", models.CharField(max_length=64, unique=True)),
                        ("last_status", models.CharField(max_length=32)),
                        ("last_ts", models.DateTimeField()),
                    ],
                    options={
                        "managed": False,
                        "db_table": "equipment_state",
                        "ordering": ["equipment_id"],
                    },
                ),
                migrations.CreateModel(
                    name="ProcessingState",
                    fields=[
                        ("id", models.IntegerField(primary_key=True, serialize=False)),
                        ("last_event_id", models.BigIntegerField(default=0)),
                    ],
                    options={
                        "managed": False,
                        "db_table": "processing_state",
                    },
                ),
            ],
            database_operations=[],
        ),
    ]
