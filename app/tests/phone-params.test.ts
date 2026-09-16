/**
 * What survives being turned into a URL.
 *
 * WHAT HAPPENED. Somebody typed a correct one-time code and was told it did not
 * work. The challenge row was live, unconsumed and matched the code they typed; the
 * server had simply rejected the request's SHAPE before it ever looked at the code,
 * and answered with a body carrying no message -- which the app renders as its
 * generic "that code did not work". A malformed request and a wrong code were
 * indistinguishable on screen.
 *
 * Two shapes can do that, and both are in normal use rather than exotic:
 *
 *   the plus sign   route params are serialised into a URL, where `+` is the classic
 *                   encoding of a space. A number can arrive with its country code
 *                   silently detached, and a resend then texts a different person.
 *   the label       a device name is whatever its owner typed. The server caps it at
 *                   64 characters and rejects the entire request over it, so naming
 *                   your phone something long broke sign-in with a message about the
 *                   code being wrong.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalisePhone } from '@clone/shared';

const SRC = join(import.meta.dirname, '..', 'src');
const read = (f: string): string => readFileSync(join(SRC, f), 'utf8');

describe('a phone number crossing a route boundary', () => {
  it('is never handed to a URL with its plus still attached', () => {
    const src = read('features/auth/phone-screen.tsx');
    expect(src, 'the raw E.164 is being passed as a route param again')
      .not.toMatch(/params:\s*\{[^}]*\bphone:\s*e164\s*,/s);
    expect(src).toContain("phone: e164.replace(/^\\+/, '')");
  });

  it('is put back together before it is used again', () => {
    const src = read('features/auth/verify-screen.tsx');
    expect(src).toMatch(/startPhone\(`\+\$\{String\(params\.phone\)/);
  });

  it('would have texted the wrong person if the plus were lost', () => {
    // The failure this prevents, made concrete. A space for the plus, normalised
    // against the default country, is a different and deliverable number.
    const intended = '+917624842110';
    const mangled = normalisePhone(intended.replace('+', ' '), '+91');
    expect(mangled).not.toBe(intended);
    // And the reconstruction gets the right one back.
    const carried = intended.replace(/^\+/, '');
    expect(`+${carried.replace(/\D/g, '')}`).toBe(intended);
  });
});

describe('the device label', () => {
  it('is clamped everywhere it is sent', () => {
    // The server's cap is 64 and it refuses the whole request over it.
    for (const f of ['features/auth/verify-screen.tsx', 'features/auth/invite-screen.tsx']) {
      const src = read(f);
      const built = /Device\.deviceName[^;]*;/.exec(src);
      expect(built, `${f} no longer builds a label`).not.toBeNull();
      expect(built![0], `${f} sends an unclamped device name`).toContain('.slice(0, 64)');
    }
  });
});

describe('the verify screen', () => {
  it('refuses to submit with no challenge to submit against', () => {
    // Otherwise the request goes out with an undefined id, the server rejects the
    // shape, and the person is told their code is wrong when it was fine.
    const src = read('features/auth/verify-screen.tsx');
    expect(src).toMatch(/if \(!challengeId\)/);
  });
});
