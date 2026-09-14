/**
 * Parsing a WhatsApp export. Runs ON THE DEVICE.
 *
 * This lives in `shared` rather than on the server for one reason: an export is
 * mostly somebody else's words, and that person never agreed to anything. Parsing on
 * the phone means the app can keep the user's own lines, drop the rest, and send only
 * those. The counterparty's messages never cross the network at all.
 *
 * The server imports the same function rather than keeping a second copy, because a
 * drifting duplicate parser is how a format bug gets fixed in one place and not the
 * other.
 */
import { CHAT_MAX_CHARS } from './paste.js';

export interface ParsedChat {
  speakers: { name: string; messages: number; sampleChars: number }[];
  lines: { speaker: string; text: string }[];
}

/**
 * WhatsApp exports come in two shapes and both appear in the wild:
 *   [12/09/2026, 14:32:11] Knox: hey        (iOS)
 *   12/09/2026, 14:32 - Knox: hey           (Android)
 * Messages can also wrap onto following lines, which belong to the previous speaker.
 */
const IOS = /^‎?\[(?<ts>[^\]]+)\]\s(?<who>[^:]{1,60}):\s(?<msg>[\s\S]*)$/;
const ANDROID = /^(?<ts>\d{1,4}[/.-]\d{1,2}[/.-]\d{2,4},\s[^-]{3,12})-\s(?<who>[^:]{1,60}):\s(?<msg>[\s\S]*)$/;

/** Lines WhatsApp inserts that are not anybody speaking. */
const NOISE = [
  'Messages and calls are end-to-end encrypted',
  '<Media omitted>', 'image omitted', 'video omitted', 'audio omitted',
  'sticker omitted', 'document omitted', 'This message was deleted',
  'You deleted this message', 'null', 'joined using this group',
];

export function parseChatExport(raw: string): ParsedChat {
  // Truncate from the END, not the start.
  //
  // A real export runs to megabytes and only the last few hundred thousand characters
  // fit. Taking the FIRST slice keeps the oldest messages, so a three-year chat
  // teaches the clone how someone wrote three years ago -- and `extractVoice` then
  // samples carefully "across the whole history", which by that point is a history
  // that has already been cut off at the wrong end.
  //
  // The leading partial line is dropped: slicing lands mid-message, and half a
  // sentence with no speaker would be glued onto whoever spoke next.
  const clipped =
    raw.length > CHAT_MAX_CHARS
      ? raw.slice(raw.length - CHAT_MAX_CHARS).replace(/^[^\n]*\n/, '')
      : raw;
  const lines = clipped.split(/\r?\n/);
  const out: { speaker: string; text: string }[] = [];

  for (const line of lines) {
    const m = IOS.exec(line) ?? ANDROID.exec(line);
    const who = m?.groups?.who?.trim();
    const msg = m?.groups?.msg?.trim();
    if (who && msg !== undefined) {
      if (msg && !NOISE.some((n) => msg.includes(n))) out.push({ speaker: who, text: msg });
      continue;
    }
    // A continuation of the previous message, not a new one.
    const prev = out[out.length - 1];
    if (prev && line.trim()) prev.text += `\n${line.trim()}`;
  }

  const byName = new Map<string, { messages: number; sampleChars: number }>();
  for (const l of out) {
    const e = byName.get(l.speaker) ?? { messages: 0, sampleChars: 0 };
    e.messages++;
    e.sampleChars += l.text.length;
    byName.set(l.speaker, e);
  }

  return {
    speakers: [...byName.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.messages - a.messages),
    lines: out,
  };
}
