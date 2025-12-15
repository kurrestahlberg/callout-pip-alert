// Riff-Boy Audio System - Main export

export { AudioEngine, audioEngine } from "./audioEngine";

export {
  PIPBOY_FREQUENCIES,
  ENVELOPES,
  type ADSREnvelope,
} from "./synthesizer";

export {
  // UI Sounds
  playTabClick,
  playButtonClick,
  playToggleOn,
  playToggleOff,
  playSuccess,
  playError,

  // Boot Sounds
  playTerminalBeep,
  playLineComplete,
  playSystemReady,

  // Alert Sounds
  playRadiationAlarm,
  playWarningTone,
  playInfoChime,
  type AlertController,

  // Ambient Sounds
  createGeigerAmbient,
  createElectricalHum,
  type AmbientController,
} from "./sounds";
