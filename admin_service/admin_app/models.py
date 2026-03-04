from django.db import models


class Equipment(models.Model):
    TYPE_CHOICES = [("poll", "Poll"), ("push", "Push")]
    PROTOCOL_CHOICES = [("modbus", "Modbus"), ("opcua", "OPC UA"), ("mqtt", "MQTT")]

    equipment_id = models.CharField(max_length=64, unique=True)
    name = models.CharField(max_length=255)
    type = models.CharField(max_length=16, choices=TYPE_CHOICES)
    protocol = models.CharField(max_length=16, choices=PROTOCOL_CHOICES)
    endpoint = models.JSONField(default=dict)
    poll_interval_sec = models.IntegerField(null=True, blank=True)
    timeout_sec = models.IntegerField(default=60)
    mapping = models.JSONField(default=dict)

    def __str__(self):
        return f"{self.equipment_id} - {self.name}"


class Event(models.Model):
    equipment_id = models.CharField(max_length=64)
    status = models.CharField(max_length=32)
    ts = models.DateTimeField()
    payload = models.JSONField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = "events"
        ordering = ["-id"]

    def __str__(self):
        return f"Event #{self.pk} {self.equipment_id} {self.status}"


class DowntimeInterval(models.Model):
    equipment_id = models.CharField(max_length=64)
    status = models.CharField(max_length=32)
    start_ts = models.DateTimeField()
    end_ts = models.DateTimeField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = "downtime_intervals"
        ordering = ["-id"]

    def __str__(self):
        return f"Downtime #{self.pk} {self.equipment_id} {self.status}"


class EquipmentState(models.Model):
    equipment_id = models.CharField(max_length=64, unique=True)
    last_status = models.CharField(max_length=32)
    last_ts = models.DateTimeField()

    class Meta:
        managed = False
        db_table = "equipment_state"
        ordering = ["equipment_id"]

    def __str__(self):
        return f"State {self.equipment_id}: {self.last_status}"


class ProcessingState(models.Model):
    id = models.IntegerField(primary_key=True)
    last_event_id = models.BigIntegerField(default=0)

    class Meta:
        managed = False
        db_table = "processing_state"

    def __str__(self):
        return f"Processing state #{self.id}: {self.last_event_id}"
