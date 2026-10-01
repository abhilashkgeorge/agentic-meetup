/**
 * A fetched picture as a data URI, for <Image>: photos and map tiles travel that way
 * (features/photos/photo.tsx says why).
 *
 * ENCODED HERE, FROM THE BYTES. The old way was Response.blob() and a FileReader, and the
 * blob is the long way round: Expo's fetch reads the bytes, base64-encodes them into React
 * Native's native blob store, and the FileReader reads them back out as base64 again. In
 * development it also says so, in a warning over the bottom of the screen -- over the Save
 * button, the first time the distance map loaded on the Seeker (2026-10-01).
 */

/** Bytes per String.fromCharCode call: one call with every byte of a photo overflows the stack. */
const SLICE = 8192;

export function bytesToDataUri(bytes: Uint8Array, mime: string): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += SLICE) {
    bin += String.fromCharCode(...bytes.subarray(i, i + SLICE));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}

/** The response's body as a data URI, typed as the server said or as `fallback`. */
export async function dataUriOf(res: Response, fallback: string): Promise<string> {
  const mime = res.headers.get('content-type')?.split(';')[0]?.trim() || fallback;
  return bytesToDataUri(new Uint8Array(await res.arrayBuffer()), mime);
}
