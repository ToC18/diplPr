import jwt
from django.conf import settings
from django.http import JsonResponse


class JwtAuthMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if settings.AUTH_DISABLED:
            return self.get_response(request)
        if request.path.startswith("/api/admin/equipment/"):
            return self.get_response(request)

        auth = request.META.get("HTTP_AUTHORIZATION", "")
        if not auth.startswith("Bearer "):
            return JsonResponse({"detail": "Missing token"}, status=401)
        token = auth.split(" ", 1)[1]
        try:
            jwt.decode(token, settings.AUTH_JWT_SECRET, algorithms=["HS256"])
        except Exception:
            return JsonResponse({"detail": "Invalid token"}, status=401)

        return self.get_response(request)
