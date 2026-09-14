/**
 * The design language: neumorphism, laid out the way Instagram lays things out.
 *
 * NEUMORPHISM is the surface treatment. Every card, button and field is the SAME
 * colour as the background; depth comes only from two shadows — a white highlight up
 * and left, a cool grey shadow down and right. Nothing has a border. A pressed control
 * does not change colour, it sinks: the same two shadows, inset.
 *
 * INSTAGRAM is the layout. Generous whitespace, one idea per block, a thin flat top
 * bar, a bottom tab bar with plain glyphs, content that starts immediately rather than
 * after a title card. Instagram's discipline is that chrome gets out of the way.
 *
 * The two fight in one place and the resolution matters: neumorphism wants everything
 * to be the same grey, Instagram wants a clear hierarchy. So the SURFACE is uniformly
 * neumorphic and the HIERARCHY comes from type size, weight and spacing — never from
 * boxes with different fills.
 *
 * This needs React Native's `boxShadow`, which takes multiple shadows and `inset`.
 * It is New Architecture only, which this app is on. The old `shadowOffset` API can
 * express exactly one shadow and no inset, i.e. not neumorphism.
 */
import { useColorScheme } from 'react-native';
import { useTheme } from '../../store/theme';

export interface Palette {
  /** The one colour. Background and every raised surface share it. */
  bg: string;
  /** Only for things that must recede, like a sunken input well. */
  sunken: string;
  /** Top-left highlight. */
  light: string;
  /** Bottom-right shadow. */
  dark: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  accent: string;
  accentText: string;
  /** Instagram's one flash of colour, used for likes and destructive actions. */
  danger: string;
  warning: string;
  success: string;
}

/**
 * Light: the neumorphic surface wearing Instagram's typography.
 *
 * The ground cannot be white. Neumorphism works by putting a white highlight on one
 * side of a shape and a grey shadow on the other, and a white highlight on a white
 * page is nothing at all -- so Instagram's #FAFAFA would flatten every card in the app.
 * What IS borrowed is everything above the surface: Instagram's near-black text
 * (#262626) instead of a soft grey, its muted secondary, and its red. The result reads
 * as Instagram's daylight rather than a grey mock-up of it.
 *
 * The shadow is lighter than the first attempt (#C3CBD9, not #A3B1C6). The darker one
 * was correct for a pure neumorphic study and made every screen look overcast.
 */
export const light: Palette = {
  bg: '#EBEDF2',
  sunken: '#E2E5EB',
  light: '#FFFFFF',
  dark: '#C3CBD9',
  /** Instagram's primary text. A near-black, not a grey. */
  text: '#262626',
  textSecondary: '#5B6470',
  /** Close to Instagram's #8E8E8E, nudged cooler to sit on a blue-grey ground. */
  textTertiary: '#8E949E',
  accent: '#6D5DFC',
  accentText: '#FFFFFF',
  /** Instagram's red, which is friendlier than a pure alert red. */
  danger: '#ED4956',
  warning: '#B47B00',
  success: '#2E9E5B',
};

/**
 * Neumorphism in the dark is the same idea with the light source unchanged: the
 * highlight is a lighter grey rather than white, because pure white on a dark surface
 * reads as a glow rather than a bevel.
 */
export const dark: Palette = {
  bg: '#31353D',
  sunken: '#272B32',
  // Wider apart than the first attempt. Neumorphism needs a real gap between the
  // highlight and the shadow or nothing looks raised -- and in the dark the eye has
  // far less tolerance for a subtle one, so the first version read as flat mud.
  light: '#414651',
  dark: '#181B20',
  text: '#F0F2F6',
  textSecondary: '#B4BBC6',
  textTertiary: '#868E9A',
  accent: '#9B8CFF',
  accentText: '#14161A',
  danger: '#FF6B92',
  warning: '#E8B04B',
  success: '#5BD08C',
};

/**
 * The palette in force.
 *
 * The stored choice wins; "system" falls through to the phone. Reading the store here
 * rather than threading a prop means every component that already calls this follows
 * the switch with no changes -- there are about ninety of them.
 */
export const usePalette = (): Palette => {
  const choice = useTheme((s) => s.choice);
  const system = useColorScheme();
  const isDark = choice === 'system' ? system === 'dark' : choice === 'dark';
  return isDark ? dark : light;
};

/** For the status bar and anything else that needs the answer, not the colours. */
export const useIsDark = (): boolean => {
  const choice = useTheme((s) => s.choice);
  const system = useColorScheme();
  return choice === 'system' ? system === 'dark' : choice === 'dark';
};

/**
 * The two shadows, as one string.
 *
 * `depth` is the extrusion in points. Small controls need a tighter shadow or they
 * look like they are floating rather than moulded out of the surface.
 */
export const raised = (p: Palette, depth = 6): string =>
  `${depth}px ${depth}px ${depth * 2}px ${p.dark}, -${depth}px -${depth}px ${depth * 2}px ${p.light}`;

/** The same light source, pressed in. Used for held buttons and input wells. */
export const sunk = (p: Palette, depth = 4): string =>
  `inset ${depth}px ${depth}px ${depth * 2}px ${p.dark}, inset -${depth}px -${depth}px ${depth * 2}px ${p.light}`;

/** Barely there. For rows in a list, where a full extrusion would be noisy. */
export const whisper = (p: Palette): string =>
  `2px 2px 4px ${p.dark}, -2px -2px 4px ${p.light}`;

/**
 * Source Sans 3 is the current release of Source Sans Pro, which the spec names.
 * Every weight falls back to the system face, so a font that fails to load costs
 * you the typeface and not the screen.
 */
export const fonts = {
  regular: 'SourceSans3_400Regular',
  medium: 'SourceSans3_600SemiBold',
  bold: 'SourceSans3_700Bold',
} as const;

/**
 * Instagram's type scale: few sizes, big jumps, most text at one size. A screen that
 * uses four sizes reads as designed; one that uses nine reads as accreted.
 */
export const type = {
  display: { fontFamily: fonts.bold, fontSize: 32, lineHeight: 38 },
  title: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 30 },
  heading: { fontFamily: fonts.medium, fontSize: 18, lineHeight: 24 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 23 },
  bodyStrong: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 23 },
  callout: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  /** Instagram's all-caps section label. The only place letter-spacing is used. */
  label: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14, letterSpacing: 1.1 },
} as const;

/** 20pt margin, per the spec. Everything else is a multiple of 4. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, screen: 20, xl: 28, xxl: 40 } as const;

/** 20px corners on buttons and cards, per the spec. */
export const radius = { sm: 10, md: 16, lg: 20, xl: 28, pill: 999 } as const;

/** Nothing tappable is smaller than this. */
export const HIT = 48;
