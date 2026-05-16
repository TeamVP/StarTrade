import type { Player } from "tone";
import type {
  SoundscapeActionType,
  SoundscapeBellIntent,
  SoundscapeSampleKey,
} from "@/features/audio/utils/soundscapeMapping";
import { computeSoundscapeReverbTailSeconds } from "@/features/audio/utils/soundscapeTimeline";

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

const SAMPLE_FALLBACK_KEYS: Record<SoundscapeSampleKey, SoundscapeSampleKey> = {
  player_attack: "player_exploration",
  player_defense: "player_attack",
  player_exploration: "player_attack",
  enemy_attack: "enemy_exploration",
  enemy_defense: "enemy_attack",
  enemy_exploration: "enemy_attack",
};

export type GalaxySoundscapeEngine = {
  playBell: (intent: SoundscapeBellIntent) => void;
  dispose: () => void;
};

const MAX_EVENT_GAIN = 0.72;

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

export async function createGalaxySoundscapeEngine(params?: {
  turnDurationMs?: number | null;
}): Promise<GalaxySoundscapeEngine> {
  const Tone = await import("tone");
  const sampleBuffers = new Tone.ToneAudioBuffers(SAMPLE_BANK_URLS);
  await Tone.loaded();
  const reverbTailSeconds = computeSoundscapeReverbTailSeconds(params?.turnDurationMs);

  const limiter = new Tone.Limiter(-2).toDestination();
  const compressor = new Tone.Compressor({
    threshold: -18,
    ratio: 3,
    attack: 0.01,
    release: 0.24,
    knee: 12,
  }).connect(limiter);
  const masterGain = new Tone.Gain(0.72).connect(compressor);
  const reverb = new Tone.Reverb({
    decay: reverbTailSeconds,
    preDelay: 0.04,
    // This node sits on a dedicated send path, so it must stay fully wet.
    wet: 1,
  }).connect(masterGain);
  await reverb.generate();

  const actionBuses: Record<SoundscapeActionType, InstanceType<ToneModule["Gain"]>> = {
    attack: new Tone.Gain(0.92).connect(masterGain),
    defense: new Tone.Gain(0.84).connect(masterGain),
    exploration: new Tone.Gain(0.78).connect(masterGain),
  };

  const disposalTimers = new Set<number>();
  const warnedMissingSamples = new Set<SoundscapeSampleKey>();

  function resolveLoadedSampleBuffer(sampleKey: SoundscapeSampleKey) {
    const primaryBuffer = sampleBuffers.get(sampleKey);
    if (primaryBuffer.loaded) {
      return primaryBuffer;
    }

    const fallbackKey = SAMPLE_FALLBACK_KEYS[sampleKey];
    const fallbackBuffer = sampleBuffers.get(fallbackKey);
    if (fallbackBuffer.loaded) {
      if (!warnedMissingSamples.has(sampleKey)) {
        warnedMissingSamples.add(sampleKey);
        console.warn(`Soundscape sample ${sampleKey} is not loaded; falling back to ${fallbackKey}.`);
      }
      return fallbackBuffer;
    }

    if (!warnedMissingSamples.has(sampleKey)) {
      warnedMissingSamples.add(sampleKey);
      console.warn(`Soundscape sample ${sampleKey} and fallback ${fallbackKey} are not loaded yet.`);
    }
    return null;
  }

  return {
    playBell(intent) {
      const eventGain = clamp(intent.gain * clamp(intent.velocity, 0.2, 1), 0.08, MAX_EVENT_GAIN);
      const reverbSendGain = eventGain * clamp(intent.reverbSend * 0.72, 0.06, 0.22);
      const sampleBuffer = resolveLoadedSampleBuffer(intent.sampleKey);
      if (sampleBuffer === null) {
        return;
      }

      const player: BellPlayer = new Tone.Player(sampleBuffer).set({
        fadeOut: Math.min(1.4, Math.max(0.4, intent.releaseSeconds * 0.35)),
      });
      const filter = new Tone.Filter(intent.cutoffHz, "lowpass");
      const panner = new Tone.Panner(intent.pan);
      const dryGain = new Tone.Gain(eventGain);
      const wetGain = new Tone.Gain(reverbSendGain);

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
      const sustainSeconds = Math.max(intent.releaseSeconds, Math.min(4.5, reverbTailSeconds * 0.38));
      if (sustainSeconds < reverbTailSeconds) {
        player.stop(Tone.now() + sustainSeconds);
      }

      const disposeTimer = window.setTimeout(() => {
        disposalTimers.delete(disposeTimer);
        player.dispose();
        filter.dispose();
        panner.dispose();
        dryGain.dispose();
        wetGain.dispose();
      }, Math.max(3200, Math.round((sustainSeconds + 3.6) * 1000)));
      disposalTimers.add(disposeTimer);
    },
    dispose() {
      for (const timer of disposalTimers) {
        window.clearTimeout(timer);
      }
      disposalTimers.clear();
      reverb.dispose();
      masterGain.dispose();
      compressor.dispose();
      limiter.dispose();
      actionBuses.attack.dispose();
      actionBuses.defense.dispose();
      actionBuses.exploration.dispose();
    },
  };
}
