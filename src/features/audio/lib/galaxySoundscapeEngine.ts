import type { AMSynth, DuoSynth, FMSynth } from "tone";
import type { SoundscapeActionType, SoundscapeBellIntent } from "@/features/audio/utils/soundscapeMapping";

type ToneModule = typeof import("tone");
type BellSynth = AMSynth | DuoSynth | FMSynth;

export type GalaxySoundscapeEngine = {
  playBell: (intent: SoundscapeBellIntent) => void;
  dispose: () => void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createBellSynth(
  Tone: ToneModule,
  actionType: SoundscapeActionType,
  ownerVariant: number,
): BellSynth {
  switch (actionType) {
    case "attack":
      return new Tone.FMSynth({
        harmonicity: [2.3, 2.8, 3.15, 3.6][ownerVariant] ?? 2.8,
        modulationIndex: [6, 8, 10, 12][ownerVariant] ?? 8,
        oscillator: { type: (["triangle", "square", "sine", "fattriangle"][ownerVariant] ?? "triangle") as "triangle" },
        envelope: { attack: 0.002, decay: 0.22, sustain: 0.08, release: 1.1 },
        modulation: { type: (["sine", "triangle", "sawtooth", "sine"][ownerVariant] ?? "sine") as "sine" },
        modulationEnvelope: { attack: 0.001, decay: 0.16, sustain: 0, release: 0.5 },
      });
    case "defense":
      return new Tone.DuoSynth({
        vibratoAmount: [0.03, 0.06, 0.08, 0.11][ownerVariant] ?? 0.06,
        vibratoRate: [3, 4, 5, 6][ownerVariant] ?? 4,
        voice0: {
          oscillator: { type: (["sine", "triangle", "sine", "triangle"][ownerVariant] ?? "sine") as "sine" },
          envelope: { attack: 0.004, decay: 0.4, sustain: 0.12, release: 1.9 },
        },
        voice1: {
          oscillator: { type: (["triangle", "sawtooth", "square", "triangle"][ownerVariant] ?? "triangle") as "triangle" },
          envelope: { attack: 0.008, decay: 0.34, sustain: 0.08, release: 1.6 },
        },
      });
    case "exploration":
      return new Tone.AMSynth({
        harmonicity: [2.4, 3.2, 4.1, 5.2][ownerVariant] ?? 3.2,
        oscillator: { type: (["triangle", "sine", "fatsine", "triangle"][ownerVariant] ?? "triangle") as "triangle" },
        envelope: { attack: 0.003, decay: 0.18, sustain: 0.03, release: 1.3 },
        modulation: { type: (["sine", "triangle", "square", "sine"][ownerVariant] ?? "sine") as "sine" },
        modulationEnvelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.7 },
      });
  }
}

export async function ensureToneReady(): Promise<void> {
  const Tone = await import("tone");
  if (Tone.getContext().state !== "running") {
    await Tone.start();
  }
}

export async function createGalaxySoundscapeEngine(): Promise<GalaxySoundscapeEngine> {
  const Tone = await import("tone");

  const limiter = new Tone.Limiter(-2).toDestination();
  const masterGain = new Tone.Gain(0.84).connect(limiter);
  const reverb = new Tone.Reverb({ decay: 4.2, preDelay: 0.02, wet: 0.18 }).connect(masterGain);
  await reverb.generate();

  const actionBuses: Record<SoundscapeActionType, InstanceType<ToneModule["Gain"]>> = {
    attack: new Tone.Gain(1.08).connect(masterGain),
    defense: new Tone.Gain(0.96).connect(masterGain),
    exploration: new Tone.Gain(0.88).connect(masterGain),
  };

  const disposalTimers = new Set<number>();

  return {
    playBell(intent) {
      const synth = createBellSynth(Tone, intent.actionType, intent.ownerVariant);
      const filter = new Tone.Filter(intent.cutoffHz, "lowpass");
      const panner = new Tone.Panner(intent.pan);
      const dryGain = new Tone.Gain(intent.gain);
      const wetGain = new Tone.Gain(intent.gain * intent.reverbSend);
      const targetNote = Tone.Frequency(intent.note).transpose(intent.noteOffsetSemitones).toNote();

      synth.volume.value = -12 + clamp(intent.importance, 0, 1) * 8;
      if ("detune" in synth) {
        synth.detune.value = intent.ownerDetuneCents;
      }
      synth.connect(filter);
      filter.connect(panner);
      panner.connect(dryGain);
      dryGain.connect(actionBuses[intent.actionType]);
      panner.connect(wetGain);
      wetGain.connect(reverb);

      synth.triggerAttackRelease(targetNote, intent.releaseSeconds, undefined, intent.velocity);

      const disposeTimer = window.setTimeout(() => {
        disposalTimers.delete(disposeTimer);
        synth.dispose();
        filter.dispose();
        panner.dispose();
        dryGain.dispose();
        wetGain.dispose();
      }, Math.max(1600, Math.round((intent.releaseSeconds + 2.2) * 1000)));
      disposalTimers.add(disposeTimer);
    },
    dispose() {
      for (const timer of disposalTimers) {
        window.clearTimeout(timer);
      }
      disposalTimers.clear();
      reverb.dispose();
      masterGain.dispose();
      limiter.dispose();
      actionBuses.attack.dispose();
      actionBuses.defense.dispose();
      actionBuses.exploration.dispose();
    },
  };
}