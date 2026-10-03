/**
 * What the server screen says, by why it is open (connect-screen.tsx).
 *
 * WHAT WAS WRONG (the Pixel, 2026-10-02 and again 2026-10-03): opened on purpose from
 * Settings, with the server answering every request, it said "Can't reach the server --
 * It tried this and nothing answered:" over the working address, and "That address means
 * this phone, not your Mac." under a localhost that worked (through the USB cable). Those
 * words are for the launch, when nothing answered; from Settings the screen is just where
 * the address is changed.
 */
export interface ConnectWords {
  title: string;
  lead: string;
  /** Whether to warn that "localhost" on a phone means the phone: only after it failed. */
  warnLocalhost: boolean;
}

export function connectWords(chosen: boolean): ConnectWords {
  return chosen
    ? { title: 'Server', lead: 'The app talks to this address:', warnLocalhost: false }
    : { title: "Can't reach the server", lead: 'It tried this and nothing answered:', warnLocalhost: true };
}
