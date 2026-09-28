/**
 * The GPU gets only the part of a buffer that changed, on a phone as on the web.
 *
 * THE BUG THIS EXISTS FOR. three uploads a buffer's update range as
 * `bufferSubData(target, offset, array, srcOffset, length)`, and Expo's GL ignores the
 * last two and copies the whole array (expo-gl EXWebGLMethods.cpp). The crowd writes
 * as many people as are in view to the front of buffers sized for hundreds, so without
 * this every frame sends the whole capacity -- and a range that did not start at zero
 * would write past the end of the buffer.
 *
 * WHAT IS PINNED, through three's own upload code (WebGLAttributes) and a GL that
 * behaves as Expo's does:
 *   - a range reaches the GPU as exactly those elements, at exactly that offset;
 *   - a plain upload, with no range, is untouched;
 *   - installing twice does not wrap twice.
 *
 * Negative control, run 2026-09-28 and restored byte-identical: pass `src` through
 * whole instead of the subarray -> "exactly those elements" fails.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WebGLAttributes } from 'three/src/renderers/webgl/WebGLAttributes.js';
import { honourSubDataRanges } from '../src/features/world/gl-subdata';

/** A GL that does what Expo's does: bufferSubData copies whatever view it is handed. */
function expoLikeGl() {
  const uploads: { offset: number; bytes: number; first: number }[] = [];
  const gl = {
    ARRAY_BUFFER: 0x8892,
    FLOAT: 0x1406,
    createBuffer: () => ({}),
    bindBuffer: () => {},
    bufferData: () => {},
    deleteBuffer: () => {},
    // Expo's signature in practice: the last two arguments are dropped on the floor.
    bufferSubData(_target: number, offset: number, src: Float32Array) {
      uploads.push({ offset, bytes: src.byteLength, first: src[0]! });
    },
  };
  return { gl, uploads };
}

describe('uploading part of a buffer', () => {
  it('sends exactly the range asked for, and nothing past it', () => {
    const { gl, uploads } = expoLikeGl();
    honourSubDataRanges(gl);
    const attrs = new WebGLAttributes(gl as unknown as WebGL2RenderingContext);
    const data = new Float32Array(512 * 32).map((_, i) => i);
    const buf = new THREE.InstancedInterleavedBuffer(data, 32, 1);
    attrs.update(buf as unknown as THREE.BufferAttribute, gl.ARRAY_BUFFER);   // first upload: bufferData, whole
    buf.clearUpdateRanges();
    buf.addUpdateRange(0, 7 * 32);
    buf.needsUpdate = true;
    attrs.update(buf as unknown as THREE.BufferAttribute, gl.ARRAY_BUFFER);
    expect(uploads).toEqual([{ offset: 0, bytes: 7 * 32 * 4, first: 0 }]);

    // A range that does not start at zero lands where it belongs, not past the end.
    buf.addUpdateRange(100, 10);
    buf.needsUpdate = true;
    attrs.update(buf as unknown as THREE.BufferAttribute, gl.ARRAY_BUFFER);
    expect(uploads[1]).toEqual({ offset: 400, bytes: 40, first: 100 });
  });

  it('leaves a whole upload whole', () => {
    const { gl, uploads } = expoLikeGl();
    honourSubDataRanges(gl);
    const attrs = new WebGLAttributes(gl as unknown as WebGL2RenderingContext);
    const a = new THREE.BufferAttribute(new Float32Array(64), 4);
    attrs.update(a, gl.ARRAY_BUFFER);
    a.needsUpdate = true;
    attrs.update(a, gl.ARRAY_BUFFER);
    expect(uploads).toEqual([{ offset: 0, bytes: 256, first: 0 }]);
  });

  it('wraps the context once, however many canvases mount', () => {
    const { gl, uploads } = expoLikeGl();
    honourSubDataRanges(gl);
    const once = gl.bufferSubData;
    honourSubDataRanges(gl);
    expect(gl.bufferSubData).toBe(once);
    (gl.bufferSubData as unknown as (...a: unknown[]) => void)(0, 0, new Float32Array([5, 6, 7]), 1, 1);
    expect(uploads).toEqual([{ offset: 0, bytes: 4, first: 6 }]);
  });
});
