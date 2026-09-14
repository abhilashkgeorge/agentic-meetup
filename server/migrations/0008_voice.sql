-- 0008: a "voice" block. How the person SOUNDS, as opposed to what is true of them.
--
-- Facts and voice are different things and must not share a table. A fact is
-- "lives in Bangalore". Voice is "writes in lowercase, short sentences, swears when
-- annoyed, never uses emoji". Mixing them means style instructions get retrieved as
-- facts, and facts get applied as style.
ALTER TABLE core_profile DROP CONSTRAINT core_profile_block_name_check;
ALTER TABLE core_profile ADD CONSTRAINT core_profile_block_name_check
  CHECK (block_name IN ('identity','situation','preferences','open_threads','voice'));
