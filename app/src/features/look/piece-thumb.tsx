/**
 * A picture of one piece, cropped out of one sheet.
 *
 * `scripts/build-thumbs.mts` draws every face, hairstyle, top, pair of trousers, pair
 * of shoes, beard and thing worn on top once, offline, into
 * `assets/characters/thumbs.png`, and writes where each one landed into the manifest. This crops a tile out of that sheet by moving the whole image
 * behind a window, which costs one decode and one texture for the entire builder --
 * against forty GL contexts if each chip drew its own little 3D view.
 *
 * NO THREE IS IMPORTED HERE. It is an <Image> with a negative offset. The arithmetic
 * lives in `thumb-sheet.ts`, where a test can reach it without a PNG loader.
 */
import { memo } from 'react';
import { Image, View, type ViewStyle } from 'react-native';
import { SHEET_COLS, SHEET_ROWS, tileOf, type PicturedPart } from './thumb-sheet';

const SHEET = require('../../../assets/characters/thumbs.png');

export const PieceThumb = memo(function PieceThumb({ part, index, size, style }: {
  part: PicturedPart;
  index: number;
  size: number;
  style?: ViewStyle;
}) {
  const at = tileOf(part, index);
  if (!at) return <View style={[{ width: size, height: size }, style]} />;
  return (
    <View style={[{ width: size, height: size, overflow: 'hidden' }, style]}>
      <Image
        source={SHEET}
        // The sheet is drawn at tile size; scaling the whole thing and sliding it is
        // what crops one square out of it.
        style={{
          width: size * SHEET_COLS,
          height: size * SHEET_ROWS,
          marginLeft: -at.col * size,
          marginTop: -at.row * size,
        }}
        resizeMode="stretch"
        accessibilityIgnoresInvertColors
      />
    </View>
  );
});
