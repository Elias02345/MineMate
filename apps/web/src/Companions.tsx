import { useEffect, useRef, useState } from "react";
import { X, Pause, Play, Sparkles } from "lucide-react";
import {
  Character,
  type CharacterKind,
} from "../../../packages/ui/src/characters.tsx";
import { Asset } from "../../../packages/ui/src/index.tsx";
import {
  readPreferences,
  savePreferences,
} from "../../../packages/ui/src/preferences.ts";
import { sound } from "../../../packages/ui/src/sound.ts";
import { useI18n, type TranslationKey } from "./i18n.tsx";

const cast: CharacterKind[] = ["creeper", "alex", "pig", "bee"];
const labels: Record<CharacterKind, TranslationKey> = {
  creeper: "creeperFriend",
  alex: "alexFriend",
  pig: "pigFriend",
  bee: "beeFriend",
};
const areas: Record<
  string,
  {
    message: TranslationKey;
    prop: "chest" | "portal" | "book" | "pickaxe" | "redstone" | "grassBlock";
  }
> = {
  settings: { message: "companionWorkshop", prop: "pickaxe" },
  preferences: { message: "companionWorkshop", prop: "pickaxe" },
  backups: { message: "companionBackups", prop: "chest" },
  network: { message: "companionPortal", prop: "portal" },
  console: { message: "companionConsole", prop: "redstone" },
  content: { message: "companionInventory", prop: "chest" },
  files: { message: "companionBook", prop: "book" },
  updates: { message: "companionWorkshop", prop: "pickaxe" },
  users: { message: "companionFriends", prop: "grassBlock" },
  welcome: { message: "companionWelcome", prop: "grassBlock" },
};
const initial = [12, 34, 58, 77];
const lanes = [
  [4, 19],
  [25, 41],
  [47, 63],
  [68, 79],
] as const;
interface Actor {
  x: number;
  direction: number;
  walking: boolean;
}
export function Companions({
  scene,
  reduced,
}: {
  scene: string;
  reduced: boolean;
}) {
  const { t } = useI18n(),
    [actors, setActors] = useState<Actor[]>(() =>
      initial.map((x) => ({ x, direction: 1, walking: false })),
    ),
    [reaction, setReaction] = useState<number | null>(null),
    [party, setParty] = useState(false),
    [menu, setMenu] = useState(false),
    [paused, setPaused] = useState(false),
    [held, setHeld] = useState<number | null>(null),
    [focused, setFocused] = useState<number | null>(null),
    [look, setLook] = useState(0),
    trail = useRef<HTMLDivElement>(null),
    drag = useRef<{ index: number; start: number; moved: boolean } | null>(
      null,
    ),
    skipClick = useRef(false),
    timers = useRef<ReturnType<typeof setTimeout>[]>([]),
    area = areas[scene] ?? {
      message: "companionOverworld" as TranslationKey,
      prop: "grassBlock" as const,
    };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    if (reduced || paused || held !== null || focused !== null || menu) return;
    let rest: ReturnType<typeof setTimeout>;
    const wander = () => {
      if (document.hidden) return;
      setActors((current) =>
        current.map((actor, i) => {
          const x = Math.max(
            lanes[i]![0],
            Math.min(
              lanes[i]![1],
              actor.x + (Math.random() - 0.5) * (i === 3 ? 34 : 24),
            ),
          );
          return { x, direction: x >= actor.x ? 1 : -1, walking: true };
        }),
      );
      clearTimeout(rest);
      rest = setTimeout(
        () =>
          setActors((current) =>
            current.map((actor) => ({ ...actor, walking: false })),
          ),
        2800,
      );
    };
    const start = setTimeout(wander, 1200),
      interval = setInterval(wander, 6500);
    const visibility = () => {
      if (document.hidden)
        setActors((current) =>
          current.map((actor) => ({ ...actor, walking: false })),
        );
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearTimeout(start);
      clearTimeout(rest);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [reduced, paused, held, focused, menu, scene]);
  useEffect(() => {
    const completed = (event: Event) => {
      if ((event as CustomEvent).detail !== "success") return;
      timers.current.forEach(clearTimeout);
      setReaction(null);
      setParty(true);
      const timer = setTimeout(() => setParty(false), 2400);
      timers.current = [timer];
    };
    window.addEventListener("minemate-feedback", completed);
    return () => window.removeEventListener("minemate-feedback", completed);
  }, []);
  function pet(index: number, element: HTMLElement) {
    setReaction(index);
    void sound.play(cast[index] === "creeper" ? "portal" : "pet");
    const rect = element.getBoundingClientRect();
    window.dispatchEvent(
      new CustomEvent("minemate-burst", {
        detail: { x: rect.left + rect.width / 2, y: rect.top + 20 },
      }),
    );
    timers.current.forEach(clearTimeout);
    timers.current = [
      setTimeout(() => {
        setReaction(null);
        setParty(false);
      }, 2800),
    ];
  }
  function move(index: number, x: number) {
    setActors((current) =>
      current.map((actor, i) =>
        i === index
          ? {
              x: Math.max(4, Math.min(82, x)),
              direction: x >= actor.x ? 1 : -1,
              walking: false,
            }
          : actor,
      ),
    );
  }
  return (
    <div
      ref={trail}
      className={
        "companion-trail " +
        (scene === "welcome" ? "welcome-trail" : "") +
        (paused ? " paused" : "") +
        (reduced ? " still" : "")
      }
      data-scene={scene}
      aria-label={t("companions")}
      onPointerMove={(event) => {
        if (!drag.current && event.pointerType === "mouse")
          setLook(event.clientX > innerWidth / 2 ? 1 : -1);
      }}
    >
      <div className="companion-ground" aria-hidden="true" />
      <div className={"companion-prop prop-" + area.prop} aria-hidden="true">
        <Asset name={area.prop} size={34} />
      </div>
      <span className="sr-only" id="companion-instructions">
        {t("companionKeyboard")}
      </span>
      {cast.map((kind, index) => (
        <div
          key={kind}
          className={
            "companion-position buddy-" +
            kind +
            (actors[index]!.walking ? " walking" : "") +
            (held === index ? " held" : "") +
            (reaction === index ? " delighted" : "") +
            (party ? " celebrating" : "")
          }
          style={{ left: actors[index]!.x + "%" }}
        >
          {reaction === index && (
            <span
              className={
                "companion-speech " +
                (actors[index]!.x < 20
                  ? "edge-left"
                  : actors[index]!.x > 68
                    ? "edge-right"
                    : "")
              }
              role="status"
            >
              {t(area.message)}
              <i aria-hidden="true">♥</i>
            </span>
          )}
          <button
            className="companion-character"
            data-kind={kind}
            data-silent
            aria-label={t("petCompanion") + " " + t(labels[kind])}
            aria-describedby="companion-instructions"
            onFocus={(event) => {
              const bounds = trail.current!.getBoundingClientRect();
              const position =
                event.currentTarget.parentElement!.getBoundingClientRect();
              move(index, ((position.left - bounds.left) / bounds.width) * 100);
              setFocused(index);
            }}
            onBlur={() => setFocused(null)}
            style={
              {
                "--facing": actors[index]!.direction,
                "--look": look,
              } as React.CSSProperties
            }
            onClick={(event) => {
              if (skipClick.current) {
                skipClick.current = false;
                return;
              }
              pet(index, event.currentTarget);
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              const bounds = trail.current!.getBoundingClientRect();
              const position =
                event.currentTarget.parentElement!.getBoundingClientRect();
              move(index, ((position.left - bounds.left) / bounds.width) * 100);
              drag.current = { index, start: event.clientX, moved: false };
              setHeld(index);
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const current = drag.current;
              if (!current || current.index !== index) return;
              if (Math.abs(event.clientX - current.start) > 5)
                current.moved = true;
              if (current.moved) {
                const rect = trail.current!.getBoundingClientRect();
                move(
                  index,
                  ((event.clientX - rect.left - 28) / rect.width) * 100,
                );
              }
            }}
            onPointerUp={(event) => {
              if (drag.current?.moved) {
                skipClick.current = true;
                pet(index, event.currentTarget);
              }
              drag.current = null;
              setHeld(null);
            }}
            onPointerCancel={() => {
              drag.current = null;
              setHeld(null);
              skipClick.current = false;
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                move(
                  index,
                  actors[index]!.x + (event.key === "ArrowRight" ? 5 : -5),
                );
              }
            }}
          >
            <Character kind={kind} />
            <span className="companion-name">{t(labels[kind])}</span>
            {(reaction === index || party) && (
              <span className="companion-hearts" aria-hidden="true">
                ♥ <i>✦</i> ♥
              </span>
            )}
          </button>
        </div>
      ))}
      <div className="companion-controls">
        <button
          className="companion-menu-button"
          onClick={() => setMenu(!menu)}
          aria-label={t("companionControls")}
          aria-expanded={menu}
          aria-controls="companion-controls-menu"
          data-sound="wood"
        >
          <Sparkles size={16} />
          <span>{t("companions")}</span>
        </button>
        {menu && (
          <div className="companion-menu" id="companion-controls-menu">
            <b>{t("companions")}</b>
            <p>{t("companionKeyboard")}</p>
            <button
              onClick={() => {
                setPaused(!paused);
                setActors((current) =>
                  current.map((actor) => ({ ...actor, walking: false })),
                );
              }}
              aria-pressed={paused}
            >
              {paused ? <Play size={15} /> : <Pause size={15} />}
              {t(paused ? "resumeFriends" : "pauseFriends")}
            </button>
            <button
              onClick={() => {
                timers.current.forEach(clearTimeout);
                setReaction(null);
                setParty(true);
                void sound.play("success");
                timers.current = [setTimeout(() => setParty(false), 2400)];
              }}
            >
              <Sparkles size={15} />
              {t("playFriends")}
            </button>
            <button
              onClick={() =>
                savePreferences({ ...readPreferences(), companions: false })
              }
            >
              <X size={15} />
              {t("hideFriends")}
            </button>
            <button onClick={() => setMenu(false)}>{t("close")}</button>
          </div>
        )}
      </div>
    </div>
  );
}
