/**
 * The synthetic pool, and the property that makes it worth having.
 *
 * A collapsed synthetic pool looks completely fine profile by profile — every one
 * reads as a plausible person. It is only visible in aggregate, which is why these
 * are numbers rather than eyeballing.
 */
import { describe, expect, it } from 'vitest';
import { assess, makeProfile, rng } from '../src/matching/synthetic.js';

const build = (n: number, seed = 1) => {
  const r = rng(seed);
  return Array.from({ length: n }, () => makeProfile(r, '00000000-0000-0000-0000-000000000000'));
};

describe('the sampler produces a population, not one person repeated', () => {
  const profiles = build(500);
  const report = assess(profiles);

  it('gives almost everybody a different set of interests', () => {
    // The single clearest sign of mode collapse. Asking a model for "diverse
    // profiles" reliably fails this; sampling from a list cannot.
    expect(report.distinctInterestSets / report.count).toBeGreaterThan(0.9);
  });

  it('leaves real holes, so the unknown path is exercised', () => {
    // If every synthetic profile is complete, "unknown is not a mismatch" never runs
    // in testing — and that one line decides whether a real pool is empty.
    expect(report.missingRate).toBeGreaterThan(0.1);
    expect(report.missingRate).toBeLessThan(0.35);
  });

  it('never lets one value take over an axis', () => {
    for (const [axis, dist] of Object.entries(report.distributions)) {
      const top = Math.max(...Object.values(dist));
      expect(top, `${axis} is ${(top * 100).toFixed(0)}% one value`).toBeLessThan(0.7);
    }
  });

  it('is reproducible from its seed', () => {
    // A pool that differs every run makes any change in match rate impossible to
    // attribute to the change you actually made.
    const a = build(50, 42).map((p) => p.age).join(',');
    const b = build(50, 42).map((p) => p.age).join(',');
    expect(a).toBe(b);
    expect(build(50, 43).map((p) => p.age).join(',')).not.toBe(a);
  });

  it('keeps the structural fields even when it drops others', () => {
    // Gender and intent are two of the five filters. A profile missing them would
    // sit outside the pool and quietly shrink the test set.
    for (const p of profiles) {
      expect(p.traits.gender).toBeDefined();
      expect(p.traits.relationship_intent).toBeDefined();
      expect(p.gender).toBeTruthy();
      expect(p.seekingGender.length).toBeGreaterThan(0);
      expect(p.age).toBeGreaterThanOrEqual(18);
    }
  });

  it('puts most of them where the first real user is', () => {
    // A pool spread evenly over the planet tests the distance filter and nothing
    // else, because almost no pair survives it.
    const bangalore = profiles.filter((p) => p.lat !== null && Math.abs(p.lat - 12.9716) < 0.1);
    expect(bangalore.length / profiles.length).toBeGreaterThan(0.3);
  });
});

describe('the invented people can speak', () => {
  // The first real round decided a match where one side went into five conversations
  // with an EMPTY dossier -- synthetic people never touch `facts`, and the dossier was
  // read from `facts`. Both agents agreed twice about nobody at all, which is the
  // failure mode the research warned about, reproduced exactly.
  it('every profile carries a dossier and something it has said', () => {
    const r = rng(99);
    for (let i = 0; i < 200; i++) {
      const p = makeProfile(r, '00000000-0000-0000-0000-000000000000');
      expect(p.dossier.length, 'a dossier an agent can read').toBeGreaterThan(40);
      expect(p.dossier).toContain(String(p.age));
      expect(p.quotes.length, 'sentences a brief can quote').toBeGreaterThan(0);
      for (const q of p.quotes) {
        expect(q.text.length).toBeGreaterThan(12);
        expect(q.when).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it('does not say the same thing about everybody', () => {
    // Mode collapse is the reason these are templated from a sampled distribution
    // rather than written by a model. If this ever drops, the pool has stopped being
    // a population and gone back to being one person repeated.
    const r = rng(7);
    const people = Array.from({ length: 300 }, () =>
      makeProfile(r, '00000000-0000-0000-0000-000000000000'));
    const openers = new Set(people.map((p) => p.quotes[0]?.text));
    expect(openers.size).toBeGreaterThan(20);
  });

  it('is reproducible from the seed', () => {
    // A change in match rates has to be attributable to the change you made, not to
    // today's sampling.
    const a = makeProfile(rng(42), '00000000-0000-0000-0000-000000000000');
    const b = makeProfile(rng(42), '00000000-0000-0000-0000-000000000000');
    expect(a.dossier).toBe(b.dossier);
    expect(a.quotes).toEqual(b.quotes);
  });
});
