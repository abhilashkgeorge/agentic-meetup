/**
 * What a screen opened from the setup chat did, for the chat to say when it comes back.
 * The voice note has no read of its own, and "Done" after a skip read as if it had
 * worked (as it did for the photos, on the Pixel, 2026-10-04).
 */
let voiceLearned = false;

/** The voice screen, opened from the chat, learned how you write. */
export function noteVoiceLearned(): void {
  voiceLearned = true;
}

/** Whether it did, since the chat last asked -- asked once, then forgotten. */
export function takeVoiceLearned(): boolean {
  const was = voiceLearned;
  voiceLearned = false;
  return was;
}
