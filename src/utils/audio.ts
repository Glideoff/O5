/**
 * OVERSEER — Système sonore synthétique.
 *
 * Pas de fichiers MP3 : on génère tous les sons via Web Audio API en pur code.
 * Cela colle à l'esthétique "console de contrôle" et évite tout fichier binaire.
 *
 * Respecte settings.sounds_enabled + settings.sound_volume.
 */

import { useSettingsStore } from "../stores/settingsStore";

export type SoundName = "keter" | "breach" | "message" | "boot" | "resolved";

let _ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!_ctx) {
    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      _ctx = new Ctor();
    } catch (e) {
      console.warn("[OVERSEER] AudioContext non disponible:", e);
      return null;
    }
  }
  return _ctx;
}

/**
 * Joue un beep paramétré avec enveloppe ADSR simplifiée (attack 5ms, decay+release).
 */
function beep(
  ctx: AudioContext,
  opts: {
    freq: number;
    durationMs: number;
    type?: OscillatorType;
    volume: number;
    detuneCents?: number;
    startOffsetMs?: number;
  },
) {
  const start = ctx.currentTime + (opts.startOffsetMs ?? 0) / 1000;
  const end = start + opts.durationMs / 1000;

  const osc = ctx.createOscillator();
  osc.type = opts.type ?? "sine";
  osc.frequency.value = opts.freq;
  if (opts.detuneCents) osc.detune.value = opts.detuneCents;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(opts.volume, start + 0.005);
  gain.gain.setValueAtTime(opts.volume, end - 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(end + 0.02);
}

/* ==========================================================================
   Recettes pour chaque son
   ========================================================================== */

const RECIPES: Record<SoundName, (ctx: AudioContext, volume: number) => void> = {
  // KETER : grave et menaçant, double sirène 70Hz/140Hz avec léger tremolo
  keter: (ctx, vol) => {
    const baseFreq = 70;
    const harmonicFreq = 140;
    const duration = 1200;
    // Pulse 1
    beep(ctx, {
      freq: baseFreq,
      durationMs: duration,
      type: "square",
      volume: vol * 0.6,
    });
    beep(ctx, {
      freq: harmonicFreq,
      durationMs: duration,
      type: "sawtooth",
      volume: vol * 0.3,
    });
    // Petite chute pour ajouter du drame à 700ms
    beep(ctx, {
      freq: 90,
      durationMs: 400,
      type: "square",
      volume: vol * 0.45,
      startOffsetMs: 700,
    });
  },

  // BREACH : beep court double 600Hz puis 800Hz
  breach: (ctx, vol) => {
    beep(ctx, { freq: 600, durationMs: 90, type: "square", volume: vol * 0.5 });
    beep(ctx, {
      freq: 800,
      durationMs: 90,
      type: "square",
      volume: vol * 0.5,
      startOffsetMs: 110,
    });
  },

  // MESSAGE : clic discret style notification radio
  message: (ctx, vol) => {
    beep(ctx, {
      freq: 1400,
      durationMs: 45,
      type: "sine",
      volume: vol * 0.35,
    });
    beep(ctx, {
      freq: 1800,
      durationMs: 45,
      type: "sine",
      volume: vol * 0.25,
      startOffsetMs: 60,
    });
  },

  // BOOT : 3 beeps ascendants façon mise sous tension
  boot: (ctx, vol) => {
    [320, 480, 640].forEach((f, i) => {
      beep(ctx, {
        freq: f,
        durationMs: 90,
        type: "sine",
        volume: vol * 0.4,
        startOffsetMs: i * 110,
      });
    });
  },

  // RESOLVED : descendant doux 880 → 660 → 440, signal d'apaisement
  resolved: (ctx, vol) => {
    [880, 660, 440].forEach((f, i) => {
      beep(ctx, {
        freq: f,
        durationMs: 130,
        type: "sine",
        volume: vol * 0.42,
        startOffsetMs: i * 120,
      });
    });
  },
};

/* ==========================================================================
   API publique
   ========================================================================== */

/**
 * Joue le son OVERSEER nommé. Silencieux si :
 *   - settings.sounds_enabled est false
 *   - AudioContext non dispo (SSR / vieux browser)
 *   - autoplay bloqué par le browser (premier son après interaction utilisateur)
 */
export function playSound(name: SoundName): void {
  let enabled = true;
  let volumePct = 30;
  try {
    const s = useSettingsStore.getState();
    enabled = s.sounds_enabled;
    volumePct = s.sound_volume;
  } catch {
    /* settings indisponible → on garde les defaults */
  }

  if (!enabled) return;

  const ctx = getContext();
  if (!ctx) return;

  // Volume max ramené à 0.35 pour ne pas exploser les oreilles
  const volume = Math.max(0, Math.min(1, volumePct / 100)) * 0.35;
  if (volume <= 0) return;

  // L'AudioContext est suspendu tant qu'aucune interaction utilisateur n'a eu lieu.
  // On tente de le reprendre, mais on n'attend pas la promesse.
  void ctx.resume().catch(() => undefined);

  try {
    RECIPES[name](ctx, volume);
  } catch (e) {
    console.warn(`[OVERSEER] playSound(${name}) a échoué:`, e);
  }
}
