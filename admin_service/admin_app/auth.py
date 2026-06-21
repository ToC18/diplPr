from __future__ import annotations

import jwt
from django.conf import settings
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied
from rest_framework.permissions import BasePermission, SAFE_METHODS


def _normalize_permissions(raw: str | list[str] | None) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        values = [item.strip() for item in raw.split(",") if item.strip()]
    else:
        values = [str(item).strip() for item in raw if str(item).strip()]
    seen = set()
    result: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def get_request_actor(request) -> dict:
    if getattr(settings, "AUTH_DISABLED", False):
        return {"sub": "system", "role": "admin", "permissions": ["*"]}

    authorization = request.META.get("HTTP_AUTHORIZATION", "")
    if not authorization.startswith("Bearer "):
        raise AuthenticationFailed("Missing token")

    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, settings.AUTH_JWT_SECRET, algorithms=["HS256"])
    except Exception as exc:
        raise AuthenticationFailed("Invalid token") from exc

    return {
        "sub": payload.get("sub"),
        "role": payload.get("role", "operator"),
        "permissions": _normalize_permissions(payload.get("permissions", [])),
    }


def has_permission(actor: dict, permission: str) -> bool:
    permissions = _normalize_permissions(actor.get("permissions", []))
    return "*" in permissions or permission in permissions


class EquipmentApiPermission(BasePermission):
    def has_permission(self, request, view) -> bool:
        actor = get_request_actor(request)
        request.actor = actor
        if request.method in SAFE_METHODS:
            return True
        if has_permission(actor, "equipment.manage") or has_permission(actor, "admin.panel"):
            return True
        raise PermissionDenied("Permission equipment.manage required")


class TelegramNotifyPermission(BasePermission):
    def has_permission(self, request, view) -> bool:
        actor = get_request_actor(request)
        request.actor = actor
        if has_permission(actor, "admin.panel"):
            return True
        raise PermissionDenied("Permission admin.panel required")
