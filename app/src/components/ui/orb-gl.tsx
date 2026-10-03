/**
 * The thinking orb, drawn with the GPU (orb-frame.ts says what to draw).
 *
 * WHY GL. The library's own React Native port draws with Skia, which the app does not
 * carry and the laptop had no room to install (2026-10-03: 1.2 GB free, Skia needs about
 * two). The app already ships expo-gl for the town, and an orb is only round dots and a
 * few thin lines: one point sprite per dot, softened to a circle in the shader, and a
 * quad per line. Each orb is its own small GL view, cleared to nothing, so it sits on
 * whatever is behind it.
 *
 * The frame is worked out on the JS thread each animation frame, as the port does (a
 * fraction of a millisecond), and stops while the app is in the background. Under the
 * phone's Reduce Motion it draws one still instant (the library's own) and stops.
 *
 * Loaded only through orb.tsx's dynamic import, never at the top of a screen: expo-gl is
 * a native shim (tests/native-imports.test.ts).
 */
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, AppState } from 'react-native';
import {
  DOT_FLOATS, LINE_FLOATS, STILL_AT, orbClock, orbFrame, packDots, packLines, type OrbState,
} from './orb-frame';

const DOT_VS = `
attribute vec2 aPos;
attribute float aR;
attribute vec2 aInk;
uniform vec2 uSize;
varying float vR;
varying float vSpan;
varying vec2 vInk;
void main() {
  float r = max(aR, 0.5);
  vSpan = 2.0 * (r + 1.0);
  gl_PointSize = vSpan;
  vR = aR;
  vInk = aInk;
  gl_Position = vec4(aPos.x / uSize.x * 2.0 - 1.0, 1.0 - aPos.y / uSize.y * 2.0, 0.0, 1.0);
}`;
// A disc with a one-pixel soft edge; a dot under half a pixel fades by its area instead.
const DOT_FS = `
precision mediump float;
varying float vR;
varying float vSpan;
varying vec2 vInk;
void main() {
  float d = length(gl_PointCoord - vec2(0.5)) * vSpan;
  float r = max(vR, 0.5);
  float cover = clamp(r + 0.5 - d, 0.0, 1.0);
  float small = vR < 0.5 ? (vR * vR) / 0.25 : 1.0;
  float a = vInk.y * cover * small;
  gl_FragColor = vec4(vec3(vInk.x) * a, a);
}`;
const LINE_VS = `
attribute vec2 aPos;
attribute vec2 aEdge;
attribute vec2 aInk;
uniform vec2 uSize;
varying vec2 vEdge;
varying vec2 vInk;
void main() {
  vEdge = aEdge;
  vInk = aInk;
  gl_Position = vec4(aPos.x / uSize.x * 2.0 - 1.0, 1.0 - aPos.y / uSize.y * 2.0, 0.0, 1.0);
}`;
// A band with soft sides; a line under a pixel wide fades by its width instead.
const LINE_FS = `
precision mediump float;
varying vec2 vEdge;
varying vec2 vInk;
void main() {
  float hw = max(vEdge.y, 0.5);
  float cover = clamp(hw + 0.5 - abs(vEdge.x), 0.0, 1.0);
  float thin = vEdge.y < 0.5 ? vEdge.y / 0.5 : 1.0;
  float a = vInk.y * cover * thin;
  gl_FragColor = vec4(vec3(vInk.x) * a, a);
}`;

type GL = ExpoWebGLRenderingContext;

function program(gl: GL, vs: string, fs: string): WebGLProgram {
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`orb shader: ${gl.getShaderInfoLog(s) ?? '?'}`);
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, shader(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`orb program: ${gl.getProgramInfoLog(p) ?? '?'}`);
  return p;
}

export interface OrbGLProps {
  state: OrbState;
  size: number;
  dark: boolean;
  speed: number;
}

export function OrbGL({ state, size, dark, speed }: OrbGLProps) {
  // What the loop draws, read fresh each frame: a theme switch or a new state is picked up
  // without a new GL context.
  const want = useRef({ state, size, dark, speed });
  useEffect(() => { want.current = { state, size, dark, speed }; }, [state, size, dark, speed]);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const onContextCreate = (gl: GL) => {
    const dots = program(gl, DOT_VS, DOT_FS);
    const lines = program(gl, LINE_VS, LINE_FS);
    const at = (p: WebGLProgram, name: string) => gl.getAttribLocation(p, name);
    const dot = { pos: at(dots, 'aPos'), r: at(dots, 'aR'), ink: at(dots, 'aInk'), size: gl.getUniformLocation(dots, 'uSize') };
    const line = { pos: at(lines, 'aPos'), edge: at(lines, 'aEdge'), ink: at(lines, 'aInk'), size: gl.getUniformLocation(lines, 'uSize') };
    const dotBuf = gl.createBuffer(), lineBuf = gl.createBuffer();
    let dotData: Float32Array = new Float32Array(600 * DOT_FLOATS);
    let lineData: Float32Array = new Float32Array(0);
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    gl.viewport(0, 0, W, H);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);

    const draw = (seconds: number) => {
      const w = want.current;
      const px = W / w.size;
      const frame = orbFrame(w.state, w.size, seconds, w.speed);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      // Lines first, so the dots sit on their ends, as the library's painter does.
      if (frame.lines.length) {
        const l = packLines(frame, w.dark, px, lineData);
        lineData = l.data;
        gl.useProgram(lines);
        gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
        gl.bufferData(gl.ARRAY_BUFFER, lineData.subarray(0, l.count * LINE_FLOATS), gl.DYNAMIC_DRAW);
        const stride = LINE_FLOATS * 4;
        gl.enableVertexAttribArray(line.pos);
        gl.vertexAttribPointer(line.pos, 2, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(line.edge);
        gl.vertexAttribPointer(line.edge, 2, gl.FLOAT, false, stride, 8);
        gl.enableVertexAttribArray(line.ink);
        gl.vertexAttribPointer(line.ink, 2, gl.FLOAT, false, stride, 16);
        gl.uniform2f(line.size, W, H);
        gl.drawArrays(gl.TRIANGLES, 0, l.count);
        gl.disableVertexAttribArray(line.pos);
        gl.disableVertexAttribArray(line.edge);
        gl.disableVertexAttribArray(line.ink);
      }
      const d = packDots(frame, w.dark, px, dotData);
      dotData = d.data;
      gl.useProgram(dots);
      gl.bindBuffer(gl.ARRAY_BUFFER, dotBuf);
      gl.bufferData(gl.ARRAY_BUFFER, dotData.subarray(0, d.count * DOT_FLOATS), gl.DYNAMIC_DRAW);
      const stride = DOT_FLOATS * 4;
      gl.enableVertexAttribArray(dot.pos);
      gl.vertexAttribPointer(dot.pos, 2, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(dot.r);
      gl.vertexAttribPointer(dot.r, 1, gl.FLOAT, false, stride, 8);
      gl.enableVertexAttribArray(dot.ink);
      gl.vertexAttribPointer(dot.ink, 2, gl.FLOAT, false, stride, 12);
      gl.uniform2f(dot.size, W, H);
      gl.drawArrays(gl.POINTS, 0, d.count);
      gl.disableVertexAttribArray(dot.pos);
      gl.disableVertexAttribArray(dot.r);
      gl.disableVertexAttribArray(dot.ink);
      gl.flush();
      gl.endFrameEXP();
    };

    // Turning while the app is in front and motion is welcome; one still instant otherwise.
    let alive = true;
    let raf = 0;
    let still = false;
    let front = AppState.currentState !== 'background';
    const tick = () => {
      if (!alive) return;
      draw(orbClock());
      raf = requestAnimationFrame(tick);
    };
    const run = () => {
      cancelAnimationFrame(raf);
      if (!alive) return;
      if (still) draw(STILL_AT);
      else if (front) tick();
    };
    const app = AppState.addEventListener('change', (s) => { front = s !== 'background'; run(); });
    const motion = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (on) => { still = on; run(); });
    void AccessibilityInfo.isReduceMotionEnabled?.().then((on) => { if (on && alive) { still = true; run(); } }).catch(() => {});
    stop.current = () => {
      alive = false;
      cancelAnimationFrame(raf);
      app.remove();
      motion?.remove();
    };
    draw(orbClock()); // never a blank first frame
    run();
  };

  return <GLView style={{ width: size, height: size }} onContextCreate={onContextCreate} />;
}
