export interface SoundPreferences {
  enabled: boolean;
  uiVolume: number;
  ambientVolume: number;
}
export class SoundManager {
  private context: AudioContext | null = null;
  private ambient: ReturnType<typeof setInterval> | null = null;
  private notes = [196, 246.94, 293.66, 392];
  private chapter = 0;
  preferences: SoundPreferences = {
    enabled: false,
    uiVolume: 0.3,
    ambientVolume: 0.1,
  };
  configure(preferences: SoundPreferences) {
    this.preferences = preferences;
    if (!preferences.enabled && this.ambient) {
      clearInterval(this.ambient);
      this.ambient = null;
    }
    this.startAmbient();
  }
  private startAmbient() {
    if (
      !this.ambient &&
      this.context?.state === "running" &&
      this.preferences.enabled
    )
      this.ambient = setInterval(() => {
        if (document.visibilityState === "visible") void this.play("ambience");
      }, 14000);
  }
  async unlock() {
    if (!this.context) this.context = new AudioContext();
    if (this.context.state === "suspended") await this.context.resume();
    this.startAmbient();
  }
  async play(
    category: "interface" | "success" | "warning" | "ambience" = "interface",
  ) {
    if (!this.preferences.enabled) return;
    try {
      await this.unlock();
      const ctx = this.context!,
        gain = ctx.createGain(),
        osc = ctx.createOscillator(),
        ambient = category === "ambience",
        volume = ambient
          ? this.preferences.ambientVolume
          : this.preferences.uiVolume,
        duration = ambient ? 3 : 0.16;
      gain.connect(ctx.destination);
      osc.connect(gain);
      osc.type = "sine";
      const frequency = ambient
        ? this.notes[this.chapter++ % this.notes.length]!
        : category === "success"
          ? 660
          : category === "warning"
            ? 180
            : 400;
      osc.frequency.setValueAtTime(frequency, ctx.currentTime);
      if (!ambient)
        osc.frequency.exponentialRampToValueAtTime(
          category === "success" ? 990 : category === "warning" ? 130 : 320,
          ctx.currentTime + 0.12,
        );
      gain.gain.setValueAtTime(
        Math.max(0.0001, volume * (ambient ? 0.025 : 0.15)),
        ctx.currentTime,
      );
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        ctx.currentTime + duration,
      );
      osc.start();
      osc.stop(ctx.currentTime + duration + 0.02);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    } catch {
      /* A browser may decline optional sound; application actions stay usable. */
    }
  }
}
export const sound = new SoundManager();
