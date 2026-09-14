/**
 * Turning what somebody typed into something two people can be compared on.
 *
 * `object_value` has been NULL on every row ever written, while 43 predicates claim
 * matchable:true. Whatever shape ships first is the shape we live with, because
 * re-deriving it later means re-parsing prose that is months old. So the shapes get
 * pinned here on the way in.
 */
import { describe, expect, it } from 'vitest';
import { deriveValue, parseHeight, satisfies, toTag } from '@clone/shared';

describe('height, which people write six different ways', () => {
  it('reads feet and inches, and centimetres', () => {
    // The founder's own "5'4" was the worked example for this.
    expect(parseHeight(`5'4`)).toBe(163);
    expect(parseHeight(`5'4"`)).toBe(163);
    expect(parseHeight('5 ft 4')).toBe(163);
    expect(parseHeight('5 feet 4 inches')).toBe(163);
    expect(parseHeight('163cm')).toBe(163);
    expect(parseHeight('163')).toBe(163);
  });

  it('returns null rather than a wrong number', () => {
    for (const junk of ['tall', '', 'about average', '9999']) {
      expect(parseHeight(junk)).toBeNull();
    }
  });
});

describe('tags normalise the same way for everyone', () => {
  it('so two people who typed it differently still join', () => {
    expect(toTag('Machine Learning')).toBe('machine-learning');
    expect(toTag('machine learning')).toBe('machine-learning');
    expect(toTag('  Machine  Learning!! ')).toBe('machine-learning');
    expect(toTag('Café')).toBe('cafe');
  });
});

describe('deriving a comparable value', () => {
  it('maps loose wording onto a closed vocabulary', () => {
    expect(deriveValue('relationship_intent', 'Long term')).toBe('long_term');
    expect(deriveValue('relationship_intent', 'long-term')).toBe('long_term');
    expect(deriveValue('diet', 'Omnivore')).toBe('omnivore');
    expect(deriveValue('gender', 'Woman')).toBe('woman');
  });

  it('returns null for a word that is not in the vocabulary', () => {
    // The fact still commits. It is simply not matchable, and that is a question.
    expect(deriveValue('relationship_intent', 'who knows honestly')).toBeNull();
    expect(deriveValue('diet', 'I eat what I like')).toBeNull();
  });

  it('never guesses at a structured shape from prose', () => {
    // "somewhere near Bangalore" has no coordinates in it, and inventing some would
    // put a person on a map at a place they did not name.
    expect(deriveValue('lives_in', 'somewhere near Bangalore')).toBeNull();
    expect(deriveValue('age_range_sought', 'a bit younger than me')).toBeNull();
  });
});

describe('satisfies — the one comparison matching is built on', () => {
  it('answers UNKNOWN, not false, when the other side has no value', () => {
    // The single most important line in matching. Reading missing as a mismatch
    // empties the pool on day one, because half of any real schema is missing --
    // six of the eight filter fields come back null from Claude by policy alone.
    expect(satisfies('equals', 'omnivore', null)).toBeNull();
    expect(satisfies('in', ['woman'], undefined)).toBeNull();
  });

  it('does the obvious thing when both sides are present', () => {
    expect(satisfies('equals', 'omnivore', 'omnivore')).toBe(true);
    expect(satisfies('equals', 'omnivore', 'vegan')).toBe(false);
    expect(satisfies('in', ['ai', 'robotics'], 'ai')).toBe(true);
    expect(satisfies('not_in', ['smoker'], 'smoker')).toBe(false);
    expect(satisfies('between', { min: 25, max: 35 }, 30)).toBe(true);
    expect(satisfies('between', { min: 25, max: 35 }, 40)).toBe(false);
    expect(satisfies('gte', 170, 163)).toBe(false);
  });
});
