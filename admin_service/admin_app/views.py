import os

import requests
from django.db import connections
from django.http import JsonResponse
from rest_framework import status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from .auth import EquipmentApiPermission, TelegramNotifyPermission
from .models import Equipment
from .serializers import EquipmentSerializer, TelegramNotifySerializer


class EquipmentViewSet(viewsets.ModelViewSet):
    queryset = Equipment.objects.all().order_by("equipment_id")
    serializer_class = EquipmentSerializer
    lookup_field = "equipment_id"
    permission_classes = [EquipmentApiPermission]


def health(request):
    checks = {}
    ok = True
    for alias in ("default", "events", "downtime"):
        try:
            with connections[alias].cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
            checks[alias] = "ok"
        except Exception as exc:
            ok = False
            checks[alias] = str(exc)
    status_code = 200 if ok else 503
    return JsonResponse({"status": "ok" if ok else "error", "checks": checks}, status=status_code)


class TelegramNotifyView(APIView):
    permission_classes = [TelegramNotifyPermission]

    def post(self, request):
        serializer = TelegramNotifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        bot_token = (os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()
        chat_id = (os.getenv("TELEGRAM_CHAT_ID") or "").strip()
        if not bot_token or not chat_id:
            return Response(
                {"detail": "TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID не настроены в окружении."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        message = serializer.validated_data["message"].strip()
        equipment_id = (serializer.validated_data.get("equipment_id") or "").strip()
        prefix = f"Оборудование: {equipment_id}\n" if equipment_id else ""
        text = f"Сообщение для ремонтной бригады\n{prefix}{message}"

        try:
            resp = requests.post(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                json={"chat_id": chat_id, "text": text},
                timeout=10,
            )
            resp.raise_for_status()
        except Exception as exc:
            return Response(
                {"detail": f"Ошибка отправки в Telegram: {exc}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        return Response({"ok": True})
