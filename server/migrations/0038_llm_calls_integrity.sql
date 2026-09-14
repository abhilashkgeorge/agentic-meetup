-- 0038: stop the spend table filling with rows nobody can account for.
--
-- `llm_calls` is the only record of what this project has ever spent, and it had no
-- foreign key to `tenants` or to `app_users`. Every test that created a scratch
-- tenant, spent something and then dropped the tenant left its rows behind with a
-- tenant_id pointing at nothing.
--
--     rows whose tenant no longer exists: 1,433 of ~1,472
--     claude-sonnet-5 | extract | 1,271 calls | $4.12
--
-- The routing has not been on Anthropic for a while, so that $4.12 is not a bill
-- anybody paid -- it is old fixtures. Every all-time cost figure this project has
-- quoted came out of that table, which means every one of them was mostly fiction.
--
-- NOT VALID, deliberately and unusually. Validating would require deleting the 1,433
-- existing rows, and deleting rows out of the only spend ledger is not a call a
-- migration should make on somebody's behalf. The constraint therefore binds every
-- future insert -- no new orphan can be created -- and leaves the existing ones for
-- a person to look at and decide about. When they are gone:
--
--     ALTER TABLE llm_calls VALIDATE CONSTRAINT llm_calls_tenant_fk;
--
-- The same applies to `tenant_budget`, which is the table the daily cap reads.

ALTER TABLE llm_calls
  ADD CONSTRAINT llm_calls_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE tenant_budget
  ADD CONSTRAINT tenant_budget_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE NOT VALID;

COMMENT ON CONSTRAINT llm_calls_tenant_fk ON llm_calls IS
  'NOT VALID on purpose: 1,433 pre-existing orphaned fixture rows are left for a '
  'person to decide about. VALIDATE once they are gone.';
