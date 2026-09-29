/**
 * The park, live, on the phone: frames from the server into who is here, what was
 * said into bubbles, and live people into the park's sim.
 *
 * WHAT IS GUARDED:
 *   - a person's look is carried from the frame that brought it to the frames that do
 *     not (the server sends it once); nobody is drawn before their look arrives; and
 *     somebody out of sight is dropped with it, as the server forgets it too;
 *   - a bubble is the speaker's latest line, and goes after BUBBLE_MS;
 *   - a live person glides to where the server says, jumps a gap too big to walk, and
 *     is never taken back by a roster refresh; one body each, never two.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - drop the look carry-over in `mergePeople` -> "carries the look" fails;
 *   - let `upsert` touch live people -> "a roster refresh leaves them alone" fails;
 *   - glide at walking pace only -> "closes on the server's word" fails.
 */
import { describe, expect, it } from 'vitest';
import { STARTER, type Look, type ParkPerson } from '@clone/shared';
import { BUBBLE_MS, bubbles, mergePeople, useParkLive, type Line } from '../src/features/world/park-live';
import { LIVE_CATCH_UP, LIVE_JUMP, WorldSim } from '../src/features/world/sim';
import { SEAT, benchFor, seatOn } from '../src/features/world/ride';

const REF = (n: number) => n.toString(16).padStart(32, '0');
const look: Look = { ...STARTER, hat: 3 };
const at = (ref: string, x: number, z: number, withLook = false): ParkPerson =>
  ({ ref, x, z, facing: 0, moving: false, ...(withLook ? { look } : {}) });

describe('who is here', () => {
  it('carries the look from the frame that brought it, and waits for it', () => {
    const one = mergePeople(new Map(), [at(REF(1), 1, 1, true), at(REF(2), 2, 2)]);
    expect([...one.keys()], 'somebody was drawn before their look came').toEqual([REF(1)]);
    const two = mergePeople(one, [at(REF(1), 3, 1), at(REF(2), 2, 2, true)]);
    expect(two.get(REF(1))).toMatchObject({ x: 3, look });
    expect(two.get(REF(2))?.look).toEqual(look);
  });

  it('drops somebody out of sight, look and all, so it is asked for again', () => {
    const one = mergePeople(new Map(), [at(REF(1), 1, 1, true)]);
    const gone = mergePeople(one, []);
    expect(gone.size).toBe(0);
    const back = mergePeople(gone, [at(REF(1), 1, 1)]);
    expect(back.size, 'came back with a look forgotten long ago').toBe(0);
  });

  it('forgets everybody on walking out, and takes no frames while out', () => {
    const s = useParkLive.getState();
    s.setIn(true);
    s.gotPeople([at(REF(1), 1, 1, true)]);
    s.gotLine('you', 'hello', 0);
    expect(useParkLive.getState().people.size).toBe(1);
    s.setIn(false);
    expect(useParkLive.getState().people.size).toBe(0);
    expect(useParkLive.getState().lines).toEqual([]);
    s.gotPeople([at(REF(1), 1, 1, true)]);
    expect(useParkLive.getState().people.size, 'a late frame put people back').toBe(0);
  });
});

describe('what was said', () => {
  it('floats the latest line of each speaker, and only while it lasts', () => {
    const lines: Line[] = [
      { id: 1, ref: 'a', text: 'first', at: 0 },
      { id: 2, ref: 'b', text: 'hi', at: 1000 },
      { id: 3, ref: 'a', text: 'second', at: 2000 },
    ];
    expect(bubbles(lines, 2500).map((l) => l.text).sort()).toEqual(['hi', 'second']);
    expect(bubbles(lines, 1000 + BUBBLE_MS).map((l) => l.text)).toEqual(['second']);
    expect(bubbles(lines, 2000 + BUBBLE_MS)).toEqual([]);
  });
});

describe('a live person in the park', () => {
  it('appears where the server says, and closes on the server\'s word', () => {
    const sim = new WorldSim(3);
    sim.live(REF(1), look, 5, 5, 0, false);
    expect(sim.get(REF(1))).toMatchObject({ kind: 'live', x: 5, z: 5, look });
    sim.live(REF(1), look, 5.5, 5, 0, true);
    for (let i = 0; i < Math.ceil((LIVE_CATCH_UP + 0.1) * 60); i++) sim.step(1 / 60);
    expect(sim.get(REF(1))!.x, 'still walking to where they were a quarter second ago').toBeCloseTo(5.5, 2);
    expect(sim.get(REF(1))!.state).toBe('walking');
  });

  it('jumps a gap too big to walk, which is a lost connection, not a stroll', () => {
    const sim = new WorldSim(3);
    sim.live(REF(1), look, 0, 0, 0, false);
    sim.live(REF(1), look, LIVE_JUMP + 1, 0, 0, false);
    sim.step(1 / 60);
    expect(sim.get(REF(1))!.x).toBe(LIVE_JUMP + 1);
  });

  it('takes the place of their agent, and a roster refresh leaves them alone', () => {
    const sim = new WorldSim(3);
    sim.upsert([{ ref: REF(1), kind: 'stranger', seed: 4, area: null }]);
    sim.live(REF(1), look, 1, 1, 0, false);
    expect(sim.agents().filter((a) => a.ref === REF(1)), 'two bodies for one person').toHaveLength(1);
    sim.upsert([{ ref: REF(1), kind: 'stranger', seed: 4, area: null }]);
    expect(sim.get(REF(1))!.kind).toBe('live');
    sim.unlive(REF(1));
    expect(sim.get(REF(1))).toBeUndefined();
    // Nobody else is taken away by it.
    sim.upsert([{ ref: REF(2), kind: 'stranger', seed: 5, area: null }]);
    sim.unlive(REF(2));
    expect(sim.get(REF(2))).toBeDefined();
  });
});

describe('talking with somebody in the park', () => {
  it('remembers who asked, rides only the one who asked, and forgets it all on parting or leaving', () => {
    const s = useParkLive.getState();
    s.setIn(true);
    s.gotAsked(REF(7), 'climbing');
    expect(useParkLive.getState().asked).toMatchObject({ ref: REF(7), why: 'climbing' });
    s.gotPaired(REF(7), null);                       // they came to you: no car
    expect(useParkLive.getState().partner).toEqual({ ref: REF(7), rideTo: null, asker: false });
    expect(useParkLive.getState().asked).toBeNull();
    s.gotParted();
    s.setFinding({ status: 'asking', ref: REF(8) });
    s.gotPaired(REF(8), [4, 5]);                     // you asked: the car takes you
    expect(useParkLive.getState().partner).toEqual({ ref: REF(8), rideTo: [4, 5], asker: true });
    expect(useParkLive.getState().finding).toBeNull();
    s.rode();
    expect(useParkLive.getState().partner).toEqual({ ref: REF(8), rideTo: null, asker: true });
    s.gotBench(3);
    s.gotParted();
    expect(useParkLive.getState()).toMatchObject({ partner: null, bench: null });
    s.gotPaired(REF(8), null); s.gotBench(2);
    s.setIn(false);
    expect(useParkLive.getState()).toMatchObject({ partner: null, bench: null, asked: null, finding: null });
  });

  it('carries who is sitting', () => {
    const got = mergePeople(new Map(), [{ ...at(REF(1), 1, 1, true), sitting: true }, at(REF(2), 2, 2, true)]);
    expect(got.get(REF(1))!.sitting).toBe(true);
    expect(got.get(REF(2))!.sitting).toBe(false);
  });
});

describe('a bench in the park sim', () => {
  const bench = { x: 5, z: 5, rot: 0.6 };

  it('walks you to the front of your seat, then sits you on it facing out', () => {
    const sim = new WorldSim(5);
    sim.upsert([{ ref: 'you', kind: 'you', seed: 7, area: null }]);
    sim.place('you', 5 + Math.sin(0.6) * 0.6, 5 + Math.cos(0.6) * 0.6);
    const seat = seatOn(bench, true);
    sim.sitOn('you', seat);
    for (let i = 0; i < 600 && sim.get('you')!.state !== 'sitting'; i++) sim.step(1 / 60);
    const me = sim.get('you')!;
    expect(me.state).toBe('sitting');
    expect(me.x).toBeCloseTo(seat.x, 5);
    expect(me.z).toBeCloseTo(seat.z, 5);
    expect(me.facing).toBeCloseTo(0.6, 5);
  });

  it('stands you up a step in front of it, by the button or by the stick', () => {
    const sim = new WorldSim(5);
    sim.upsert([{ ref: 'you', kind: 'you', seed: 7, area: null }]);
    const seat = seatOn(bench, false);
    sim.place('you', seat.x + Math.sin(0.6) * 0.13, seat.z + Math.cos(0.6) * 0.13);
    sim.sitOn('you', seat);
    for (let i = 0; i < 120; i++) sim.step(1 / 60);
    expect(sim.get('you')!.state).toBe('sitting');
    sim.standUp('you');
    expect(sim.get('you')!.state).toBe('idle');
    expect(Math.hypot(sim.get('you')!.x - seat.x, sim.get('you')!.z - seat.z)).toBeCloseTo(0.13, 5);
    sim.sitOn('you', seat);
    for (let i = 0; i < 120; i++) sim.step(1 / 60);
    sim.drive('you', 0.2, 0);
    sim.step(1 / 60);
    expect(sim.get('you')!.state, 'the stick left you sitting').toBe('walking');
    expect(sim.get('you')!.seat).toBeUndefined();
  });

  it('sits a live person once they are there', () => {
    const sim = new WorldSim(5);
    sim.live(REF(3), look, 1, 1, 0.4, false, true);
    sim.step(1 / 60);
    expect(sim.get(REF(3))!.state).toBe('sitting');
    sim.live(REF(3), look, 1.2, 1, 0.4, true, false);
    sim.step(1 / 60);
    expect(sim.get(REF(3))!.state).toBe('walking');
  });
});

describe('choosing a bench', () => {
  const benches = [{ x: 0, z: 0, rot: 0 }, { x: 10, z: 0, rot: 0 }, { x: 5, z: 1, rot: 0 }];

  it('takes the free one nearest the point between you, and not a taken one', () => {
    expect(benchFor(benches, [4, 0], [6, 0])).toBe(2);
    expect(benchFor(benches, [4, 0], [6, 0], new Set([2]))).toBe(0);
    expect(benchFor(benches, [4, 0], [6, 0], new Set([0, 1, 2]))).toBeNull();
  });

  it('puts the two of you side by side on it, the same way round on both phones', () => {
    for (const rot of [0, 0.7, -2]) {
      const b = { x: 3, z: 4, rot };
      const l = seatOn(b, true), r = seatOn(b, false);
      expect(Math.hypot(l.x - r.x, l.z - r.z)).toBeCloseTo(2 * SEAT, 5);
      expect(l.facing).toBe(rot);
      // Side by side: the line between them is across the way they face.
      const across = (r.x - l.x) * Math.sin(rot) + (r.z - l.z) * Math.cos(rot);
      expect(Math.abs(across)).toBeLessThan(1e-9);
    }
  });
});
