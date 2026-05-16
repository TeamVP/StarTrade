import type { Player } from "tone";
import type {
  SoundscapeActionType,
  SoundscapeBellIntent,
  SoundscapeSampleKey,
} from "@/features/audio/utils/soundscapeMapping";

type ToneModule = typeof import("tone");
type BellPlayer = Player;

const SAMPLE_BANK_URLS: Record<SoundscapeSampleKey, string> = {
  player_attack: "/sounds/gong_short.ogg",
  player_defense: "/sounds/gong_long.ogg",
  player_exploration: "/sounds/chime.wav",
  enemy_attack: "/sounds/cowbell_enemy.ogg",
  enemy_defense: "/sounds/gong_short_enemy.ogg",
  enemy_exploration: "/sounds/chime_enemy.wav",
};

const SAMPLE_VOLUME_OFFSETS: Record<SoundscapeSampleKey, number> = {
  player_attack: -7,
  player_defense: -8,
  player_exploration: -10,
  enemy_attack: -11,
  enemy_defense: -13,
  enemy_exploration: -14,
};

export type GalaxySoundscapeEngine = {
  playBell: (intent: SoundscapeBellIntent) => void;
  dispose: () => void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function actionGainBoost(actionType: SoundscapeActionType): number {
  switch (actionType) {
    case "attack":
      return 0.06;
    case "defense":
      return 0.02;
    case "exploration":
      return 0;
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
  const sampleBuffers = new Tone.ToneAudioBuffers(SAMPLE_BANK_URLS);
  await Tone.loaded();

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
      const eventGain = intent.gain * clamp(intent.velocity, 0.2, 1);
      const player: BellPlayer = new Tone.Player({
        url: sampleBuffers.get(intent.sampleKey),
        fadeOut: Math.min(0.32, intent.releaseSeconds * 0.28),
      });
      const filter = new Tone.Filter(intent.cutoffHz, "lowpass");
      const panner = new Tone.Panner(intent.pan);
      const dryGain = new Tone.Gain(eventGain);
      const wetGain = new Tone.Gain(eventGain * intent.reverbSend);

      player.volume.value =
        (SAMPLE_VOLUME_OFFSETS[intent.sampleKey] ?? -12) +
        clamp(intent.importance, 0, 1) * 6 +
        (intent.isListenerOwnedEvent ? 1.5 : -0.5) +
        actionGainBoost(intent.actionType);
      player.playbackRate =
        Math.pow(2, intent.noteOffsetSemitones / 12) *
        Math.pow(2, intent.ownerDetuneCents / 1200) *
        (1 + intent.ownerVariant * 0.01);
      player.connect(filter);
      filter.connect(panner);
      panner.connect(dryGain);
      dryGain.connect(actionBuses[intent.actionType]);
      panner.connect(wetGain);
      wetGain.connect(reverb);

      player.start();
      if (intent.releaseSeconds < 2.8) {
        player.stop(Tone.now() + intent.releaseSeconds + 0.05);
      }

      const disposeTimer = window.setTimeout(() => {
        disposalTimers.delete(disposeTimer);
        player.dispose();
        filter.dispose();
        panner.dispose();
        dryGain.dispose();
        wetGain.dispose();
      }, Math.max(1800, Math.round((intent.releaseSeconds + 2.4) * 1000)));
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