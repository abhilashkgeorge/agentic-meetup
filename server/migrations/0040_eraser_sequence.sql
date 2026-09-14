-- 0040: the eraser needs the sequence, not just the table.
--
-- 0039 handed `erasure_log` to `clone_eraser` and revoked it from `clone_app`, and the
-- test suite failed one minute later with:
--
--     permission denied for sequence erasure_log_id_seq
--
-- `erasure_log.id` is a serial rather than a uuid -- the only table in this schema
-- that is -- so an INSERT touches a sequence as well as the table, and a GRANT on the
-- table alone is not enough. The old grant to `clone_app` carried the sequence with
-- it from 0007 and the connection was easy to miss.
--
-- Caught by a test rather than in production, which is the entire argument for having
-- an erasure test that runs the real path against real roles instead of mocking it.

GRANT USAGE, SELECT ON SEQUENCE erasure_log_id_seq TO clone_eraser;
REVOKE ALL ON SEQUENCE erasure_log_id_seq FROM clone_app;
