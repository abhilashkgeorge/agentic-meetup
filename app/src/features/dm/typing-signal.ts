/**
 * "Is typing", said when typing starts, again every few seconds while it goes on, and
 * when it stops -- never once per keystroke.
 *
 * Once per keystroke, a 74-character message was 74 frames, and the server counts frames
 * (sixty a minute): the minute ran out before the message did, and the message itself was
 * refused (the Pixel, 2026-10-02). The other phone lets "typing..." go by itself after
 * TYPING_SHOWN_MS (store/dm.ts), so a long message is said again every TYPING_RENEW_MS:
 * about fifteen frames a minute of typing instead of hundreds.
 */
export const TYPING_RENEW_MS = 4_000;

export function typingSignal(
  send: (typing: boolean) => void,
  now: () => number = Date.now,
): (typing: boolean) => void {
  let said = false;
  let at = 0;
  return (typing) => {
    const t = now();
    const renew = typing && said && t - at >= TYPING_RENEW_MS;
    if (typing === said && !renew) return;
    said = typing;
    at = t;
    send(typing);
  };
}
