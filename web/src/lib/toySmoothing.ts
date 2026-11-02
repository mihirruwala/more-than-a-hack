// A toy for the Methodology page: a synthetic truth, a noisy per-frame guess of it, and the same
// centred majority vote the baseline uses. It explains a trade-off; it is not the model, and it
// never touches match data.

import { rng } from "../data/fixtures/demoMatch";

export type Toy = "H" | "A";

/** 600 frames: six possessions, one of them a short real one that over-smoothing will erase. */
export const TOY_TRUTH: Toy[] = [
  ...Array<Toy>(120).fill("H"),
  ...Array<Toy>(110).fill("A"),
  ...Array<Toy>(26).fill("H"), // a short real possession
  ...Array<Toy>(140).fill("A"),
  ...Array<Toy>(100).fill("H"),
  ...Array<Toy>(104).fill("A"),
];

/** The truth with deterministic flicker: about 14% of frames flipped, in short bursts. */
export const TOY_NOISY: Toy[] = (() => {
  const random = rng(7);
  const out = [...TOY_TRUTH];
  for (let i = 0; i < out.length; i += 1) {
    if (random() < 0.05) {
      const burst = 1 + Math.floor(random() * 5);
      for (let j = i; j < Math.min(out.length, i + burst); j += 1) out[j] = TOY_TRUTH[j] === "H" ? "A" : "H";
      i += burst;
    }
  }
  return out;
})();

/** Centred majority vote over ±window frames; ties keep the frame's own label. */
export function majority(labels: Toy[], window: number): Toy[] {
  if (window <= 0) return [...labels];
  const prefix = [0];
  for (const label of labels) prefix.push(prefix[prefix.length - 1]! + (label === "H" ? 1 : 0));
  return labels.map((label, i) => {
    const lo = Math.max(0, i - window);
    const hi = Math.min(labels.length, i + window + 1);
    const home = prefix[hi]! - prefix[lo]!;
    const away = hi - lo - home;
    return home === away ? label : home > away ? "H" : "A";
  });
}

export const countSpells = (labels: Toy[]) => labels.filter((l, i) => i === 0 || l !== labels[i - 1]).length;

export const agreement = (a: Toy[], b: Toy[]) => a.filter((l, i) => l === b[i]).length / a.length;

export function runs(labels: Toy[]): { start: number; end: number; state: Toy }[] {
  const out: { start: number; end: number; state: Toy }[] = [];
  labels.forEach((state, i) => {
    const last = out[out.length - 1];
    if (last && last.state === state) last.end = i + 1;
    else out.push({ start: i, end: i + 1, state });
  });
  return out;
}
