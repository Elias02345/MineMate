import { Link, Outlet } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { LogOut, Menu, X, Volume2, VolumeX } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "./i18n.tsx";
import { useUser } from "./Auth.tsx";
import { mutate } from "./api.ts";
import { useRealtime } from "./hooks.tsx";
import { Asset, MineButton } from "../../../packages/ui/src/index.tsx";
import { sound } from "../../../packages/ui/src/sound.ts";
import { savePreferences } from "../../../packages/ui/src/preferences.ts";
import { useExperience } from "./Experience.tsx";
import type { AssetName } from "../../../packages/ui/src/assets.tsx";
export function Shell() {
  const { t, language, setLanguage } = useI18n(),
    user = useUser(),
    client = useQueryClient(),
    connected = useRealtime(),
    [menu, setMenu] = useState(false),
    { preferences } = useExperience();
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  const links = [
    {
      to: "/" as const,
      label: "dashboard" as const,
      icon: "grassBlock" as AssetName,
    },
    {
      to: "/notifications" as const,
      label: "notifications" as const,
      icon: "redstone" as AssetName,
    },
    ...(user.role !== "member"
      ? [
          {
            to: "/users" as const,
            label: "users" as const,
            icon: "creeper" as AssetName,
          },
        ]
      : []),
    {
      to: "/settings" as const,
      label: "settings" as const,
      icon: "pickaxe" as AssetName,
    },
  ];
  return (
    <>
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
                savePreferences(next);
                void sound.play("interface");
              }}
              aria-label={t("sounds")}
              aria-pressed={preferences.enabled}
              title={t(preferences.enabled ? "soundOn" : "soundOff")}
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
          <div className="sidebar-label">
            <Asset name="book" size={22} />
            {t("adventureJournal")}
          </div>
          <nav>
            {links.map(({ to, label, icon }, index) => (
              <Link
                to={to}
                key={to}
                activeOptions={{ exact: to === "/" }}
                activeProps={{ className: "active" }}
                onClick={() => setMenu(false)}
              >
                <span className="nav-item-slot">
                  <Asset name={icon} size={28} />
                </span>
                <span>{t(label)}</span>
                <small className="nav-number" aria-hidden="true">
                  0{index + 1}
                </small>
              </Link>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-camp" aria-hidden="true">
              <Asset name="grassBlock" size={64} />
              <Asset name="bee" size={30} />
              <i />
              <i />
              <i />
            </div>
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
            <small>MineMate 0.3.1</small>
          </div>
        </aside>
        <main className="main-content">
          <Outlet />
        </main>
        <footer className="mobile-footer">{t("tagline")}</footer>
      </div>
    </>
  );
}
