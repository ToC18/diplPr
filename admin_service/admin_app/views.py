import os

import requests
from rest_framework import status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Equipment
from .serializers import EquipmentSerializer, TelegramNotifySerializer


class EquipmentViewSet(viewsets.ModelViewSet):
    queryset = Equipment.objects.all().order_by("equipment_id")
    serializer_class = EquipmentSerializer
    lookup_field = "equipment_id"


class TelegramNotifyView(APIView):
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
