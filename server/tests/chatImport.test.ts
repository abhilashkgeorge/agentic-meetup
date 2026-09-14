import { describe, expect, it } from 'vitest';
import { parseChatExport } from '../src/memory/chatImport.js';

describe('WhatsApp export parsing', () => {
  it('reads the iOS format', () => {
    const r = parseChatExport(
      '[12/09/2026, 14:32:11] Knox: hey man\n[12/09/2026, 14:33:02] Sam: yo',
    );
    expect(r.speakers.map((s) => s.name).sort()).toEqual(['Knox', 'Sam']);
  });

  it('reads the Android format', () => {
    const r = parseChatExport('12/09/2026, 14:32 - Knox: hey man\n12/09/2026, 14:33 - Sam: yo');
    expect(r.lines).toHaveLength(2);
  });

  it('keeps multi-line messages with their sender', () => {
    const r = parseChatExport('[12/09/2026, 14:32:11] Knox: first line\nsecond line\n[12/09/2026, 14:33:02] Sam: yo');
    expect(r.lines[0]?.text).toBe('first line\nsecond line');
    expect(r.lines[0]?.speaker).toBe('Knox');
  });

  it('drops WhatsApp noise, not real messages', () => {
    const r = parseChatExport(
      'Messages and calls are end-to-end encrypted.\n' +
      '[12/09/2026, 14:32:11] Knox: <Media omitted>\n' +
      '[12/09/2026, 14:33:02] Knox: real message',
    );
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]?.text).toBe('real message');
  });

  it('counts per speaker so the user can pick which one is them', () => {
    const r = parseChatExport(
      '[1/1/26, 1:00:00] Knox: a\n[1/1/26, 1:00:01] Knox: b\n[1/1/26, 1:00:02] Sam: c',
    );
    expect(r.speakers[0]).toMatchObject({ name: 'Knox', messages: 2 });
  });
});

/**
 * Regression: a long export must be cut at the OLD end, not the new one.
 *
 * CHAT_MAX_CHARS is a few hundred thousand characters and a real chat runs to
 * megabytes, so most of it is discarded either way. Taking the first slice kept the
 * OLDEST messages -- so a three-year friendship taught the clone how someone wrote
 * three years ago, and extractVoice then sampled diligently across a history that had
 * already been cut off at the wrong end. Nothing failed; the voice was just subtly,
 * permanently out of date.
 */
describe('a long export keeps the recent half', () => {
  it('drops the oldest messages, not the newest', () => {
    const lines: string[] = [];
    for (let i = 0; i < 40_000; i++) {
      lines.push(`[12/09/2026, 10:00:00] ${i % 2 ? 'Knox' : 'Sam'}: message ${i}`);
    }
    const parsed = parseChatExport(lines.join('\n'));
    const numbers = parsed.lines.map((l) => Number(l.text.replace('message ', '')));

    expect(parsed.lines.length).toBeLessThan(40_000); // it did truncate
    expect(numbers[numbers.length - 1]).toBe(39_999);  // the last message survived
    expect(numbers[0]).toBeGreaterThan(20_000);        // the first kept one is recent
  });

  it('does not glue a half-cut line onto the next speaker', () => {
    // Slicing lands mid-message, so the leading fragment has no speaker. Attaching it
    // to whoever spoke next would put another person's words in this person's voice.
    const lines: string[] = [];
    for (let i = 0; i < 40_000; i++) {
      lines.push(`[12/09/2026, 10:00:00] ${i % 2 ? 'Knox' : 'Sam'}: message ${i}`);
    }
    const parsed = parseChatExport(lines.join('\n'));
    expect(parsed.lines[0]!.text).toMatch(/^message \d+$/);
  });
});
