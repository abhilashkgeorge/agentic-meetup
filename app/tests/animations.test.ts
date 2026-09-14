/**
 * The animations that ship with the app.
 *
 * THE BUG THIS EXISTS FOR. One of them was not a drawing at all -- it was 120 PNG
 * frames wearing a Lottie file as a coat. Bundled as JSON with no images folder beside
 * it, Lottie throws on the first frame:
 *
 *   FATAL EXCEPTION: main
 *   java.lang.IllegalStateException: You must set an images folder before loading an
 *   image.
 *
 * Which took the whole app down the moment somebody reached that screen. Nothing in
 * TypeScript, the bundler or a store test can see inside a JSON blob; this can.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, '..', 'assets', 'animations');

const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));

describe('every bundled animation', () => {
  it('there is at least one', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('is drawn, not a stack of images', () => {
    // `p`/`u` on an asset is a filename and a folder: a raster frame that has to be
    // loaded from disk. A vector animation has neither.
    const withImages = files.filter((f) => {
      const d = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as {
        assets?: { p?: string; u?: string }[];
      };
      return (d.assets ?? []).some((a) => a.p || a.u);
    });

    expect(withImages, `these crash on render: ${withImages.join(', ')}`).toEqual([]);
  });

  it('is small enough to ship', () => {
    // These are decoration on a setup screen. A 200KB decoration is a slower launch
    // for every person, for ever, so that one screen looks less empty.
    const heavy = files.filter((f) => statSync(join(DIR, f)).size > 60 * 1024);
    expect(heavy, `over 60KB: ${heavy.join(', ')}`).toEqual([]);
  });

  it('is actually a Lottie file', () => {
    for (const f of files) {
      const d = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Record<string, unknown>;
      expect(d.layers, f).toBeDefined();
      expect(typeof d.w, f).toBe('number');
      expect(typeof d.h, f).toBe('number');
    }
  });
});
