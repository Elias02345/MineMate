import { Link, Outlet } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import {
  Trees,
  Users,
  Settings,
  Bell,
  LogOut,
  Menu,
  X,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { useI18n } from "./i18n.tsx";
import { useUser } from "./Auth.tsx";
import { mutate } from "./api.ts";
import { useRealtime } from "./hooks.tsx";
import { Asset, MineButton } from "../../../packages/ui/src/index.tsx";
import { sound } from "../../../packages/ui/src/sound.ts";
export interface Preferences {
  enabled: boolean;
  uiVolume: number;
  ambientVolume: number;
  reduced: boolean;
}
export function readPreferences(): Preferences {
  try {
    return {
      ...{ enabled: false, uiVolume: 0.3, ambientVolume: 0.1, reduced: false },
      ...(JSON.parse(
        localStorage.getItem("minemate.preferences") ?? "{}",
      ) as Partial<Preferences>),
    };
  } catch {
    return {
      enabled: false,
      uiVolume: 0.3,
      ambientVolume: 0.1,
      reduced: false,
    };
  }
}
export function savePreferences(p: Preferences) {
  localStorage.setItem("minemate.preferences", JSON.stringify(p));
  sound.configure(p);
  document.documentElement.classList.toggle("reduced-effects", p.reduced);
  window.dispatchEvent(new Event("minemate-preferences"));
}
export function Shell() {
  const { t, language, setLanguage } = useI18n(),
    user = useUser(),
    client = useQueryClient(),
    connected = useRealtime(),
    [menu, setMenu] = useState(false),
    [preferences, setPreferences] = useState(readPreferences);
  useEffect(() => {
    savePreferences(preferences);
    const update = () => setPreferences(readPreferences());
    window.addEventListener("minemate-preferences", update);
    return () => window.removeEventListener("minemate-preferences", update);
  }, []);
  const links = [
    { to: "/" as const, label: "dashboard" as const, Icon: Trees },
    {
      to: "/notifications" as const,
      label: "notifications" as const,
      Icon: Bell,
    },
    ...(user.role !== "member"
      ? [{ to: "/users" as const, label: "users" as const, Icon: Users }]
      : []),
    { to: "/settings" as const, label: "settings" as const, Icon: Settings },
  ];
  return (
    <MotionConfig reducedMotion="user">
      <div className="app-shell">
        <header className="topbar">
          <Link to="/" className="brand">
            <Asset name="grassBlock" size={36} />
            <span>
              MineMate<small>{t("tagline")}</small>
            </span>
          </Link>
          <div className="topbar-right">
            <span className={"connection " + (connected ? "live" : "")}>
              {connected ? "●" : "○"} <span>{user.username}</span>
            </span>
            <button
              className="icon-button"
              onClick={() => {
                const next = { ...preferences, enabled: !preferences.enabled };
                setPreferences(next);
                savePreferences(next);
                void sound.play("interface");
              }}
              aria-label={t("sounds")}
            >
              {preferences.enabled ? (
                <Volume2 size={20} />
              ) : (
                <VolumeX size={20} />
              )}
            </button>
            <button
              className="language-button"
              onClick={() => setLanguage(language === "en" ? "de" : "en")}
            >
              {language.toUpperCase()}
            </button>
            <button
              className="mobile-menu icon-button"
              onClick={() => setMenu(!menu)}
              aria-label={t("dashboard")}
            >
              {menu ? <X /> : <Menu />}
            </button>
          </div>
        </header>
        <aside className={"sidebar " + (menu ? "open" : "")}>
          <nav>
            {links.map(({ to, label, Icon }) => (
              <Link
                to={to}
                key={to}
                activeOptions={{ exact: to === "/" }}
                activeProps={{ className: "active" }}
                onClick={() => setMenu(false)}
              >
                <Icon size={20} />
                {t(label)}
              </Link>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <Asset name="bee" size={32} />
            <span>{t("tagline")}</span>
            <MineButton
              variant="ghost"
              onClick={() =>
                void mutate("/auth/logout").then(() =>
                  client.invalidateQueries({ queryKey: ["auth"] }),
                )
              }
            >
              <LogOut size={16} />
              {t("logout")}
            </MineButton>
            <small>MineMate 0.1.0</small>
          </div>
        </aside>
        <main className="main-content">
          <Outlet />
        </main>
        <footer className="mobile-footer">{t("tagline")}</footer>
      </div>
    </MotionConfig>
  );
}
