import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { MotionConfig, useReducedMotion } from "motion/react";
import { Asset } from "../../../packages/ui/src/index.tsx";
import {
  applyPreferences,
  readPreferences,
  type Preferences,
} from "../../../packages/ui/src/preferences.ts";
import { sound, type SoundKind } from "../../../packages/ui/src/sound.ts";
import { useI18n } from "./i18n.tsx";
import { Companions } from "./Companions.tsx";

const ExperienceContext = createContext<{
  preferences: Preferences;
  scene: string;
  setScene: (scene: string) => void;
}>({ preferences: readPreferences(), scene: "overworld", setScene: () => {} });
export const useExperience = () => useContext(ExperienceContext);
export function useScene(scene: string | null) {
  const { setScene } = useExperience();
  useEffect(() => {
    if (scene) setScene(scene);
  }, [scene, setScene]);
}
interface Pixel {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  color: string;
  size: number;
}

export function Experience({ children }: { children: ReactNode }) {
  const { t } = useI18n(),
    [preferences, setPreferences] = useState(readPreferences),
    [scene, setScene] = useState("overworld"),
    [celebration, setCelebration] = useState<"success" | "warning" | null>(
      null,
    ),
    canvas = useRef<HTMLCanvasElement>(null),
    systemReduced = useReducedMotion(),
    reduced = preferences.reduced || !!systemReduced;

  useLayoutEffect(() => {
    applyPreferences(readPreferences());
    const update = (event: Event) =>
      setPreferences(
        (event as CustomEvent<Preferences>).detail ?? readPreferences(),
      );
    window.addEventListener("minemate-preferences", update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener("minemate-preferences", update);
      window.removeEventListener("storage", update);
      sound.silence();
    };
  }, []);
  useEffect(() => {
    applyPreferences(preferences);
  }, [preferences]);
  useEffect(() => {
    document.documentElement.dataset.scene = scene;
  }, [scene]);
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const received = (event: Event) => {
      const kind = (event as CustomEvent).detail;
      if (kind !== "success" && kind !== "warning") return;
      void sound.play(kind);
      setCelebration(kind);
      clearTimeout(timeout);
      timeout = setTimeout(() => setCelebration(null), 3600);
    };
    window.addEventListener("minemate-feedback", received);
    return () => {
      window.removeEventListener("minemate-feedback", received);
      clearTimeout(timeout);
    };
  }, []);
  useEffect(() => {
    const element = canvas.current!,
      context = element.getContext("2d");
    let pixels: Pixel[] = [],
      frame = 0,
      width = innerWidth,
      height = innerHeight;
    const resize = () => {
      width = innerWidth;
      height = innerHeight;
      const ratio = Math.min(devicePixelRatio || 1, 2);
      element.width = width * ratio;
      element.height = height * ratio;
      context?.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    const render = (now: number) => {
      frame = 0;
      if (!context) return;
      context.clearRect(0, 0, width, height);
      pixels = pixels.filter((pixel) => now - pixel.born < pixel.life);
      for (const pixel of pixels) {
        const age = (now - pixel.born) / 1000;
        context.globalAlpha = Math.max(0, 1 - (now - pixel.born) / pixel.life);
        context.fillStyle = pixel.color;
        context.fillRect(
          Math.round(pixel.x + pixel.vx * age),
          Math.round(pixel.y + pixel.vy * age + 140 * age * age),
          pixel.size,
          pixel.size,
        );
      }
      context.globalAlpha = 1;
      if (pixels.length) frame = requestAnimationFrame(render);
    };
    const burst = (x: number, y: number, count = 8) => {
      if (reduced || document.hidden || !context) return;
      const colors = ["#a4db5b", "#f7d978", "#5dddd0", "#fff0c5"];
      for (let i = 0; i < count; i++)
        pixels.push({
          x,
          y,
          vx: (Math.random() - 0.5) * 180,
          vy: -60 - Math.random() * 130,
          born: performance.now(),
          life: 500 + Math.random() * 450,
          color: colors[i % colors.length]!,
          size: 3 + (i % 3) * 2,
        });
      pixels = pixels.slice(-96);
      if (!frame) frame = requestAnimationFrame(render);
    };
    const target = (event: Event) =>
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(
            "button, a, summary, input[type=checkbox], select",
          )
        : null;
    const clickable = (node: HTMLElement | null) =>
      node && !node.matches(":disabled, [aria-disabled=true], [data-silent]");
    const click = (event: MouseEvent) => {
      const node = target(event);
      if (!clickable(node)) return;
      void sound.play(
        (node!.dataset.sound as SoundKind | undefined) ??
          (node!.getAttribute("role") === "tab" ? "wood" : "interface"),
      );
      if (node!.matches("input,select") || node!.closest(".companion-trail"))
        return;
      const rect = node!.getBoundingClientRect();
      burst(
        event.detail ? event.clientX : rect.left + rect.width / 2,
        event.detail ? event.clientY : rect.top + rect.height / 2,
      );
    };
    const hover = (event: PointerEvent) => {
      const node = target(event);
      if (
        event.pointerType === "mouse" &&
        clickable(node) &&
        !(
          event.relatedTarget instanceof Node &&
          node!.contains(event.relatedTarget)
        )
      )
        void sound.play("hover");
    };
    const customBurst = (event: Event) => {
      const point = (event as CustomEvent<{ x: number; y: number }>).detail;
      if (point && Number.isFinite(point.x) && Number.isFinite(point.y))
        burst(point.x, point.y, 16);
    };
    const success = (event: Event) => {
      if ((event as CustomEvent).detail === "success")
        burst(width - Math.min(width / 2, 220), 95, 36);
    };
    const visibility = () => {
      sound.visibility(!document.hidden);
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
        pixels = [];
        context?.clearRect(0, 0, width, height);
      }
    };
    document.addEventListener("click", click, true);
    document.addEventListener("pointerover", hover);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("resize", resize);
    window.addEventListener("minemate-burst", customBurst);
    window.addEventListener("minemate-feedback", success);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("click", click, true);
      document.removeEventListener("pointerover", hover);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("resize", resize);
      window.removeEventListener("minemate-burst", customBurst);
      window.removeEventListener("minemate-feedback", success);
    };
  }, [reduced]);
  return (
    <ExperienceContext.Provider value={{ preferences, scene, setScene }}>
      <MotionConfig reducedMotion={preferences.reduced ? "always" : "user"}>
        {children}
        <canvas ref={canvas} className="pixel-effects" aria-hidden="true" />
        {celebration && (
          <div className={"achievement-toast " + celebration} role="status">
            <Asset
              name={celebration === "success" ? "diamond" : "redstone"}
              size={38}
            />
            <span>
              <small>
                {t(celebration === "success" ? "taskComplete" : "attention")}
              </small>
              <b>
                {t(celebration === "success" ? "backToAdventure" : "error")}
              </b>
            </span>
          </div>
        )}
        {preferences.companions && (
          <Companions scene={scene} reduced={reduced} />
        )}
      </MotionConfig>
    </ExperienceContext.Provider>
  );
}
