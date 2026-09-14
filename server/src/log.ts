import pino from 'pino';
import { env } from './env.js';

export const log = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  // Never log raw_text. Episodes are the most sensitive object in the system and
  // logs are the easiest place to leak them.
  redact: { paths: ['*.rawText', '*.raw_text', '*.text', 'req.headers.authorization'], censor: '[redacted]' },
});
