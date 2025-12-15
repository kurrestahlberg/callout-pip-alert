// Pip-Boy themed sound definitions

import { AudioEngine } from "./audioEngine";
import {
  PIPBOY_FREQUENCIES,
  ENVELOPES,
  playTone,
  createOscillator,
  createGain,
} from "./synthesizer";

// ============================================================
// UI SOUNDS
// ============================================================

export function playTabClick(engine: AudioEngine, volume: number = 0.6): void {
  const ctx = engine.getContext();
  const master = engine.getMasterGain();
  console.log("[Audio] playTabClick called, ctx:", !!ctx, "master:", !!master);
  if (!ctx || !master) return;

  playTone(ctx, master, PIPBOY_FREQUENCIES.terminalClick, 0.03, "square", ENVELOPES.sharpClick, volume);
}

export function playButtonClick(engine: AudioEngine, volume: number = 0.5): void {
  const ctx = engine.getContext();
  const master = engine.getMasterGain();
  if (!ctx || !master) return;

  playTone(ctx, master, PIPBOY_FREQUENCIES.buttonClick, 0.02, "square", ENVELOPES.sharpClick, volume);
}

export function playToggleOn(engine: AudioEngine, volume: number = 0.5): void {
  const ctx = engine.getContext();
  const master = engine.getMasterGain();
  console.log("[Audio] playToggleOn called, ctx:", !!ctx, "master:", !!master);
  if (!ctx || !master) return;

  // Two quick ascending beeps - longer duration for audibility
  playTone(ctx, master, 800, 0.08, "square", ENVELOPES.sharpClick, volume);
  setTimeout(() => {
    playTone(ctx, master, 1200, 0.08, "square", ENVELOPES.sharpClick, volume);
  }, 100);
}

export function playToggleOff(engine: AudioEngine, volume: number = 0.5): void {
  const ctx = engine.getContext();
  const master = engine.getMasterGain();
  console.log("[Audio] playToggleOff called, ctx:", !!ctx, "master:", !!master);
  if (!ctx || !master) return;

  // Single lower beep - longer duration for audibility
  playTone(ctx, master, 500, 0.12, "square", ENVELOPES.sharpClick, volume);
}

export function playSuccess(engine: AudioEngine, volume: number = 0.5): void {
  const ctx = engine.getContext();
  const master = engine.getMasterGain();
  console.log("[Audio] playSuccess called, ctx:", !!ctx, "master:", !!master);
  if (!ctx || !master) return;

  // Two-tone ascending (musical fifth)
  // First tone
  playTone(ctx, master, PIPBOY_FREQUENCIES.noteA5, 0.08, "triangle", ENVELOPES.softChime, volume);

  // Second tone (delayed)
  setTimeout(() => {
    playTone(ctx, master, PIPBOY_FREQUENCIES.noteE6, 0.1, "triangle", ENVELOPES.softChime, volume);
  }, 70);
}

export function playError(engine: AudioEngine, volume: number = 0.6): void {
  const ctx = engine.getContext();
  const master = engine.getMasterGain();
  console.log("[Audio] playError called, ctx:", !!ctx, "master:", !!master);
  if (!ctx || !master) return;

  // Low buzzer
  playTone(ctx, master, 220, 0.2, "square", ENVELOPES.alarmSustain, volume);
}

// ============================================================
// BOOT SEQUENCE SOUNDS
// ============================================================

export function playTerminalBeep(engine: AudioEngine, volume: number = 0.3): void {
  const ctx = engine.getContext();
  const master = engine.getMasterGain();
  if (!ctx || !master) return;

  // Random duration for organic feel
  const duration = 0.008 + Math.random() * 0.007;
  playTone(ctx, master, PIPBOY_FREQUENCIES.terminalBeep, duration, "square", ENVELOPES.terminalBeep, volume);
}

export function playLineComplete(engine: AudioEngine, volume: number = 0.35): void {
  const ctx = engine.getContext();
  const master = engine.getMasterGain();
  if (!ctx || !master) return;

  playTone(ctx, master, PIPBOY_FREQUENCIES.lineComplete, 0.025, "square", ENVELOPES.terminalBeep, volume);
}

export function playSystemReady(engine: AudioEngine, volume: number = 0.5): void {
  const ctx = engine.getContext();
  const master = engine.getMasterGain();
  if (!ctx || !master) return;

  // Ascending three-tone fanfare
  const tones = [
    { freq: PIPBOY_FREQUENCIES.noteA4, delay: 0 },
    { freq: PIPBOY_FREQUENCIES.noteC5, delay: 100 },
    { freq: PIPBOY_FREQUENCIES.noteA5, delay: 200 },
  ];

  tones.forEach(({ freq, delay }) => {
    setTimeout(() => {
      playTone(ctx, master, freq, 0.15, "triangle", ENVELOPES.softChime, volume);
    }, delay);
  });
}

// ============================================================
// ALERT SOUNDS
// ============================================================

export interface AlertController {
  stop: () => void;
}

export function playRadiationAlarm(engine: AudioEngine, volume: number = 0.8): AlertController {
  const ctx = engine.getContext();
  const master = engine.getMasterGain();
  console.log("[Audio] playRadiationAlarm called, ctx:", !!ctx, "master:", !!master);

  if (!ctx || !master) {
    return { stop: () => {} };
  }

  // Use small offset to ensure we're in the future
  const now = ctx.currentTime + 0.01;

  // Main oscillator (carrier) - warbling alarm
  const carrier = createOscillator(ctx, "square", PIPBOY_FREQUENCIES.alarmBase);

  // Modulator for AM (amplitude modulation) - creates warble at 8Hz
  const modulator = createOscillator(ctx, "sine", 8);
  const modGain = createGain(ctx, 0.3); // 30% modulation depth

  // Output gain with volume
  const outputGain = createGain(ctx, volume * 0.7);

  // Slight frequency wobble for more organic feel
  carrier.frequency.setValueAtTime(PIPBOY_FREQUENCIES.alarmBase, now);
  carrier.frequency.linearRampToValueAtTime(PIPBOY_FREQUENCIES.alarmBase * 1.02, now + 0.5);
  carrier.frequency.linearRampToValueAtTime(PIPBOY_FREQUENCIES.alarmBase * 0.98, now + 1);
  carrier.frequency.linearRampToValueAtTime(PIPBOY_FREQUENCIES.alarmBase, now + 1.5);

  // Connect modulation
  modulator.connect(modGain);
  modGain.connect(outputGain.gain);

  // Connect carrier through output to master
  carrier.connect(outputGain);
  outputGain.connect(master);

  // Start
  carrier.start(now);
  modulator.start(now);

  // Auto-stop after 2 seconds
  const stopTime = now + 2;
  carrier.stop(stopTime);
  modulator.stop(stopTime);

  let stopped = false;

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;

      const currentTime = ctx.currentTime;
      outputGain.gain.exponentialRampToValueAtTime(0.001, currentTime + 0.1);

      setTimeout(() => {
        try {
          carrier.stop();
          modulator.stop();
        } catch {
          // Already stopped
        }
      }, 150);
    },
  };
}

export function playWarningTone(engine: AudioEngine, volume: number = 0.6): void {
  const ctx = engine.getContext();
  const master = engine.getMasterGain();
  console.log("[Audio] playWarningTone called, ctx:", !!ctx, "master:", !!master);
  if (!ctx || !master) return;

  // Two short pulses
  playTone(ctx, master, PIPBOY_FREQUENCIES.warningTone, 0.15, "square", ENVELOPES.alarmSustain, volume);

  setTimeout(() => {
    playTone(ctx, master, PIPBOY_FREQUENCIES.warningTone, 0.15, "square", ENVELOPES.alarmSustain, volume);
  }, 250);
}

export function playInfoChime(engine: AudioEngine, volume: number = 0.4): void {
  const ctx = engine.getContext();
  const master = engine.getMasterGain();
  if (!ctx || !master) return;

  // Soft single chime
  playTone(ctx, master, PIPBOY_FREQUENCIES.infoChime, 0.2, "triangle", ENVELOPES.softChime, volume);
}

// ============================================================
// AMBIENT SOUNDS
// ============================================================

export interface AmbientController {
  start: () => void;
  stop: () => void;
  setIntensity: (level: number) => void;
}

export function createGeigerAmbient(engine: AudioEngine, baseVolume: number = 1.2): AmbientController {
  let running = false;
  let intensity = 0.5;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const playGeigerClick = () => {
    const ctx = engine.getContext();
    const master = engine.getMasterGain();
    if (!ctx || !master) return;

    const now = ctx.currentTime;

    // Very short click - like electrical discharge (2-8ms)
    const duration = 0.002 + intensity * 0.006;
    const bufferSize = Math.floor(ctx.sampleRate * duration);

    // Create impulse-like noise buffer (sharp attack, instant decay)
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      // Sharp impulse with very fast decay - like a spark
      const envelope = Math.exp(-i / (bufferSize * 0.1));
      let sample = (Math.random() * 2 - 1);

      // At high intensity, add crackling distortion
      if (intensity > 0.7) {
        sample = Math.sign(sample) * Math.pow(Math.abs(sample), 0.5);
      }
      data[i] = sample * envelope;
    }

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    // Bright, sharp filter - Geiger clicks are quite bright/crispy
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(1500 + Math.random() * 1000, now);
    filter.Q.setValueAtTime(0.7, now);

    // Add presence/bite
    const presence = ctx.createBiquadFilter();
    presence.type = "peaking";
    presence.frequency.setValueAtTime(4000 + Math.random() * 2000, now);
    presence.Q.setValueAtTime(2, now);
    presence.gain.setValueAtTime(8, now);

    const gain = ctx.createGain();
    // Sharp, loud click
    const volume = baseVolume * (0.8 + intensity * 1.5);
    gain.gain.setValueAtTime(volume, now);
    // Very fast decay
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noiseSource.connect(filter);
    filter.connect(presence);
    presence.connect(gain);
    gain.connect(master);

    noiseSource.start(now);

    // At high intensity, sometimes add a secondary click (double-click effect)
    if (intensity > 0.6 && Math.random() < intensity * 0.4) {
      const delay = 0.01 + Math.random() * 0.02;
      setTimeout(() => {
        const ctx2 = engine.getContext();
        const master2 = engine.getMasterGain();
        if (!ctx2 || !master2) return;

        const now2 = ctx2.currentTime;
        const noise2 = ctx2.createBufferSource();
        noise2.buffer = noiseBuffer;

        const filter2 = ctx2.createBiquadFilter();
        filter2.type = "highpass";
        filter2.frequency.setValueAtTime(2000 + Math.random() * 1500, now2);

        const gain2 = ctx2.createGain();
        gain2.gain.setValueAtTime(volume * 0.6, now2);
        gain2.gain.exponentialRampToValueAtTime(0.001, now2 + duration * 0.7);

        noise2.connect(filter2);
        filter2.connect(gain2);
        gain2.connect(master2);
        noise2.start(now2);
      }, delay * 1000);
    }
  };

  const scheduleClick = () => {
    if (!running) return;

    playGeigerClick();

    // Schedule next click - more frequent with higher intensity
    // At intensity 0.2 (1 critical): 200-500ms
    // At intensity 1.0 (5+ criticals): 30-80ms (almost continuous rattling)
    const minInterval = 30 + 170 * (1 - intensity);
    const maxInterval = 80 + 420 * (1 - intensity);
    const nextInterval = minInterval + Math.random() * (maxInterval - minInterval);
    timeoutId = setTimeout(scheduleClick, nextInterval);
  };

  return {
    start: () => {
      if (running) return;
      console.log("[Audio] Geiger ambient started");
      running = true;
      scheduleClick();
    },
    stop: () => {
      if (running) {
        console.log("[Audio] Geiger ambient stopped");
      }
      running = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    },
    setIntensity: (level: number) => {
      intensity = Math.max(0, Math.min(1, level));
      console.log("[Audio] Geiger intensity:", intensity);
    },
  };
}

export function createElectricalHum(engine: AudioEngine, baseVolume: number = 0.15): AmbientController {
  let running = false;
  let oscillator: OscillatorNode | null = null;
  let gainNode: GainNode | null = null;

  return {
    start: () => {
      if (running) return;

      const ctx = engine.getContext();
      const master = engine.getMasterGain();
      if (!ctx || !master) return;

      running = true;

      // 60Hz power hum with harmonics
      oscillator = createOscillator(ctx, "sawtooth", PIPBOY_FREQUENCIES.powerHum);
      gainNode = createGain(ctx, baseVolume);

      // Heavy lowpass filter to make it subtle
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(120, ctx.currentTime);

      oscillator.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(master);

      oscillator.start();
    },
    stop: () => {
      if (!running) return;
      running = false;

      const ctx = engine.getContext();
      if (gainNode && ctx) {
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
      }

      setTimeout(() => {
        try {
          oscillator?.stop();
        } catch {
          // Already stopped
        }
        oscillator = null;
        gainNode = null;
      }, 150);
    },
    setIntensity: (level: number) => {
      if (gainNode) {
        const ctx = engine.getContext();
        if (ctx) {
          gainNode.gain.setValueAtTime(baseVolume * level, ctx.currentTime);
        }
      }
    },
  };
}
