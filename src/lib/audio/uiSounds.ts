export type UiSoundKind =
  | "button_press"
  | "select_star"
  | "select_fleet"
  | "select_colony_ship"
  | "select_trader_ship"
  | "drag_commit_success"
  | "drag_commit_cancel"
  | "sound_enabled_confirm";

type UiSoundConfig = {
  cooldownMs: number;
};

const SOUND_CONFIG: Record<UiSoundKind, UiSoundConfig> = {
  button_press: { cooldownMs: 40 },
  select_star: { cooldownMs: 80 },
  select_fleet: { cooldownMs: 80 },
  select_colony_ship: { cooldownMs: 80 },
  select_trader_ship: { cooldownMs: 80 },
  drag_commit_success: { cooldownMs: 140 },
  drag_commit_cancel: { cooldownMs: 140 },
  sound_enabled_confirm: { cooldownMs: 180 },
};

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

class UiAudioEngine {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private lastPlayedAt = new Map<UiSoundKind, number>();
  private hoverOscillator: OscillatorNode | null = null;
  private hoverModulator: OscillatorNode | null = null;
  private hoverGain: GainNode | null = null;
  private hoverFilter: BiquadFilterNode | null = null;
  private hoverActive = false;

  private ensureContext(): AudioContext | null {
    if (typeof window === "undefined") {
      return null;
    }
    if (this.context === null) {
      const AudioContextCtor = window.AudioContext ?? (window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }).webkitAudioContext;
      if (AudioContextCtor === undefined) {
        return null;
      }
      this.context = new AudioContextCtor();
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = 0.22;
      this.masterGain.connect(this.context.destination);
    }
    if (this.context.state === "suspended") {
      void this.context.resume();
    }
    return this.context;
  }

  private withinCooldown(kind: UiSoundKind): boolean {
    const config = SOUND_CONFIG[kind];
    const previous = this.lastPlayedAt.get(kind) ?? -Infinity;
    const current = nowMs();
    if (current - previous < config.cooldownMs) {
      return true;
    }
    this.lastPlayedAt.set(kind, current);
    return false;
  }

  private createEnvelope(context: AudioContext, output: AudioNode, params: {
    startGain: number;
    peakGain: number;
    attackSeconds: number;
    decaySeconds: number;
  }): GainNode {
    const gain = context.createGain();
    const startedAt = context.currentTime;
    gain.gain.setValueAtTime(params.startGain, startedAt);
    gain.gain.linearRampToValueAtTime(params.peakGain, startedAt + params.attackSeconds);
    gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + params.attackSeconds + params.decaySeconds);
    gain.connect(output);
    return gain;
  }

  private playTonalGesture(params: {
    frequencies: number[];
    type?: OscillatorType;
    peakGain: number;
    attackSeconds: number;
    decaySeconds: number;
    detuneCents?: number;
    filterHz?: number;
  }) {
    const context = this.ensureContext();
    const output = this.masterGain;
    if (context === null || output === null) {
      return;
    }

    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = params.filterHz ?? 2400;
    filter.Q.value = 0.8;
    filter.connect(output);

    const envelope = this.createEnvelope(context, filter, {
      startGain: 0.0001,
      peakGain: params.peakGain,
      attackSeconds: params.attackSeconds,
      decaySeconds: params.decaySeconds,
    });

    for (const frequency of params.frequencies) {
      const oscillator = context.createOscillator();
      oscillator.type = params.type ?? "sine";
      oscillator.frequency.value = frequency;
      oscillator.detune.value = params.detuneCents ?? 0;
      oscillator.connect(envelope);
      oscillator.start();
      oscillator.stop(context.currentTime + params.attackSeconds + params.decaySeconds + 0.05);
    }

    window.setTimeout(() => {
      envelope.disconnect();
      filter.disconnect();
    }, Math.round((params.attackSeconds + params.decaySeconds + 0.12) * 1000));
  }

  play(kind: UiSoundKind) {
    if (this.withinCooldown(kind)) {
      return;
    }

    switch (kind) {
      case "button_press":
        this.playTonalGesture({
          frequencies: [880, 1320],
          type: "triangle",
          peakGain: 0.04,
          attackSeconds: 0.004,
          decaySeconds: 0.08,
          filterHz: 2200,
        });
        return;
      case "select_star":
        this.playTonalGesture({
          frequencies: [740, 1110],
          type: "sine",
          peakGain: 0.055,
          attackSeconds: 0.01,
          decaySeconds: 0.22,
          filterHz: 2800,
        });
        return;
      case "select_fleet":
        this.playTonalGesture({
          frequencies: [330, 495],
          type: "triangle",
          peakGain: 0.05,
          attackSeconds: 0.006,
          decaySeconds: 0.18,
          filterHz: 1900,
        });
        return;
      case "select_colony_ship":
        this.playTonalGesture({
          frequencies: [392, 588],
          type: "sine",
          peakGain: 0.045,
          attackSeconds: 0.01,
          decaySeconds: 0.24,
          filterHz: 2100,
        });
        return;
      case "select_trader_ship":
        this.playTonalGesture({
          frequencies: [660, 990],
          type: "triangle",
          peakGain: 0.042,
          attackSeconds: 0.005,
          decaySeconds: 0.14,
          filterHz: 2600,
        });
        return;
      case "drag_commit_success":
        this.playTonalGesture({
          frequencies: [392, 523.25, 659.25],
          type: "sine",
          peakGain: 0.05,
          attackSeconds: 0.008,
          decaySeconds: 0.28,
          filterHz: 2600,
        });
        return;
      case "drag_commit_cancel":
        this.playTonalGesture({
          frequencies: [440, 349.23],
          type: "triangle",
          peakGain: 0.038,
          attackSeconds: 0.006,
          decaySeconds: 0.18,
          detuneCents: -8,
          filterHz: 1500,
        });
        return;
      case "sound_enabled_confirm":
        this.playTonalGesture({
          frequencies: [523.25, 783.99],
          type: "sine",
          peakGain: 0.052,
          attackSeconds: 0.01,
          decaySeconds: 0.34,
          filterHz: 3000,
        });
        return;
    }
  }

  setFleetDragHoverActive(active: boolean) {
    const context = this.ensureContext();
    const output = this.masterGain;
    if (context === null || output === null) {
      return;
    }
    if (active === this.hoverActive) {
      return;
    }
    this.hoverActive = active;

    if (active) {
      if (this.hoverOscillator === null || this.hoverGain === null || this.hoverFilter === null) {
        const carrier = context.createOscillator();
        carrier.type = "sawtooth";
        carrier.frequency.value = 96;

        const filter = context.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = 640;
        filter.Q.value = 6;

        const gain = context.createGain();
        gain.gain.value = 0.0001;

        const modulator = context.createOscillator();
        modulator.type = "sine";
        modulator.frequency.value = 7.5;

        const modGain = context.createGain();
        modGain.gain.value = 120;

        carrier.connect(filter);
        filter.connect(gain);
        gain.connect(output);
        modulator.connect(modGain);
        modGain.connect(filter.frequency);

        carrier.start();
        modulator.start();

        this.hoverOscillator = carrier;
        this.hoverModulator = modulator;
        this.hoverGain = gain;
        this.hoverFilter = filter;
      }

      this.hoverGain.gain.cancelScheduledValues(context.currentTime);
      this.hoverGain.gain.setValueAtTime(this.hoverGain.gain.value, context.currentTime);
      this.hoverGain.gain.linearRampToValueAtTime(0.018, context.currentTime + 0.08);
      return;
    }

    if (this.hoverGain !== null && this.hoverModulator !== null) {
      this.hoverGain.gain.cancelScheduledValues(context.currentTime);
      this.hoverGain.gain.setValueAtTime(this.hoverGain.gain.value, context.currentTime);
      this.hoverGain.gain.linearRampToValueAtTime(0.0001, context.currentTime + 0.06);
    }
  }
}

const engine = new UiAudioEngine();

export function playUiSound(kind: UiSoundKind) {
  engine.play(kind);
}

export function setFleetDragHoverSoundActive(active: boolean) {
  engine.setFleetDragHoverActive(active);
}