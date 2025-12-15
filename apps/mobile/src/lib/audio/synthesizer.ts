// Synthesizer utilities for Pip-Boy themed sounds

export interface ADSREnvelope {
  attack: number;  // seconds
  decay: number;   // seconds
  sustain: number; // 0-1 level
  release: number; // seconds
}

// Pip-Boy characteristic frequencies
export const PIPBOY_FREQUENCIES = {
  // Terminal/UI sounds (high, sharp)
  terminalClick: 2400,
  buttonClick: 1800,
  terminalLow: 1200,

  // Musical tones
  noteA4: 440,
  noteC5: 523,
  noteE5: 659,
  noteA5: 880,
  noteE6: 1319,

  // Boot sequence
  terminalBeep: 2000,
  lineComplete: 2800,

  // Alerts
  alarmBase: 880,
  warningTone: 660,
  infoChime: 1047,

  // Ambient
  powerHum: 60,
  geigerClick: 4800,
};

// Predefined ADSR envelopes for different sound types
export const ENVELOPES = {
  sharpClick: {
    attack: 0.002,
    decay: 0.02,
    sustain: 0.3,
    release: 0.01,
  } as ADSREnvelope,

  terminalBeep: {
    attack: 0.005,
    decay: 0.015,
    sustain: 0.5,
    release: 0.02,
  } as ADSREnvelope,

  softChime: {
    attack: 0.01,
    decay: 0.1,
    sustain: 0.4,
    release: 0.2,
  } as ADSREnvelope,

  alarmSustain: {
    attack: 0.05,
    decay: 0.1,
    sustain: 0.8,
    release: 0.3,
  } as ADSREnvelope,

  toggleSweep: {
    attack: 0.01,
    decay: 0.05,
    sustain: 0.6,
    release: 0.03,
  } as ADSREnvelope,
};

// Apply ADSR envelope to a gain node
export function applyADSR(
  _ctx: AudioContext,
  gainNode: GainNode,
  envelope: ADSREnvelope,
  startTime: number,
  duration?: number
): void {
  const { attack, decay, sustain, release } = envelope;
  // Ensure startTime is never negative
  const now = Math.max(0, startTime);

  // Start at 0
  gainNode.gain.setValueAtTime(0, now);

  // Attack: ramp to 1
  gainNode.gain.linearRampToValueAtTime(1, now + attack);

  // Decay: ramp to sustain level
  gainNode.gain.linearRampToValueAtTime(sustain, now + attack + decay);

  // If duration specified, hold sustain then release
  if (duration !== undefined) {
    const releaseStart = Math.max(now, now + duration - release);
    gainNode.gain.setValueAtTime(sustain, releaseStart);
    gainNode.gain.linearRampToValueAtTime(0, now + duration);
  }
}

// Create an oscillator with specified parameters
export function createOscillator(
  ctx: AudioContext,
  type: OscillatorType,
  frequency: number
): OscillatorNode {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, ctx.currentTime);
  return osc;
}

// Create a gain node with initial value
export function createGain(ctx: AudioContext, initialValue: number = 1): GainNode {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(initialValue, ctx.currentTime);
  return gain;
}

// Create a bandpass filter
export function createBandpassFilter(
  ctx: AudioContext,
  frequency: number,
  Q: number = 1
): BiquadFilterNode {
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(frequency, ctx.currentTime);
  filter.Q.setValueAtTime(Q, ctx.currentTime);
  return filter;
}

// Create a lowpass filter
export function createLowpassFilter(
  ctx: AudioContext,
  frequency: number
): BiquadFilterNode {
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(frequency, ctx.currentTime);
  return filter;
}

// Create noise buffer for Geiger clicks and static
export function createNoiseBuffer(ctx: AudioContext, duration: number): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const bufferSize = sampleRate * duration;
  const buffer = ctx.createBuffer(1, bufferSize, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  return buffer;
}

// Play a simple tone with envelope
export function playTone(
  ctx: AudioContext,
  destination: AudioNode,
  frequency: number,
  duration: number,
  waveform: OscillatorType = "square",
  envelope: ADSREnvelope = ENVELOPES.sharpClick,
  volume: number = 0.5
): void {
  // Use a small offset to ensure we're always in the future
  const now = ctx.currentTime + 0.01;

  const osc = createOscillator(ctx, waveform, frequency);
  const gain = createGain(ctx, 0);

  // Apply volume scaling
  const scaledEnvelope = {
    ...envelope,
    sustain: envelope.sustain * volume,
  };

  osc.connect(gain);
  gain.connect(destination);

  applyADSR(ctx, gain, scaledEnvelope, now, duration);

  osc.start(now);
  osc.stop(now + duration + 0.01);
}

// Play a frequency sweep (for toggle sounds)
export function playFrequencySweep(
  ctx: AudioContext,
  destination: AudioNode,
  startFreq: number,
  endFreq: number,
  duration: number,
  waveform: OscillatorType = "square",
  volume: number = 0.5
): void {
  const now = ctx.currentTime;

  const osc = createOscillator(ctx, waveform, startFreq);
  const gain = createGain(ctx, 0);

  osc.frequency.linearRampToValueAtTime(endFreq, now + duration * 0.8);

  osc.connect(gain);
  gain.connect(destination);

  applyADSR(ctx, gain, { ...ENVELOPES.toggleSweep, sustain: ENVELOPES.toggleSweep.sustain * volume }, now, duration);

  osc.start(now);
  osc.stop(now + duration + 0.01);
}
