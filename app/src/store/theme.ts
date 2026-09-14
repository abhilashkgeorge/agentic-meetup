/**
 * Light or dark, and who decides.
 *
 * THREE STATES, NOT TWO. "System" has to exist and has to be the default: a phone set
 * to go dark at sunset should take this app with it, and an app that ignores that
 * setting is the one people notice at eleven at night. Light and dark are for the
 * people who want to override their phone, which is a real want and a minority one.
 *
 * The choice is stored on the device rather than the server. It is a property of this
 * phone in this room, not of the person -- somebody with a phone and a tablet may well
 * want different answers, and asking a server for the answer means a flash of the
 * wrong theme on every launch.
 */
import { create } from 'zustand';
import { getTheme, setTheme as persist } from '../lib/storage';

export type ThemeChoice = 'system' | 'light' | 'dark';

interface ThemeState {
  choice: ThemeChoice;
  /** True once the stored choice has been read, so nothing renders the wrong theme. */
  loaded: boolean;
  load: () => Promise<void>;
  choose: (c: ThemeChoice) => Promise<void>;
}

export const useTheme = create<ThemeState>((set) => ({
  choice: 'system',
  loaded: false,

  load: async () => {
    const stored = await getTheme();
    set({ choice: stored ?? 'system', loaded: true });
  },

  choose: async (choice) => {
    // Set first, write second. The screen should change under the finger; the write is
    // for the next launch.
    set({ choice });
    await persist(choice);
  },
}));
