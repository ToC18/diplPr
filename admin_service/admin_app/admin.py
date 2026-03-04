import json

from django.contrib import admin, messages
from django.core.exceptions import ValidationError

from .models import DowntimeInterval, Equipment, EquipmentState, Event, ProcessingState


class MultiDBModelAdmin(admin.ModelAdmin):
    using = "default"

    def get_queryset(self, request):
        return super().get_queryset(request).using(self.using)

    def save_model(self, request, obj, form, change):
        obj.save(using=self.using)

    def delete_model(self, request, obj):
        obj.delete(using=self.using)

    def delete_queryset(self, request, queryset):
        queryset.using(self.using).delete()


@admin.register(Equipment)
class EquipmentAdmin(MultiDBModelAdmin):
    using = "default"
    list_display = (
        "equipment_id",
        "name",
        "type",
        "protocol",
        "poll_interval_sec",
        "timeout_sec",
        "endpoint_preview",
    )
    list_display_links = ("equipment_id", "name")
    list_filter = ("type", "protocol", "timeout_sec")
    search_fields = ("equipment_id", "name", "endpoint")
    ordering = ("equipment_id",)
    list_per_page = 25
    list_editable = ("timeout_sec",)
    save_on_top = True
    actions = (
        "set_timeout_60",
        "set_timeout_300",
        "set_type_poll",
        "set_type_push",
        "reset_mapping",
    )
    readonly_fields = ("endpoint_pretty", "mapping_pretty")
    fieldsets = (
        ("Main", {"fields": ("equipment_id", "name", "type", "protocol")}),
        ("Connection", {"fields": ("endpoint", "endpoint_pretty")}),
        ("Behavior", {"fields": ("poll_interval_sec", "timeout_sec", "mapping", "mapping_pretty")}),
    )

    @admin.display(description="Endpoint")
    def endpoint_preview(self, obj: Equipment) -> str:
        host = (obj.endpoint or {}).get("host", "—")
        port = (obj.endpoint or {}).get("port", "—")
        topic = (obj.endpoint or {}).get("topic")
        return f"{host}:{port}" if not topic else f"{host}:{port}/{topic}"

    @admin.display(description="Endpoint (pretty)")
    def endpoint_pretty(self, obj: Equipment) -> str:
        if not obj or not obj.endpoint:
            return "—"
        return json.dumps(obj.endpoint, ensure_ascii=False, indent=2, sort_keys=True)

    @admin.display(description="Mapping (pretty)")
    def mapping_pretty(self, obj: Equipment) -> str:
        if not obj or not obj.mapping:
            return "—"
        return json.dumps(obj.mapping, ensure_ascii=False, indent=2, sort_keys=True)

    def save_model(self, request, obj, form, change):
        self._validate_equipment(obj)
        super().save_model(request, obj, form, change)

    def _validate_equipment(self, obj: Equipment) -> None:
        endpoint = obj.endpoint or {}
        mapping = obj.mapping or {}

        if obj.type == "poll":
            if obj.protocol not in {"modbus", "opcua"}:
                raise ValidationError("For type='poll' protocol must be modbus or opcua.")
            if not obj.poll_interval_sec or int(obj.poll_interval_sec) <= 0:
                raise ValidationError("poll_interval_sec must be > 0 for type='poll'.")
            for key in ("host", "port"):
                if key not in endpoint:
                    raise ValidationError(f"endpoint.{key} is required for type='poll'.")

        if obj.type == "push":
            if obj.protocol != "mqtt":
                raise ValidationError("For type='push' protocol must be mqtt.")
            for key in ("host", "port", "topic"):
                if key not in endpoint:
                    raise ValidationError(f"endpoint.{key} is required for type='push'.")

        if not isinstance(mapping, dict):
            raise ValidationError("mapping must be JSON object.")

        if obj.timeout_sec is None:
            obj.timeout_sec = 60
        try:
            obj.timeout_sec = int(obj.timeout_sec)
        except (TypeError, ValueError) as exc:
            raise ValidationError("timeout_sec must be integer.") from exc
        if obj.timeout_sec < 60 or obj.timeout_sec > 3600:
            raise ValidationError("timeout_sec must be in range 60..3600.")

    @admin.action(description="Set timeout_sec = 60 for selected")
    def set_timeout_60(self, request, queryset):
        updated = queryset.update(timeout_sec=60)
        self.message_user(request, f"Updated: {updated}", level=messages.SUCCESS)

    @admin.action(description="Set timeout_sec = 300 for selected")
    def set_timeout_300(self, request, queryset):
        updated = queryset.update(timeout_sec=300)
        self.message_user(request, f"Updated: {updated}", level=messages.SUCCESS)

    @admin.action(description="Set type=poll, protocol=modbus")
    def set_type_poll(self, request, queryset):
        updated = queryset.update(type="poll", protocol="modbus")
        self.message_user(request, f"Updated: {updated}", level=messages.SUCCESS)

    @admin.action(description="Set type=push, protocol=mqtt")
    def set_type_push(self, request, queryset):
        updated = queryset.update(type="push", protocol="mqtt")
        self.message_user(request, f"Updated: {updated}", level=messages.SUCCESS)

    @admin.action(description="Reset mapping to default status map")
    def reset_mapping(self, request, queryset):
        updated = 0
        for obj in queryset:
            obj.mapping = {"status_map": {"0": "STOP", "1": "RUN", "2": "ALARM"}}
            obj.save(update_fields=["mapping"])
            updated += 1
        self.message_user(request, f"Updated: {updated}", level=messages.SUCCESS)


@admin.register(Event)
class EventAdmin(MultiDBModelAdmin):
    using = "events"
    list_display = ("id", "equipment_id", "status", "ts")
    list_filter = ("status",)
    search_fields = ("equipment_id", "status")
    ordering = ("-id",)
    list_per_page = 50


@admin.register(DowntimeInterval)
class DowntimeIntervalAdmin(MultiDBModelAdmin):
    using = "downtime"
    list_display = ("id", "equipment_id", "status", "start_ts", "end_ts")
    list_filter = ("status",)
    search_fields = ("equipment_id", "status")
    ordering = ("-id",)
    list_per_page = 50


@admin.register(EquipmentState)
class EquipmentStateAdmin(MultiDBModelAdmin):
    using = "downtime"
    list_display = ("id", "equipment_id", "last_status", "last_ts")
    list_filter = ("last_status",)
    search_fields = ("equipment_id", "last_status")
    ordering = ("equipment_id",)


@admin.register(ProcessingState)
class ProcessingStateAdmin(MultiDBModelAdmin):
    using = "downtime"
    list_display = ("id", "last_event_id")
    ordering = ("id",)
