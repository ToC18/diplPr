import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.application.services import auth_service


class FakeRedis:
    def __init__(self):
        self.hashes = {}
        self.sets = {}
        self.values = {}

    def scard(self, key):
        return len(self.sets.get(key, set()))

    def sadd(self, key, *values):
        self.sets.setdefault(key, set()).update(values)

    def smembers(self, key):
        return set(self.sets.get(key, set()))

    def srem(self, key, *values):
        bucket = self.sets.setdefault(key, set())
        for value in values:
            bucket.discard(value)

    def hset(self, key, *args, mapping=None):
        bucket = self.hashes.setdefault(key, {})
        if mapping is not None:
            bucket.update(mapping)
            return
        if len(args) == 2:
            field, value = args
            bucket[field] = value
            return
        raise TypeError("unsupported hset call")

    def hgetall(self, key):
        return dict(self.hashes.get(key, {}))

    def hget(self, key, field):
        return self.hashes.get(key, {}).get(field)

    def setex(self, key, _ttl, value):
        self.values[key] = value

    def get(self, key):
        return self.values.get(key)

    def delete(self, key):
        self.hashes.pop(key, None)
        self.sets.pop(key, None)
        self.values.pop(key, None)

    def exists(self, key):
        return int(key in self.hashes or key in self.sets or key in self.values)

    def scan_iter(self, match=None):
        keys = sorted(self.hashes.keys())
        if match is None:
            return iter(keys)
        if match.endswith("*"):
            prefix = match[:-1]
            return (key for key in keys if key.startswith(prefix))
        return (key for key in keys if key == match)


class AuthServiceTests(unittest.TestCase):
    def setUp(self):
        self.redis = FakeRedis()
        self.redis_patch = patch.object(auth_service, "redis_client", self.redis)
        self.redis_patch.start()

    def tearDown(self):
        self.redis_patch.stop()

    def test_ensure_default_roles_seeds_roles_and_admin(self):
        auth_service.ensure_default_roles()

        self.assertEqual(self.redis.smembers("roles"), {"admin", "operator", "manager"})
        self.assertEqual(self.redis.hget("role:admin", "permissions"), "*")
        self.assertEqual(
            self.redis.hget("role:manager", "permissions"),
            "dashboard.view,events.view,downtime.view,reports.view",
        )
        self.assertEqual(
            self.redis.hget("role:operator", "permissions"),
            "dashboard.view,events.view,downtime.view",
        )
        self.assertEqual(self.redis.hget("user:admin", "role"), "admin")

    def test_login_returns_tokens_and_permissions(self):
        auth_service.ensure_default_roles()

        with patch.object(auth_service, "make_access_token", return_value="access-token"), patch.object(
            auth_service, "make_refresh_token", return_value="refresh-token"
        ):
            payload = auth_service.login("admin", "admin")

        self.assertEqual(payload["access_token"], "access-token")
        self.assertEqual(payload["refresh_token"], "refresh-token")
        self.assertEqual(payload["role"], "admin")
        self.assertEqual(payload["permissions"], ["*"])

    def test_register_rejects_short_password(self):
        auth_service.ensure_default_roles()

        with self.assertRaises(HTTPException) as ctx:
            auth_service.register("alice", "123", "operator")

        self.assertEqual(ctx.exception.status_code, 400)

    def test_delete_role_rejects_role_assigned_to_users(self):
        auth_service.ensure_default_roles()
        auth_service.create_role("viewer", "Read only", ["reports.view"])
        auth_service.register("alice", "secret1", "viewer")

        with patch.object(
            auth_service,
            "me_from_bearer",
            return_value={"role": "admin", "permissions": ["roles.manage"]},
        ), self.assertRaises(HTTPException) as ctx:
            auth_service.delete_role("viewer", "Bearer any-token")

        self.assertEqual(ctx.exception.status_code, 400)

    def test_builtin_manager_role_cannot_be_deleted(self):
        auth_service.ensure_default_roles()

        with patch.object(
            auth_service,
            "me_from_bearer",
            return_value={"role": "admin", "permissions": ["roles.manage"]},
        ), self.assertRaises(HTTPException) as ctx:
            auth_service.delete_role("manager", "Bearer any-token")

        self.assertEqual(ctx.exception.status_code, 400)
