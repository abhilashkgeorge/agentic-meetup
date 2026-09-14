import type { TenantCtx } from '../../src/db/client.js';
import type { Injection } from '../types.js';

/**
 * One competing memory architecture. Every arm sees identical input and is asked
 * identical questions, so the only variable is how it decides what is currently true.
 */
export interface Arm {
  name: string;
  /** Wipe this arm's state for a scratch tenant, between cases. */
  reset(ctx: TenantCtx): Promise<void>;
  /** Take in one session of the user's own turns. Returns cost in USD. */
  ingestSession(ctx: TenantCtx, sessionId: string, turns: string[]): Promise<number>;
  /**
   * Take in content that did NOT come from the user. Arms that track provenance can
   * refuse it; arms that do not will absorb it. That difference is the injection axis.
   */
  ingestInjection(ctx: TenantCtx, injection: Injection): Promise<number>;
  /**
   * What does this arm believe is currently true of `predicate`? null = nothing.
   *
   * Returns its own cost. Arms that answer from a structured store pay nothing here;
   * arms that must ask a model pay every time. Discarding that cost would make the
   * per-turn comparison flatter us, which is the one direction we cannot afford.
   */
  currentValue(ctx: TenantCtx, predicate: string): Promise<{ value: string | null; costUsd: number }>;
  /** Free-form answer, for probes. */
  answer(ctx: TenantCtx, question: string): Promise<{ text: string; costUsd: number }>;
}
