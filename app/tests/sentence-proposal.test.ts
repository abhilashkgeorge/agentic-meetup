/**
 * After "Anyone else you couldn't be with?": the model proposes, the person decides.
 *
 * THE BUG THIS EXISTS FOR. The sentence became a hard rule the moment a model read it
 * -- one line, mapped by a model, silently removing people from somebody's pool, with
 * nothing on screen to say who. The server now returns a proposal and writes nothing;
 * this is the state behind the screen that shows it. The server half is guarded in
 * server/tests/core-cards.test.ts.
 *
 * Negative controls, run by hand:
 *   - afterSentence returning `next` for a proposal     -> "shows a proposal" fails
 *   - toggleProposed letting the last option go         -> "keeps one ticked" fails
 *   - proposedWhoFine sending `only` with every option  -> "every option is anyone" fails
 */
import { describe, expect, it } from 'vitest';
import {
  COVERED_NOTE, NO_CARD_NOTE, afterSentence, fromProposal, proposedWhoFine, toggleProposed,
} from '../src/features/onboarding/sentence-proposal';

const SMOKING = ['never', 'rarely', 'sometimes', 'often', 'daily'].map((v) => ({ value: v, label: v }));
const proposal = {
  questionId: 'card-smoking', card: 'Do you smoke?', text: 'Who would you be fine with?', options: SMOKING, accept: ['never'],
};

describe('after the sentence', () => {
  it('shows a proposal, and preset from the person\'s own words', () => {
    const r = afterSentence({ predicate: 'smoking', proposal });
    expect(r.kind).toBe('confirm');
    expect(r.kind === 'confirm' && r.proposal.accepted).toEqual(['never']);
  });

  it('says why nothing changed, and which reason it was', () => {
    expect(afterSentence({ predicate: null, proposal: null })).toEqual({ kind: 'note', text: NO_CARD_NOTE });
    expect(afterSentence({ predicate: 'smoking', proposal: null })).toEqual({ kind: 'note', text: COVERED_NOTE });
    expect(NO_CARD_NOTE).toMatch(/first chat/);
  });

  it('just moves on when the sentence was skipped or could not be mapped', () => {
    expect(afterSentence(null)).toEqual({ kind: 'next' });
    expect(afterSentence(undefined)).toEqual({ kind: 'next' });
  });

  it('drops a proposed value the card does not have', () => {
    expect(fromProposal({ ...proposal, accept: ['never', 'chain'] }).accepted).toEqual(['never']);
  });
});

describe('adjusting it', () => {
  it('lets the person tick anybody back in, in card order', () => {
    let s = fromProposal(proposal);
    s = toggleProposed(s, 'sometimes');
    s = toggleProposed(s, 'rarely');
    expect(s.accepted).toEqual(['never', 'rarely', 'sometimes']);
  });

  it('keeps one ticked: a rule that accepts nobody is an empty pool', () => {
    const s = fromProposal(proposal);
    expect(toggleProposed(s, 'never').accepted).toEqual(['never']);
  });

  it('sends every option as anyone, which writes no rule', () => {
    let s = fromProposal(proposal);
    for (const v of ['rarely', 'sometimes', 'often', 'daily']) s = toggleProposed(s, v);
    expect(proposedWhoFine(s)).toEqual({ anyone: true });
    expect(proposedWhoFine(fromProposal(proposal))).toEqual({ only: ['never'] });
  });
});
