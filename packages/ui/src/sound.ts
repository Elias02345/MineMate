export interface SoundPreferences {
  enabled: boolean;
  uiVolume: number;
  ambientVolume: number;
}
export type SoundKind =
  | "interface"
  | "hover"
  | "wood"
  | "stone"
  | "craft"
  | "success"
  | "warning"
  | "portal"
  | "chest"
  | "pet"
  | "ambience";

/** Original synthesized game audio. No remote audio, autoplay, or game rips. */
export class SoundManager {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambient: ReturnType<typeof setInterval> | null = null;
  private voices = new Set<OscillatorNode>();
  private lastHover = 0;
  private chapter = 0;
  preferences: SoundPreferences = {
    enabled: false,
    uiVolume: 0.35,
    ambientVolume: 0.15,
  };

  configure(preferences: SoundPreferences) {
    const clamp = (value: number) =>
      Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    this.preferences = {
      enabled: preferences.enabled,
      uiVolume: clamp(preferences.uiVolume),
      ambientVolume: clamp(preferences.ambientVolume),
    };
    if (!preferences.enabled) this.silence();
    else {
      this.master?.gain.setValueAtTime(1, this.context!.currentTime);
      this.startAmbient();
    }
  }
  silence() {
    if (this.ambient) clearInterval(this.ambient);
    this.ambient = null;
    if (this.context && this.master)
      this.master.gain.setValueAtTime(0, this.context.currentTime);
    for (const voice of this.voices) {
      try {
        voice.stop();
      } catch {
        /* A finished voice is already silent. */
      }
    }
    this.voices.clear();
  }
  visibility(visible: boolean) {
    if (!visible) this.silence();
    else if (this.preferences.enabled) {
      this.master?.gain.setValueAtTime(1, this.context!.currentTime);
      this.startAmbient();
    }
  }
  private startAmbient() {
    if (
      this.ambient ||
      !this.preferences.enabled ||
      this.context?.state !== "running" ||
      document.hidden
    )
      return;
    this.ambient = setInterval(() => {
      void this.play("ambience");
    }, 11500);
  }
  async unlock() {
    if (!this.preferences.enabled) return;
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") await this.context.resume();
    if (!this.preferences.enabled || document.hidden) return;
    this.master!.gain.setValueAtTime(1, this.context.currentTime);
    this.startAmbient();
  }
  private note(
    frequency: number,
    delay: number,
    duration: number,
    type: OscillatorType,
    loudness: number,
    end?: number,
  ) {
    if (this.voices.size >= 24) return;
    const ctx = this.context!,
      start = ctx.currentTime + delay,
      oscillator = ctx.createOscillator(),
      envelope = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (end)
      oscillator.frequency.exponentialRampToValueAtTime(end, start + duration);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(loudness, start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(this.master!);
    this.voices.add(oscillator);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.025);
    oscillator.onended = () => {
      this.voices.delete(oscillator);
      oscillator.disconnect();
      envelope.disconnect();
    };
  }
  async play(kind: SoundKind = "interface") {
    if (!this.preferences.enabled || document.hidden) return;
    if (
      (kind === "ambience"
        ? this.preferences.ambientVolume
        : this.preferences.uiVolume) === 0
    )
      return;
    if (kind === "hover") {
      if (this.context?.state !== "running") return;
      const now = performance.now();
      if (now - this.lastHover < 140) return;
      this.lastHover = now;
    }
    try {
      await this.unlock();
      if (
        !this.preferences.enabled ||
        document.hidden ||
        this.context?.state !== "running"
      )
        return;
      const v = this.preferences.uiVolume * 0.075,
        sequence = (
          notes: number[],
          type: OscillatorType = "triangle",
          speed = 0.075,
        ) => {
          notes.forEach((frequency, i) =>
            this.note(frequency, i * speed, 0.24, type, v),
          );
        };
      switch (kind) {
        case "hover":
          this.note(740, 0, 0.045, "sine", v * 0.25, 900);
          break;
        case "interface":
          this.note(380, 0, 0.09, "square", v * 0.3, 190);
          break;
        case "wood":
          this.note(155, 0, 0.1, "triangle", v * 1.2, 70);
          this.note(310, 0.025, 0.06, "square", v * 0.2);
          break;
        case "stone":
          this.note(220, 0, 0.06, "square", v * 0.45, 80);
          break;
        case "craft":
          sequence([330, 440, 660]);
          break;
        case "success":
          sequence([523.25, 659.25, 783.99, 1046.5], "triangle", 0.095);
          break;
        case "warning":
          sequence([220, 174.61], "triangle", 0.12);
          break;
        case "portal":
          this.note(110, 0, 0.55, "sine", v, 440);
          this.note(165, 0.1, 0.7, "triangle", v * 0.4, 660);
          break;
        case "chest":
          sequence([130, 196, 261], "triangle", 0.045);
          break;
        case "pet":
          sequence([587, 880, 1174], "sine", 0.065);
          break;
        case "ambience": {
          const roots = [196, 164.81, 174.61, 146.83],
            root = roots[this.chapter++ % roots.length]!;
          [1, 1.5, 2, 2.5].forEach((ratio, i) =>
            this.note(
              root * ratio,
              i * 0.75,
              3.8,
              "sine",
              this.preferences.ambientVolume * 0.018,
            ),
          );
          break;
        }
      }
    } catch {
      // Sound is optional; a denied AudioContext must never interrupt an action.
    }
  }
}
export const sound = new SoundManager();
