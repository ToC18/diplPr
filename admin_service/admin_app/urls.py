from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import EquipmentViewSet, TelegramNotifyView

router = DefaultRouter()
router.register("equipment", EquipmentViewSet, basename="equipment")

urlpatterns = [
    path("", include(router.urls)),
    path("telegram/notify/", TelegramNotifyView.as_view(), name="telegram-notify"),
]
