-- WHAT WAS TYPED IN THE PARK GOES WITH A REPORT ABOUT IT (the founder, 2026-09-29: "keep
-- park typed messages for 10 minutes, used only for reports").
--
-- WHAT WAS WRONG. Park lines were relayed to whoever was near and kept nowhere, so a
-- report about something typed in the park carried no words but the reporter's own note:
-- the reviewer had "harassment, in the park" and nothing that was said.
--
-- HOW IT WAS FOUND. Reading the park after 0080, which copies a reported chat into the
-- report: the park had nothing to copy. tests/park-lines.test.ts plants it.
--
-- THE FIX. The server holds each park line in memory for ten minutes, with who said it
-- and who was sent it (park/lines.ts) -- never in the database. A park report copies the
-- lines between the two people into report_messages (0080), which only the reviewer
-- reads, through this function: only into a report the caller made in the last minute,
-- once, at most 200 lines, marked kind 'park'. They sit after any chat the two had
-- (seq from a billion), which the 0080 trigger copies by the messages' own numbers.

CREATE FUNCTION keep_park_lines(report uuid, said jsonb) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  me uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  n  int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM reports r
                  WHERE r.id = report AND r.reporter_id = me
                    AND r.created_at > now() - interval '1 minute')
     OR EXISTS (SELECT 1 FROM report_messages m WHERE m.report_id = report AND m.kind = 'park') THEN
    RETURN 0;
  END IF;
  INSERT INTO report_messages (report_id, seq, from_reported, kind, body, sent_at)
  SELECT report, 1000000000 + x.ord, (x.line->>'fromReported')::boolean, 'park',
         left(x.line->>'text', 4000), to_timestamp((x.line->>'at')::double precision / 1000)
    FROM jsonb_array_elements(said) WITH ORDINALITY AS x(line, ord)
   WHERE x.ord <= 200;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION keep_park_lines(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keep_park_lines(uuid, jsonb) TO clone_app;
