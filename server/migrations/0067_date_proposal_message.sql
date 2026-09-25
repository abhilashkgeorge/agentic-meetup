-- 0067: a proposed date is a normal message, marked as one.
--
-- WHAT WAS MISSING. The two agents come back with one first-date idea, checked to say
-- nothing about anybody and to stand on a sentence from each side (matching/talk.ts).
-- It was shown on the card before the yes, and then nowhere: once the two people were
-- introduced there was no way to act on it except retyping it. The founder's item 7:
-- a "Propose this date" button that sends the idea as a normal chat message from the
-- person -- the agent never schedules anything. And item 10's funnel needs "date
-- proposed" as a step it can count.
-- HOW IT WAS FOUND: the chat thread (app thread-screen.tsx) reads messages only; the
-- idea lived in rendezvous_briefs and no route read it after the reveal.
--
-- WHY THIS SHAPE. A column on messages, not a table: the proposal IS a message, sent
-- by the person, in the conversation, under the same row-level policy, the same block
-- check and the same erasure as every other one. `kind` says only how it was written.
-- Nothing a client sends can set it: the socket path writes the default, and the one
-- route that writes 'date_idea' builds the words itself from the checked idea.
ALTER TABLE messages ADD COLUMN kind text NOT NULL DEFAULT 'text'
  CHECK (kind IN ('text', 'date_idea'));

-- "Has a date been proposed in this conversation", asked by the chat and by the funnel.
CREATE INDEX messages_date_ideas ON messages (rendezvous_id) WHERE kind = 'date_idea';
