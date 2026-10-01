/**
 * Pictures as data URIs (lib/data-uri.ts): photos and map tiles are encoded from the
 * response's bytes, not through Response.blob() and a FileReader.
 *
 * WHAT IS PINNED. The encoding is byte for byte what base64 is, across the slices it is
 * built in (a photo is many slices; a byte over 0x7f is where a hand-made encoder usually
 * breaks), and the type comes from the server. And neither loader goes back to blob():
 * the cost of that path -- two base64 passes through the native blob store, and a
 * development warning over the Save button (the Seeker, 2026-10-01) -- cannot be watched
 * without a phone, so the source is read instead, with comments stripped.
 *
 * Negative control, run by hand and recorded in the commit: tiles.ts back on blob() ->
 * "neither loader" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bytesToDataUri, dataUriOf } from '../src/lib/data-uri';

/** 20,000 bytes covering every value, so more than two slices and every high byte. */
const BYTES = Uint8Array.from({ length: 20_000 }, (_, i) => (i * 37 + 11) % 256);

describe('a picture as a data URI', () => {
  it('is exactly base64 of the bytes, across slices and high bytes', () => {
    const want = `data:image/png;base64,${Buffer.from(BYTES).toString('base64')}`;
    expect(bytesToDataUri(BYTES, 'image/png')).toBe(want);
    expect(bytesToDataUri(new Uint8Array(0), 'image/png')).toBe('data:image/png;base64,');
  });

  it('takes the type the server sent, and the fallback when it sent none', async () => {
    const typed = new Response(BYTES.slice(0, 3), { headers: { 'content-type': 'image/jpeg; charset=binary' } });
    expect(await dataUriOf(typed, 'image/png')).toBe(`data:image/jpeg;base64,${Buffer.from(BYTES.slice(0, 3)).toString('base64')}`);
    const bare = new Response(BYTES.slice(0, 3));
    bare.headers.delete('content-type');
    expect(await dataUriOf(bare, 'image/png')).toMatch(/^data:image\/png;base64,/);
  });

  it('neither loader goes back to blob() and a FileReader', () => {
    for (const file of [['features', 'distance', 'tiles.ts'], ['features', 'photos', 'photo.tsx']]) {
      const src = stripComments(readFileSync(join(import.meta.dirname, '..', 'src', ...file), 'utf8'));
      expect(src, file.join('/')).not.toMatch(/\.blob\(\)|FileReader/);
      expect(src, file.join('/')).toContain('dataUriOf(res,');
    }
  });
});

function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
}
