// Tiny WebAudio synthesizer — no audio assets needed.

let ctx = null;
let muted = false;

try {
  muted = localStorage.getItem("ff-muted") === "1";
} catch {
  muted = false;
}

export function isMuted() {
  return muted;
}

export function setMuted(m) {
  muted = m;
  try {
    localStorage.setItem("ff-muted", m ? "1" : "0");
  } catch {
    /* private mode etc. */
  }
}

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume();
}

function tone(freq, start, dur, type = "sine", gain = 0.15, slideTo = null) {
  if (muted || !ctx) return;
  const t0 = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise(start, dur, gain = 0.12, freq = 800) {
  if (muted || !ctx) return;
  const t0 = ctx.currentTime + start;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(g).connect(ctx.destination);
  src.start(t0);
}

export function tap() {
  tone(520, 0, 0.08, "sine", 0.08);
}

export function plop() {
  // water plop: quick downward slide + splash noise
  tone(360, 0, 0.18, "sine", 0.18, 120);
  noise(0.02, 0.25, 0.08, 1200);
}

export function sparkle() {
  // found something! rising arpeggio
  tone(523, 0, 0.12, "triangle", 0.14);
  tone(659, 0.09, 0.12, "triangle", 0.14);
  tone(784, 0.18, 0.2, "triangle", 0.16);
}

export function fanfare() {
  // creature fully found
  const notes = [523, 659, 784, 1047];
  notes.forEach((f, i) => tone(f, i * 0.11, 0.22, "square", 0.07));
  notes.forEach((f, i) => tone(f * 0.5, i * 0.11, 0.22, "triangle", 0.1));
}

export function bigWin() {
  const melody = [523, 587, 659, 784, 880, 1047, 1319];
  melody.forEach((f, i) => {
    tone(f, i * 0.13, 0.3, "square", 0.06);
    tone(f / 2, i * 0.13, 0.3, "triangle", 0.1);
  });
  noise(0.9, 0.6, 0.05, 3000);
}

export function sad() {
  tone(392, 0, 0.25, "sine", 0.12, 330);
  tone(330, 0.22, 0.35, "sine", 0.12, 262);
}

export function whoosh() {
  noise(0, 0.3, 0.06, 500);
}

// ---------------------------------------------------------------- ambient
// gentle looping soundscape per world (waves / space hum / jungle)

let ambient = null;

function noiseBuffer(seconds = 2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i += 1) {
    // pinkish noise via leaky integrator
    last = last * 0.97 + (Math.random() * 2 - 1) * 0.03;
    data[i] = last * 8;
  }
  return buf;
}

export function startAmbient(worldId) {
  if (!ctx || muted) return;
  stopAmbient();
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  master.gain.linearRampToValueAtTime(1, ctx.currentTime + 2);
  const nodes = [master];
  const timers = [];

  const addNoise = (freq, q, gain, lfoRate, lfoDepth) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer();
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(master);
    if (lfoRate) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = lfoRate;
      const lg = ctx.createGain();
      lg.gain.value = lfoDepth;
      lfo.connect(lg).connect(g.gain);
      lfo.start();
      nodes.push(lfo);
    }
    src.start();
    nodes.push(src);
  };

  if (worldId === "ozean") {
    addNoise(420, 0.6, 0.045, 0.14, 0.03); // rolling waves
    addNoise(1600, 1.2, 0.012, 0.23, 0.008); // spray
  } else if (worldId === "teich") {
    addNoise(520, 0.9, 0.025, 0.17, 0.015); // gentle lapping
    const croak = () => {
      if (muted || !ambient) return;
      for (let i = 0; i < 2; i += 1) {
        tone(140 + Math.random() * 40, i * 0.18, 0.16, "sawtooth", 0.025, 95);
      }
      timers.push(setTimeout(croak, 3000 + Math.random() * 6000));
    };
    timers.push(setTimeout(croak, 1500));
  } else if (worldId === "weltraum") {
    for (const f of [55, 55.7, 110.3]) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.018;
      osc.connect(g).connect(master);
      osc.start();
      nodes.push(osc);
    }
    addNoise(900, 2.5, 0.006, 0.08, 0.004); // solar wind shimmer
  } else {
    addNoise(700, 0.8, 0.02, 0.19, 0.012); // breeze in the leaves
    // occasional bird chirps
    const chirp = () => {
      if (muted || !ambient) return;
      const base = 1400 + Math.random() * 900;
      for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i += 1) {
        tone(base + Math.random() * 300, i * 0.14, 0.1, "sine", 0.02, base * 1.3);
      }
      timers.push(setTimeout(chirp, 2500 + Math.random() * 5000));
    };
    timers.push(setTimeout(chirp, 1200));
  }

  ambient = {
    stop() {
      timers.forEach(clearTimeout);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
      setTimeout(() => {
        nodes.forEach((n) => {
          try {
            n.stop?.();
            n.disconnect?.();
          } catch {
            /* already stopped */
          }
        });
      }, 700);
    },
  };
}

export function stopAmbient() {
  if (ambient) {
    ambient.stop();
    ambient = null;
  }
}
