from rest_framework import serializers
from .models import Equipment


class EquipmentSerializer(serializers.ModelSerializer):
    def validate(self, attrs):
        # Keep partial update behavior intact: fill absent fields from instance.
        current = getattr(self, "instance", None)
        equipment_type = attrs.get("type", getattr(current, "type", None))
        protocol = attrs.get("protocol", getattr(current, "protocol", None))
        endpoint = attrs.get("endpoint", getattr(current, "endpoint", None)) or {}
        poll_interval_sec = attrs.get(
            "poll_interval_sec",
            getattr(current, "poll_interval_sec", None),
        )
        mapping = attrs.get("mapping", getattr(current, "mapping", None)) or {}

        if equipment_type not in {"poll", "push"}:
            raise serializers.ValidationError({"type": "type must be 'poll' or 'push'"})

        if protocol not in {"modbus", "opcua", "mqtt"}:
            raise serializers.ValidationError(
                {"protocol": "protocol must be one of: modbus, opcua, mqtt"}
            )

        if not isinstance(endpoint, dict):
            raise serializers.ValidationError({"endpoint": "endpoint must be an object"})

        if not isinstance(mapping, dict):
            raise serializers.ValidationError({"mapping": "mapping must be an object"})

        if equipment_type == "poll":
            if protocol not in {"modbus", "opcua"}:
                raise serializers.ValidationError(
                    {"protocol": "poll equipment supports only modbus or opcua"}
                )
            if not poll_interval_sec or int(poll_interval_sec) <= 0:
                raise serializers.ValidationError(
                    {"poll_interval_sec": "poll_interval_sec must be > 0 for poll type"}
                )
            for key in ("host", "port"):
                if key not in endpoint:
                    raise serializers.ValidationError(
                        {"endpoint": f"endpoint.{key} is required for poll type"}
                    )

        if equipment_type == "push":
            if protocol != "mqtt":
                raise serializers.ValidationError(
                    {"protocol": "push equipment currently supports only mqtt"}
                )
            for key in ("host", "port", "topic"):
                if key not in endpoint:
                    raise serializers.ValidationError(
                        {"endpoint": f"endpoint.{key} is required for push mqtt"}
                    )

        status_map = mapping.get("status_map")
        if status_map is not None and not isinstance(status_map, dict):
            raise serializers.ValidationError(
                {"mapping": "mapping.status_map must be an object when provided"}
            )

        if "timeout_sec" in attrs:
            timeout_sec = attrs.get("timeout_sec")
            if timeout_sec is None:
                timeout_sec = 60
            try:
                timeout_sec = int(timeout_sec)
            except (TypeError, ValueError) as exc:
                raise serializers.ValidationError({"timeout_sec": "timeout_sec must be an integer"}) from exc
            if timeout_sec < 60 or timeout_sec > 3600:
                raise serializers.ValidationError(
                    {"timeout_sec": "timeout_sec must be in range 60..3600 seconds"}
                )
            attrs["timeout_sec"] = timeout_sec

        return attrs

    class Meta:
        model = Equipment
        fields = [
            "equipment_id",
            "name",
            "type",
            "protocol",
            "endpoint",
            "poll_interval_sec",
            "timeout_sec",
            "mapping",
        ]
