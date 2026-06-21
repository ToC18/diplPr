from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import EquipmentViewSet, TelegramNotifyView, health

router = DefaultRouter()
router.register("equipment", EquipmentViewSet, basename="equipment")

urlpatterns = [
    path("health/", health, name="health"),
    path("", include(router.urls)),
    path("telegram/notify/", TelegramNotifyView.as_view(), name="telegram-notify"),
]
