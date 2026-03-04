from rest_framework import viewsets
from .models import Equipment
from .serializers import EquipmentSerializer


class EquipmentViewSet(viewsets.ModelViewSet):
    queryset = Equipment.objects.all().order_by("equipment_id")
    serializer_class = EquipmentSerializer
    lookup_field = "equipment_id"
