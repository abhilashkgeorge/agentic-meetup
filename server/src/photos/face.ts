/**
 * The face model, behind one switch.
 *
 * FACE_CHECK=off (the default) means none of this is loaded and "Photos checked" is
 * not offered anywhere. tfjs-node uses the native TensorFlow binary (measured on the
 * founder's Mac: 31 ms a frame); wasm is the fallback when that binary will not
 * build. Models load from node_modules over file://, never from the network. This is
 * not an `llm.complete` call and costs no credits.
 *
 * What comes out of a frame is a list of faces, each with an embedding and a yaw.
 * The embedding is compared and dropped -- nothing here is ever written anywhere.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { env } from '../env.js';

export interface FaceRead {
  embedding: number[];
  /** Degrees; 0 is facing the camera. */
  yaw: number;
}

export const faceCheckEnabled = (): boolean => env.FACE_CHECK !== 'off';
export const MATCH_MIN = env.FACE_MATCH_MIN;

type Human = {
  load(): Promise<void>;
  warmup(): Promise<unknown>;
  detect(input: unknown): Promise<{ face: Array<{ embedding?: number[]; rotation?: { angle?: { yaw?: number } } }> }>;
  tf: { node: { decodeImage(buf: Buffer, channels: number): unknown }; dispose(t: unknown): void; getBackend(): string };
  match: { similarity(a: number[], b: number[]): number };
};

let loading: Promise<Human> | null = null;

async function human(): Promise<Human> {
  if (loading) return loading;
  loading = (async () => {
    const require = createRequire(import.meta.url);
    if (env.FACE_CHECK === 'tfjs-node') require('@tensorflow/tfjs-node');
    const modelsDir = resolve(require.resolve('@vladmandic/human'), '..', '..', 'models');
    const { Human: H } = await import('@vladmandic/human');
    const h = new H({
      backend: env.FACE_CHECK === 'wasm' ? 'wasm' : 'tensorflow',
      modelBasePath: pathToFileURL(modelsDir).href + '/',
      debug: false,
      filter: { enabled: false },
      face: {
        enabled: true,
        detector: { rotation: true, maxDetected: 4 },
        mesh: { enabled: true },
        iris: { enabled: false },
        description: { enabled: true },
        emotion: { enabled: false },
        antispoof: { enabled: false },
        liveness: { enabled: false },
      },
      body: { enabled: false }, hand: { enabled: false }, object: { enabled: false }, gesture: { enabled: false },
    }) as unknown as Human;
    await h.load();
    await h.warmup();
    return h;
  })();
  return loading;
}

/** Every face in a JPEG, embedded. Empty when there is none. */
export async function readFaces(jpeg: Buffer): Promise<FaceRead[]> {
  const h = await human();
  const tensor = h.tf.node.decodeImage(jpeg, 3);
  try {
    const res = await h.detect(tensor);
    return res.face
      .filter((f) => Array.isArray(f.embedding) && f.embedding.length > 0)
      .map((f) => ({ embedding: f.embedding!, yaw: ((f.rotation?.angle?.yaw ?? 0) * 180) / Math.PI }));
  } finally {
    h.tf.dispose(tensor);
  }
}

/** 0..1; the model's own measure. */
export async function similarity(a: number[], b: number[]): Promise<number> {
  return (await human()).match.similarity(a, b);
}
