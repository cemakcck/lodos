import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Volume2 } from "lucide-react";

export const SOUND_KEY = "lodos.kds.sound";

type AudioCtor = typeof AudioContext;
const audioCtor = (): AudioCtor | undefined =>
  typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext);

const readStored = () => {
  try {
    return localStorage.getItem(SOUND_KEY) === "on";
  } catch {
    return false;
  }
};

/** A short two-tone chime (E5 then B5, about 0.3 s), synthesised; no audio files. */
export function playChime(ctx: AudioContext): void {
  const start = ctx.currentTime + 0.01;
  const tones: [number, number][] = [
    [659.25, 0],
    [987.77, 0.12],
  ];
  for (const [freq, offset] of tones) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t0 = start + offset;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.2);
  }
}

export interface Chime {
  /** The user has turned sound on (remembered across visits). */
  enabled: boolean;
  /** The AudioContext exists and is running, so a chime will actually be heard. */
  active: boolean;
  /** Call from a tap: creates or resumes the AudioContext and remembers the choice. */
  enable: () => void;
  /** Plays the chime if sound is on and the browser allows it. */
  play: () => void;
}

/**
 * Browsers block audio until a gesture. The "Enable sound" tap creates the AudioContext and the choice is
 * remembered; after a reload the context is re-created on the next tap or key press anywhere on the page.
 */
export function useChime(): Chime {
  const [enabled, setEnabled] = useState(readStored);
  const [active, setActive] = useState(false);
  const ctx = useRef<AudioContext | null>(null);

  /** Creates or resumes the context; only works inside a user gesture. Reports whether it is running. */
  const unlock = useCallback(() => {
    const Ctor = audioCtor();
    if (!Ctor) return;
    if (!ctx.current || ctx.current.state === "closed") {
      ctx.current = new Ctor();
      ctx.current.onstatechange = () => setActive(ctx.current?.state === "running");
    }
    const c = ctx.current;
    if (c.state === "running") setActive(true);
    else void c.resume().then(() => setActive(c.state === "running"), () => setActive(false));
  }, []);

  const enable = useCallback(() => {
    unlock();
    try {
      localStorage.setItem(SOUND_KEY, "on");
    } catch {
      /* private mode: sound still works for this visit */
    }
    setEnabled(true);
  }, [unlock]);

  // Remembered "on" but not running (fresh page load): any first tap or key press on the page resumes it.
  useEffect(() => {
    if (!enabled || active) return;
    const onGesture = () => unlock();
    const detach = () => {
      window.removeEventListener("pointerdown", onGesture, true);
      window.removeEventListener("keydown", onGesture, true);
    };
    window.addEventListener("pointerdown", onGesture, true);
    window.addEventListener("keydown", onGesture, true);
    return detach;
  }, [enabled, active, unlock]);

  useEffect(
    () => () => {
      void ctx.current?.close().catch(() => {});
      ctx.current = null;
    },
    [],
  );

  const play = useCallback(() => {
    const c = ctx.current;
    if (!enabled || !c || c.state !== "running") return;
    try {
      playChime(c);
    } catch {
      /* audio is a nicety; never break the board */
    }
  }, [enabled]);

  return { enabled, active, enable, play };
}

/**
 * The toolbar button shown until sound is really playable: "Enable sound" the first time, then, after a reload
 * (choice remembered, context not yet allowed), a compact "Sound on, tap to activate".
 */
export function EnableSoundButton({ chime }: { chime: Chime }) {
  const { t } = useTranslation();
  if (chime.enabled && chime.active) return null;
  if (chime.enabled) {
    return (
      <button type="button" className="staff-btn kds-sound-arm" onClick={chime.enable}>
        <Volume2 size={16} strokeWidth={1.75} aria-hidden="true" />
        {t("kds.sound.activate")}
      </button>
    );
  }
  return (
    <button type="button" className="staff-btn" onClick={chime.enable} aria-label={t("kds.sound.enableAria")}>
      <Volume2 size={16} strokeWidth={1.75} aria-hidden="true" />
      {t("kds.sound.enable")}
    </button>
  );
}
