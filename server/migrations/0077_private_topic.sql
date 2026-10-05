-- 0077: a learned sentence's private topic, judged when it is learned, and never public.
--
-- WHAT WAS WRONG. Relationship history had no line of its own. NEVER_PUBLIC stops the
-- KIND relationship_status, but a sentence is filed by the extractor's guess: "I called
-- off an engagement three weeks before the date" lands under `did`, a kind the cards,
-- the answer sheets and the agents' talk all repeat. The only check left was the word
-- list (brief.ts namesCoreValue), which knew "married" and "divorce" and nothing else.
--
-- HOW IT WAS MEASURED (2026-09-28, the clone-brain test, server/evals/clone-brain):
-- mayRepeat passed "I called off an engagement three weeks before the date", "I was
-- engaged at twenty-six and called it off", "Recently ended a seven-year relationship",
-- "My ex-boyfriend and I still talk" and "Two people have left me over how much I
-- work", and blocked "I was married..." and "I got divorced...". A learned sentence
-- starts match-only, but one tap on "OK to share" made any of the five public.
--
-- WHY THIS FIX (the founder, 2026-09-28: "caught by topic when a sentence is learned,
-- and kept match-only by default -- not by a word list alone"). The extractor already
-- reads every learned sentence; it now also names the private topic the sentence is
-- ABOUT (extract.ts, pasteImport.ts), commit() stores it here and keeps the fact
-- match-only, and "OK to share" refuses it. This table refuses it too, so no writer
-- that forgets can make one public. The word list stays, as the second line: it is
-- what still guards sentences written before today and the typed story answers, which
-- no model reads.
--
-- Nothing existing is changed: every row keeps a NULL topic, which is what it had.
ALTER TABLE facts ADD COLUMN private_topic text;

ALTER TABLE facts ADD CONSTRAINT facts_private_topic_known CHECK (
  private_topic IS NULL OR private_topic IN (
    'relationships', 'children', 'family', 'faith', 'politics', 'health', 'substances', 'diet'));

ALTER TABLE facts ADD CONSTRAINT facts_private_topic_never_public CHECK (
  private_topic IS NULL OR disclosure <> 'public');
