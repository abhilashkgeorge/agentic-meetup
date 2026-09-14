-- 0043: append-only from the application, still erasable by the eraser.
--
-- 0042 revoked UPDATE and DELETE on `consents` from `clone_app`, because a consent
-- record the relying party can edit is not evidence of anything. Two erasure tests
-- failed on the next run: the account-deletion path deletes user tables on a TENANT
-- session, which is the application, and the application had just been told no.
--
-- Both rules are right and they collide. The resolution is who does the deleting:
-- `clone_eraser` exists precisely to remove a person's data and prove it is gone, and
-- it is not the party relying on the consent. `consents` therefore leaves the
-- application's delete loop and joins the eraser's.
--
-- Consent is erased at all -- rather than kept as proof somebody once agreed --
-- because keeping a record that a person agreed to be remembered, after they have
-- asked to be forgotten, is the wrong way round.

GRANT DELETE ON consents TO clone_eraser;
