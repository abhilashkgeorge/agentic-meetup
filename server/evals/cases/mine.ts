/**
 * THE REAL CORPUS. Cases from your own life, acted out or recalled.
 *
 * This is the file that decides whether G0 means anything. Sixty cases from here beat
 * six hundred invented ones, and these are the only cases that will ever contain real
 * ASR output -- which matters, because no published memory benchmark uses ASR at all,
 * and ASR is exactly where hedges die.
 *
 * Workflow:  npm run corpus:scan  ->  fill in drafts.ts  ->  move here  ->  corpus:status
 *
 * Write the expectation BEFORE running the eval. Always.
 */
import type { EvalCase } from '../types.js';

export const MY_CASES: EvalCase[] = [];
