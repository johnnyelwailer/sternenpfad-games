// Minimal tween engine for the 3D scene — no dependencies.

const active = new Set();

export const Ease = {
  linear: (t) => t,
  outQuad: (t) => t * (2 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  outCubic: (t) => 1 + (t - 1) ** 3,
  inOutCubic: (t) => (t < 0.5 ? 4 * t ** 3 : 1 + 4 * (t - 1) ** 3),
  outBack: (t) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2,
  outElastic: (t) =>
    t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
  outBounce: (t) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

// tween((v)=>{...}, {dur, ease, delay, onDone}) drives v from 0..1
export function tween(apply, { dur = 0.5, ease = Ease.outQuad, delay = 0, onDone = null } = {}) {
  const tw = { apply, dur, ease, delay, onDone, t: -delay, done: false };
  active.add(tw);
  return {
    cancel() {
      active.delete(tw);
    },
  };
}

export function tweenValue(from, to, setter, opts = {}) {
  return tween((v) => setter(from + (to - from) * v), opts);
}

export function updateTweens(dt) {
  for (const tw of [...active]) {
    tw.t += dt;
    if (tw.t < 0) continue;
    const v = Math.min(1, tw.t / tw.dur);
    tw.apply(tw.ease(v));
    if (v >= 1) {
      active.delete(tw);
      if (tw.onDone) tw.onDone();
    }
  }
}

export function clearTweens() {
  active.clear();
}
