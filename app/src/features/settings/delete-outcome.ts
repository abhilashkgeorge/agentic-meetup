/**
 * What "Delete everything" says afterwards: only what the phone knows (lib/api.ts
 * eraseAccount). Plain functions, so the words can be tested without a phone.
 *
 * WHAT WAS WRONG: every failure said "We could not reach the server. Nothing was
 * removed." -- including an erasure that had run half-way (some data gone, the rest
 * kept), and a connection lost after the server had started. docs/END-TO-END.md 15.2.
 */
import type { EraseOutcome } from '../../lib/api';

/** The alert to show, or null when it simply worked. */
export function eraseMessage(outcome: EraseOutcome): { title: string; body: string } | null {
  switch (outcome) {
    case 'deleted': return null;
    case 'refused': return { title: 'Not deleted', body: 'Nothing was removed. Try again.' };
    case 'partial': return {
      title: 'Only partly deleted',
      body: 'Some of your data is gone and some is not. Try Delete again. If you are signed out, sign in and delete again.',
    };
    case 'signed_out': return {
      title: 'You are signed out',
      body: 'If your account still exists, sign in and delete it again.',
    };
    case 'unknown': return {
      title: 'Not sure it was deleted',
      body: 'The server did not answer, so we cannot tell what was removed. Try again. Deleting twice is safe.',
    };
  }
}

/** Whether the phone should sign out: the account is gone, or the session is. */
export const signsOut = (outcome: EraseOutcome): boolean => outcome === 'deleted' || outcome === 'signed_out';
