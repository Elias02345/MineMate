import { sound } from "./sound.ts";

export interface Preferences {
  enabled: boolean;
  uiVolume: number;
  ambientVolume: number;
  reduced: boolean;
  companions: boolean;
}
const defaults: Preferences = {
  enabled: false,
  uiVolume: 0.35,
  ambientVolume: 0.15,
  reduced: false,
  companions: true,
};
function volume(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}
export function readPreferences(): Preferences {
  try {
    const saved = JSON.parse(
      localStorage.getItem("minemate.preferences") ?? "{}",
    );
    return {
      enabled: saved.enabled === true,
      reduced: saved.reduced === true,
      companions: saved.companions !== false,
      uiVolume: volume(saved.uiVolume, defaults.uiVolume),
      ambientVolume: volume(saved.ambientVolume, defaults.ambientVolume),
    };
  } catch {
    return { ...defaults };
  }
}
export function applyPreferences(preferences: Preferences) {
  sound.configure(preferences);
  document.documentElement.dataset.companions = String(preferences.companions);
  document.documentElement.classList.toggle(
    "reduced-effects",
    preferences.reduced,
  );
}
export function savePreferences(preferences: Preferences) {
  try {
    localStorage.setItem("minemate.preferences", JSON.stringify(preferences));
  } catch {
    // The current session remains usable when browser storage is unavailable.
  }
  applyPreferences(preferences);
  window.dispatchEvent(
    new CustomEvent("minemate-preferences", { detail: preferences }),
  );
}
export function feedback(kind: "success" | "warning") {
  window.dispatchEvent(new CustomEvent("minemate-feedback", { detail: kind }));
}
