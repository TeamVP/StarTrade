export type UiSoundKind =
  | "button_press"
  | "select_star"
  | "select_fleet"
  | "select_colony_ship"
  | "select_trader_ship"
  | "drag_commit_success"
  | "drag_commit_cancel"
  | "sound_enabled_confirm"
  | "set_priority_star";

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
  set_priority_star: { cooldownMs: 400 },
};

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

class UiAudioEngine {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private lastPlayedAt = new Map<UiSoundKind, number>();
  private hoverOscillator: OscillatorNode | null = null;
  // @ts-ignore
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
        // Single bright sine ping — warm, simple, clearly positive
        this.playTonalGesture({
          frequencies: [880],
          type: "sine",
          peakGain: 0.052,
          attackSeconds: 0.005,
          decaySeconds: 0.22,
          filterHz: 3200,
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
        this.playSuccessGesture();
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
      case "set_priority_star":
        this.playTriumphGesture();
        return;
    }
  }

  /**
   * Triumphal ascending arpeggio: C5 → E5 → G5 → C6, staggered 60 ms apart.
   * Signals that a meaningful strategic decision has just been committed.
   */
  private playTriumphGesture() {
    const context = this.ensureContext();
    const output = this.masterGain;
    if (context === null || output === null) return;

    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    const stepMs = 60;

    notes.forEach((freq, i) => {
      const isTop = i === notes.length - 1;
      const delayS = (i * stepMs) / 1000;
      const now = context.currentTime + delayS;
      const attackSeconds = 0.006;
      const decaySeconds = isTop ? 0.9 : 0.55;

      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = isTop ? 4000 : 3200;
      filter.Q.value = 0.7;
      filter.connect(output);

      const env = context.createGain();
      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(isTop ? 0.068 : 0.052, now + attackSeconds);
      env.gain.exponentialRampToValueAtTime(0.0001, now + attackSeconds + decaySeconds);
      env.connect(filter);

      const osc = context.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(env);
      osc.start(now);
      osc.stop(now + attackSeconds + decaySeconds + 0.05);

      const totalMs = Math.round((delayS + attackSeconds + decaySeconds + 0.1) * 1000);
      window.setTimeout(() => { env.disconnect(); filter.disconnect(); }, totalMs);
    });
  }

  /** Bright high-register chord with long decay and rapid stereo pan shimmer. */
  private playSuccessGesture() {
    const context = this.ensureContext();
    const output = this.masterGain;
    if (context === null || output === null) return;

    const now = context.currentTime;
    const attackSeconds = 0.01;
    const decaySeconds = 1.4;
    const totalSeconds = attackSeconds + decaySeconds;

    // Stereo panner driven by a rapid LFO for left-right-left-right shimmer
    const panner = context.createStereoPanner();
    panner.connect(output);

    const panLfo = context.createOscillator();
    panLfo.type = "sine";
    panLfo.frequency.value = 12; // ~6 full left-right cycles over the note
    const panDepth = context.createGain();
    panDepth.gain.value = 0.45; // 45 % pan depth each side
    panLfo.connect(panDepth);
    panDepth.connect(panner.pan);
    panLfo.start(now);
    panLfo.stop(now + totalSeconds + 0.1);

    // Volume envelope
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.linearRampToValueAtTime(0.06, now + attackSeconds);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + totalSeconds);
    envelope.connect(panner);

    // Bright low-pass filter
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 4200;
    filter.Q.value = 0.5;
    filter.connect(envelope);

    // G5 / C6 / E6 — high C-major, bright and unambiguously positive
    for (const freq of [784, 1046.5, 1318.5]) {
      const osc = context.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(filter);
      osc.start(now);
      osc.stop(now + totalSeconds + 0.1);
    }

    window.setTimeout(() => {
      envelope.disconnect();
      filter.disconnect();
      panner.disconnect();
      panDepth.disconnect();
    }, Math.round((totalSeconds + 0.2) * 1000));
  }

  setFleetDragHoverActive(active: boolean) {
    const context = this.ensureContext();
    const output = this.masterGain;
    if (context === null || output === null) return;
    if (active === this.hoverActive) return;
    this.hoverActive = active;

    if (active) {
      if (this.hoverOscillator === null || this.hoverGain === null || this.hoverFilter === null) {
        // Two slightly-detuned square waves — the beating between them creates
        // a natural, organic buzz that reads unmistakably as "hovering over target".
        const oscA = context.createOscillator();
        oscA.type = "square";
        oscA.frequency.value = 68;

        const oscB = context.createOscillator();
        oscB.type = "square";
        oscB.frequency.value = 72; // ~4 Hz beat creates the buzz

        // Gentle low-pass keeps the buzz warm rather than harsh
        const filter = context.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 220;
        filter.Q.value = 1.2;

        const gain = context.createGain();
        gain.gain.value = 0.0001;

        oscA.connect(filter);
        oscB.connect(filter);
        filter.connect(gain);
        gain.connect(output);

        oscA.start();
        oscB.start();

        this.hoverOscillator = oscA;
        this.hoverModulator = oscB; // reuse field to keep second osc alive
        this.hoverGain = gain;
        this.hoverFilter = filter;
      }

      const g = this.hoverGain.gain;
      g.cancelScheduledValues(context.currentTime);
      g.setValueAtTime(g.value, context.currentTime);
      g.linearRampToValueAtTime(0.055, context.currentTime + 0.07);
      return;
    }

    if (this.hoverGain !== null) {
      const g = this.hoverGain.gain;
      g.cancelScheduledValues(context.currentTime);
      g.setValueAtTime(g.value, context.currentTime);
      g.linearRampToValueAtTime(0.0001, context.currentTime + 0.06);
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
