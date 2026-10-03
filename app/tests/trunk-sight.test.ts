/**
 * No tree trunk between the walking camera and you (garden-mesh.ts seeThroughTrunks).
 *
 * WHAT WAS WRONG (the two-phone test, 2026-10-02): the camera looks past trees -- a
 * trunk is no wall to it, or it reared up over your head at every one (garden.ts
 * seeThrough) -- so it could sit with a trunk square between it and you, and you walked
 * on behind the bark.
 *
 * WHAT IS GUARDED: the trunks' shader is given the line from the lens to the middle of
 * the person and cuts away what lies near it, only between the two; the line is set each
 * frame while walking and cleared otherwise. The cut itself is the shader's, which needs
 * GL: what is checked is that it is put in, and wired (SOURCE SHAPE for canvas.tsx).
 *
 * Negative controls, run by hand and recorded in the commit: the trunks built without
 * seeThroughTrunks -> "the trunks carry the cut" fails; canvas.tsx not setting the line
 * -> "set every walking frame" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SIGHT_R, seeThroughTrunks } from '../src/features/world/garden-mesh';

const src = (...p: string[]) => readFileSync(join(import.meta.dirname, '..', 'src', ...p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('the trunks between the lens and you', () => {
  it('are cut away in the shader, near the line and only between the two', () => {
    const m = new THREE.MeshLambertMaterial();
    const set = seeThroughTrunks(m);
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: THREE.ShaderLib.lambert.vertexShader,
      fragmentShader: THREE.ShaderLib.lambert.fragmentShader,
    };
    m.onBeforeCompile(shader as never, undefined as never);
    expect(shader.vertexShader).toContain('vSightWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
    expect(shader.fragmentShader).toMatch(/if \(sightT > 0\.02 && sightT < 0\.97 && sightD < uSightR \* 1\.6/);
    expect(shader.fragmentShader).toContain('discard;');
    // Off until somebody is followed; then the line, at the cut's width; then off again.
    expect(shader.uniforms.uSightR!.value).toBe(0);
    set([1, 2, 3], [4, 0.11, 6]);
    expect((shader.uniforms.uSightLens!.value as THREE.Vector3).toArray()).toEqual([1, 2, 3]);
    expect((shader.uniforms.uSightSubject!.value as THREE.Vector3).toArray()).toEqual([4, 0.11, 6]);
    expect(shader.uniforms.uSightR!.value).toBe(SIGHT_R);
    set(null);
    expect(shader.uniforms.uSightR!.value).toBe(0);
  });

  it('the trunks carry the cut', () => {
    const g = src('features', 'world', 'garden-mesh.ts');
    expect(g).toContain('const sight = seeThroughTrunks(trunkMat);');
    expect(g).toMatch(/new THREE\.CylinderGeometry\(0\.055, TRUNK_BASE, TRUNK_H, 5\), trunkMat,/);
    expect(g).toContain('sightLine: sight,');
  });

  it('is set every walking frame, to the middle of you, and cleared off the street', () => {
    const c = src('features', 'world', 'canvas.tsx');
    expect(c).toContain('garden.sightLine(eye, [you.x, lift + SIGHT_MIDDLE, you.z]);');
    expect(c).toMatch(/\} else \{\s*garden\.sightLine\(null\);/);
  });
});
