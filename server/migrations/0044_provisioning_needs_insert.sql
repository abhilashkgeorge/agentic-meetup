-- 0044: the application creates tenants, and 0039 took that away.
--
-- 0039 revoked `tenants` from `clone_app` on the stated grounds that nothing in src/
-- touched it. That was wrong, and the server said so the moment somebody redeemed an
-- invite on a new phone:
--
--     error: permission denied for table tenants
--       at provision (src/api/auth.ts:32)
--
-- `provision` creates the tenant for a new account. The grep behind 0039 looked for
-- reads and updates and missed the one insert, which is exactly the kind of thing a
-- revoke should be tested against rather than reasoned about.
--
-- INSERT ONLY, deliberately. The original statement used `RETURNING id`, which needs
-- SELECT -- and `tenants` has no row-level security, so SELECT means the application
-- can list every tenant in the system, which is what 0039 was right to prevent. The
-- application now generates the id itself, which is already how it inserts app_users
-- and device_sessions two lines further down, and for the same reason.
--
-- Everything else that touches this table runs on the owner connection: the seeds, the
-- eval runner, and /stats through `discoverySession`.

GRANT INSERT ON tenants TO clone_app;

COMMENT ON TABLE tenants IS
  'clone_app may INSERT and nothing else: no SELECT, because this table has no RLS '
  'and reading it would list every tenant. Provisioning generates the id rather than '
  'using RETURNING, which is what keeps INSERT sufficient.';
