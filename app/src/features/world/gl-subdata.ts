/**
 * Send the GPU only the part of a buffer that changed, on a phone as on the web.
 *
 * WHAT WAS WRONG. WebGL 2's bufferSubData can take a slice of an array -- `srcOffset`
 * and `length`, counted in elements -- and three passes exactly that for a buffer's
 * update ranges. Expo's GL ignores both and copies the whole array it is handed
 * (node_modules/expo-gl/common/EXWebGLMethods.cpp, bufferSubData: `data.size()` bytes
 * of the array, whatever else was asked). So a range starting at zero quietly uploads
 * everything anyway, and a range starting anywhere else writes the whole array past
 * the end of the buffer.
 *
 * WHAT THIS DOES. The same call, with the slice cut out as a view first -- which Expo
 * does honour, because it copies a view's own bytes. The crowd rewrites the front of
 * its buffers every frame, as many people as are in view, and this is what keeps that
 * upload to the people in view rather than to the buffer's whole capacity.
 *
 * Imports nothing, so it is tested in node against three's own upload code
 * (tests/gl-subdata.test.ts).
 */
type SubData = (target: number, dstByteOffset: number, src: ArrayBufferView | null, srcOffset?: number, length?: number) => void;
type Sliceable = ArrayBufferView & { length: number; subarray(begin: number, end?: number): ArrayBufferView };

const HONOURED = Symbol.for('clone.subDataRanges');

export function honourSubDataRanges(gl: object): void {
  const g = gl as { bufferSubData: SubData; [HONOURED]?: true };
  if (g[HONOURED] || typeof g.bufferSubData !== 'function') return;
  const native = g.bufferSubData.bind(gl);
  g.bufferSubData = (target, dstByteOffset, src, srcOffset, length) => {
    if (srcOffset === undefined || src === null || typeof (src as Sliceable).subarray !== 'function') {
      native(target, dstByteOffset, src);
      return;
    }
    const a = src as Sliceable;
    // `length` 0 means "to the end", as it does in WebGL 2.
    native(target, dstByteOffset, a.subarray(srcOffset, length ? srcOffset + length : a.length));
  };
  g[HONOURED] = true;
}
