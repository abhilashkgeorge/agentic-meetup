/**
 * "Must have" is offered only on an answer people tap.
 *
 * WHY (the founder, 2026-09-26): must-haves hide people only on tapped answers. The
 * server refuses the rest (server tests/must-have.test.ts); this pins that the phone
 * does not offer the chip there, and says why.
 *
 * Negative control, run 2026-09-26: strengthsFor ignoring mustHave -> "not offered"
 * fails.
 */
import { describe, expect, it } from 'vitest';
import { NOT_A_MUST_HAVE, strengthsFor } from '../src/features/preferences/strengths';

describe('rule strengths', () => {
  it('offers all three on a tapped answer, and an older server’s list too', () => {
    expect(strengthsFor({ mustHave: true }).map((s) => s.label)).toEqual(['Must have', 'Really want', 'Nice to have']);
    expect(strengthsFor({}).map((s) => s.label)).toEqual(['Must have', 'Really want', 'Nice to have']);
  });
  it('does not offer "Must have" on a field chat fills, and says why', () => {
    expect(strengthsFor({ mustHave: false }).map((s) => s.label)).toEqual(['Really want', 'Nice to have']);
    expect(NOT_A_MUST_HAVE).toMatch(/tapped/);
  });
});
