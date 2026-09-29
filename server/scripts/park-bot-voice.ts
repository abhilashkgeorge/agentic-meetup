/**
 * The park bot's voice (park-bot.ts --voice), for trying the park's voice with one
 * phone: it goes into the voice room each pass is for, speaks its lines out loud, and
 * says -- in the terminal and out loud -- when it hears you.
 *
 * NO MODEL, NOTHING PAID: the lines are spoken by this Mac's own `say`, turned into the
 * voice server's format by `afconvert` (both come with macOS). It listens as the app
 * does: in the park only to the voice ids the server sent it, on a bench to the room.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AudioFrame, AudioSource, AudioStream, LocalAudioTrack, Room, RoomEvent, TrackKind, TrackPublishOptions, TrackSource,
  dispose, type RemoteParticipant, type RemoteTrack, type RemoteTrackPublication,
} from '@livekit/rtc-node';

const RATE = 48_000;
/** 10 ms of sound: what the voice server takes at a time. */
const FRAME = RATE / 100;
/** Louder than this, a second of what it hears counts as somebody talking (RMS of 16-bit). */
const TALKING_RMS = 500;

export interface Pass { url: string; room: string; token: string; identity: string; bench: boolean; canTalk: boolean }

const dir = mkdtempSync(join(tmpdir(), 'park-bot-voice-'));

/** A line as 48 kHz mono samples, in the Mac's own voice. */
function speech(text: string): Int16Array {
  const aiff = join(dir, 'line.aiff');
  const wav = join(dir, 'line.wav');
  execFileSync('say', ['-o', aiff, text]);
  execFileSync('afconvert', ['-f', 'WAVE', '-d', `LEI16@${RATE}`, '-c', '1', aiff, wav]);
  const buf = readFileSync(wav);
  for (let at = 12; at < buf.length - 8;) {
    const id = buf.toString('ascii', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === 'data') return new Int16Array(buf.buffer.slice(buf.byteOffset + at + 8, buf.byteOffset + at + 8 + size));
    at += 8 + size + (size % 2);
  }
  return new Int16Array(0);
}

export class BotVoice {
  private room: Room | null = null;
  private source: AudioSource | null = null;
  private pass: Pass | null = null;
  /** The voice ids the server gave it: the only ones it listens to in the park. */
  private near = new Set<string>();
  private talking: Promise<void> = Promise.resolve();
  private heardAt = 0;

  /** A new pass: into its room (out of the last one). */
  async join(pass: Pass): Promise<void> {
    if (this.pass && this.pass.room === pass.room && this.pass.canTalk === pass.canTalk && this.room) return;
    await this.leave();
    this.pass = pass;
    const room = new Room();
    room
      .on(RoomEvent.TrackPublished, (pub: RemoteTrackPublication, who: RemoteParticipant) => this.follow(pub, who))
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, who: RemoteParticipant) => {
        if (track.kind === TrackKind.KIND_AUDIO) void this.listen(track, who.identity);
      });
    await room.connect(pass.url, pass.token, { autoSubscribe: false, dynacast: false });
    this.room = room;
    console.log(`park-bot voice: in the ${pass.bench ? 'bench\'s own room (private)' : 'park\'s room'}${pass.canTalk ? '' : ', mic taken (voice ban)'}`);
    for (const who of room.remoteParticipants.values()) for (const pub of who.trackPublications.values()) this.follow(pub, who);
    if (pass.canTalk) {
      this.source = new AudioSource(RATE, 1);
      const track = LocalAudioTrack.createAudioTrack('bot-voice', this.source);
      await room.localParticipant!.publishTrack(track, new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }));
    }
  }

  /** The voice ids near it, from the park's frame: listen to those, and nobody else. */
  setNear(ids: readonly string[]): void {
    this.near = new Set(ids);
    if (!this.room) return;
    for (const who of this.room.remoteParticipants.values()) for (const pub of who.trackPublications.values()) this.follow(pub, who);
  }

  private follow(pub: RemoteTrackPublication, who: RemoteParticipant): void {
    if (pub.kind !== TrackKind.KIND_AUDIO) return;
    const want = this.pass?.bench === true || this.near.has(who.identity);
    if (pub.subscribed !== want) pub.setSubscribed(want);
  }

  /** Whoever it hears talking, a second at a time: said once in a while, in both ways. */
  private async listen(track: RemoteTrack, identity: string): Promise<void> {
    let sum = 0;
    let n = 0;
    for await (const frame of new AudioStream(track, RATE, 1)) {
      for (const s of frame.data) sum += s * s;
      n += frame.data.length;
      if (n < RATE) continue;
      const rms = Math.sqrt(sum / n);
      sum = 0; n = 0;
      if (rms < TALKING_RMS) continue;
      console.log(`park-bot voice: hears ${this.pass?.bench ? 'its partner' : 'someone near'} talking (level ${Math.round(rms)}) -- ${identity.slice(0, 6)}…`);
      if (Date.now() - this.heardAt > 20_000) {
        this.heardAt = Date.now();
        this.say('I can hear you! Your mic works.');
      }
    }
  }

  /** Say a line out loud, after whatever it is saying now. */
  say(text: string): void {
    const source = this.source;
    if (!source) return;
    this.talking = this.talking.then(async () => {
      const samples = speech(text);
      for (let i = 0; i < samples.length; i += FRAME) {
        const chunk = new Int16Array(FRAME);
        chunk.set(samples.subarray(i, i + FRAME));
        await source.captureFrame(new AudioFrame(chunk, RATE, 1, FRAME));
      }
      console.log(`park-bot voice: said out loud: ${text}`);
    }).catch((err: Error) => console.log(`park-bot voice: could not speak (${err.message})`));
  }

  async leave(): Promise<void> {
    const room = this.room;
    this.room = null;
    this.source = null;
    if (room) await room.disconnect().catch(() => {});
  }

  async close(): Promise<void> {
    await this.leave();
    await dispose().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
}
