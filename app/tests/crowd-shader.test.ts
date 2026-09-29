/**
 * The crowd's shaders compile.
 *
 * THE BUG THIS EXISTS FOR. Everybody in the town is drawn by one hand-edited shader
 * (crowd-gpu.ts). If it does not compile on the phone, three logs an error and draws
 * nothing -- and nothing else fails: the model loaded, so the capsule fallback never
 * starts. The park is simply empty. That is the worst kind of bug to find by walking
 * around, so it is found here.
 *
 * HOW. three builds the real shaders for the real material, exactly as it would on the
 * phone, against a GL that only records what it is given; the NDK's own shader
 * compiler (glslc, from the Android SDK the app is built with) then compiles them. As
 * GLSL ES 3.10, the nearest it accepts to the phone's 3.00, and with three's `average`
 * renamed, which that compiler treats as its own. Where the Android SDK is not
 * installed this test is skipped, and says so.
 *
 * Negative controls, run 2026-09-29 and restored byte-identical:
 *   - `vColor = vec3(...)` in VERTEX_SELECT (vColor is a vec4) -> fails, naming the line
 *   - an undeclared name in VERTEX_SKIN                          -> fails, naming it
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as THREE from 'three';
import { STARTER } from '@clone/shared';
import type { Manifest } from '../src/features/world/character-mesh';

type Ctor = { new (type: string, init?: Record<string, unknown>): Event };
(globalThis as Record<string, unknown>).ProgressEvent ??= class extends Event {
  constructor(type: string, init: Record<string, unknown> = {}) { super(type); Object.assign(this, init); }
} as unknown as Ctor;

/** The newest NDK's glslc, or null where there is no Android SDK. */
function glslc(): string | null {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (!sdk || !existsSync(join(sdk, 'ndk'))) return null;
  const versions = readdirSync(join(sdk, 'ndk')).sort().reverse();
  for (const v of versions) {
    const tools = join(sdk, 'ndk', v, 'shader-tools');
    if (!existsSync(tools)) continue;
    for (const host of readdirSync(tools)) {
      const bin = join(tools, host, 'glslc');
      if (existsSync(bin)) return bin;
    }
  }
  return null;
}

/** The vertex and fragment shader three builds for the crowd, captured off a recording GL. */
async function crowdShaders(): Promise<[string, string]> {
  const ASSETS = join(import.meta.dirname, '..', 'assets', 'characters');
  const manifest = JSON.parse(readFileSync(join(ASSETS, 'people.json'), 'utf8')) as Manifest;
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const buf = readFileSync(join(ASSETS, 'people.glb'));
  const gltf = await new Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>((res, rej) =>
    new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res as never, rej));
  const gpu = await import('../src/features/world/crowd-gpu');
  const crowd = gpu.makeGpuCrowd(gltf, manifest);

  const sources: string[] = [];
  let next = 0;
  const known: Record<string, unknown> = {
    VERSION: 0x1f02, SHADING_LANGUAGE_VERSION: 0x8b8c, VIEWPORT: 0x0ba2, SCISSOR_BOX: 0x0c10,
    ACTIVE_ATTRIBUTES: 0x8b89, ACTIVE_UNIFORMS: 0x8b86, FRAMEBUFFER_COMPLETE: 0x8cd5,
    drawingBufferWidth: 400, drawingBufferHeight: 800,
    getContextAttributes: () => ({ alpha: true, antialias: false, depth: true, stencil: false, premultipliedAlpha: true }),
    getExtension: () => ({}),
    getSupportedExtensions: () => [],
    getParameter: (p: number) => (p === 0x1f02 ? 'WebGL 2.0 (OpenGL ES 3.0)' : p === 0x8b8c ? 'WebGL GLSL ES 3.00'
      : p === 0x0ba2 || p === 0x0c10 ? new Int32Array([0, 0, 400, 800]) : 16),
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    shaderSource: (_s: unknown, src: string) => { sources.push(src); },
    getShaderParameter: () => true,
    getProgramParameter: (_p: unknown, what: number) => (what === 0x8b89 || what === 0x8b86 ? 0 : true),
    getProgramInfoLog: () => '',
    getShaderInfoLog: () => '',
    getActiveAttrib: () => null,
    getActiveUniform: () => null,
    getAttribLocation: () => -1,
    getUniformLocation: () => null,
    checkFramebufferStatus: () => 0x8cd5,
    isContextLost: () => false,
  };
  const gl = new Proxy(known, {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      // Any other constant is a distinct number; any other call succeeds and returns a handle.
      if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return 0x1000 + (next++ % 1000);
      return () => ({});
    },
  });
  const canvas = { addEventListener() {}, removeEventListener() {}, width: 400, height: 800, style: {} };
  const renderer = new THREE.WebGLRenderer({
    context: gl as unknown as WebGL2RenderingContext, canvas: canvas as unknown as HTMLCanvasElement,
  });
  const scene = new THREE.Scene();
  // As the park draws it: in its mist, under its two lights.
  scene.fog = new THREE.Fog('#aabbcc', 10, 45);
  scene.add(new THREE.HemisphereLight('#ffffff', '#888888', 1), new THREE.DirectionalLight('#ffffff', 0.7));
  scene.add(crowd.group);
  crowd.update([{
    ref: 'a', x: 0, z: -3, facing: 0, seed: 1, ghost: true, state: 'walking',
    // A hat on, so the hat-hair branch is in the program that is compiled.
    look: { ...STARTER, hat: 2, bag: 1 },
  }], 1, { eyeX: 0, eyeZ: 0, flat: 0, time: 1, dt: 1 / 60, scale: 0.16 });
  renderer.render(scene, new THREE.PerspectiveCamera(62, 0.5, 0.08, 51));
  const vertex = sources.find((s) => s.includes('crowdWorld'));
  const fragment = sources[sources.indexOf(vertex!) + 1];
  if (!vertex || !fragment) throw new Error('three built no crowd shader');
  crowd.dispose();
  return [vertex, fragment];
}

const compiler = glslc();

describe('the crowd shader', () => {
  it.skipIf(!compiler)('compiles, vertex and fragment, as three builds them', async () => {
    const [vertex, fragment] = await crowdShaders();
    const dir = mkdtempSync(join(tmpdir(), 'crowd-glsl-'));
    for (const [stage, src] of [['vert', vertex], ['frag', fragment]] as const) {
      const file = join(dir, `crowd.${stage}`);
      writeFileSync(file, src.replace(/^#version 300 es/m, '#version 310 es').replace(/\baverage\b/g, 'average_x'));
      let out = '';
      try {
        execFileSync(compiler!, [`-fshader-stage=${stage}`, '--target-env=opengl', '-fauto-map-locations',
          '-fauto-bind-uniforms', '-o', join(dir, `crowd.${stage}.spv`), file], { stdio: 'pipe' });
      } catch (e) {
        out = String((e as { stderr?: Buffer }).stderr ?? e);
      }
      expect(out, `the ${stage} shader does not compile`).toBe('');
    }
  });
});
