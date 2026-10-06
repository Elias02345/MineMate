import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, mutate } from "../api.ts";
import { useI18n, type TranslationKey } from "../i18n.tsx";
import { ErrorNotice } from "../hooks.tsx";
import {
  MinePanel,
  MineButton,
  MineInput,
  MineNotice,
  Asset,
} from "../../../../packages/ui/src/index.tsx";
import { feedback } from "../../../../packages/ui/src/preferences.ts";
import type { Server, Event } from "../../../../packages/shared/src/index.ts";
export default function ConsolePanel({ server: s }: { server: Server }) {
  const { t } = useI18n(),
    client = useQueryClient(),
    [lines, setLines] = useState<string[]>([]),
    [search, setSearch] = useState(""),
    [paused, setPaused] = useState(false),
    [command, setCommand] = useState(""),
    [announcement, setAnnouncement] = useState(""),
    [difficulty, setDifficulty] = useState("easy"),
    [scroll, setScroll] = useState(0),
    [history, setHistory] = useState<string[]>([]),
    [historyIndex, setHistoryIndex] = useState(-1),
    box = useRef<HTMLDivElement>(null);
  const q = useQuery({
    queryKey: ["console", s.id],
    queryFn: () => api<{ logs: string }>(`/servers/${s.id}/console`),
  });
  useEffect(() => {
    if (q.data) setLines(q.data.logs.split("\n").filter(Boolean).slice(-2000));
  }, [q.data]);
  useEffect(() => {
    function listener(event: globalThis.Event) {
      const e = (event as CustomEvent<Event>).detail;
      if (e.type === "server.log" && e.serverId === s.id)
        setLines((old) =>
          [...old, (e.data as { line: string }).line].slice(-2000),
        );
    }
    window.addEventListener("minemate-event", listener);
    return () => window.removeEventListener("minemate-event", listener);
  }, [s.id]);
  useEffect(() => {
    if (!paused && box.current)
      box.current.scrollTop = box.current.scrollHeight;
  }, [lines, paused]);
  const action = useMutation({
    mutationFn: (value: string) =>
      mutate<{ output: string }>(`/servers/${s.id}/console`, {
        command: value,
      }),
    onSuccess: (result, value) => {
      feedback("success");
      setLines((old) =>
        [...old, `> ${value}`, ...result.output.split(/\r?\n/)].slice(-2000),
      );
      setHistory((old) =>
        [value, ...old.filter((entry) => entry !== value)].slice(0, 100),
      );
      setHistoryIndex(-1);
      setCommand((current) =>
        current.trim().replace(/^\/+/, "") === value ? "" : current,
      );
      void client.invalidateQueries({ queryKey: ["players", s.id] });
      void client.invalidateQueries({ queryKey: ["settings", s.id] });
    },
    onError: () => feedback("warning"),
  });
  const canSend = s.state === "RUNNING" && !action.isPending;
  function send(value: string) {
    const normalized = value.trim().replace(/^\/+/, "");
    if (canSend && normalized) action.mutate(normalized);
  }
  const quickCommands: { label: TranslationKey; command: string }[] = [
    { label: "commandList", command: "list" },
    ...(s.config.edition === "JAVA"
      ? [{ label: "commandSave" as const, command: "save-all flush" }]
      : []),
    { label: "commandDay", command: "time set day" },
    { label: "commandNight", command: "time set night" },
    { label: "commandClearWeather", command: "weather clear" },
    { label: "commandRain", command: "weather rain" },
  ];
  const filtered = lines.filter((line) =>
      line.toLowerCase().includes(search.toLowerCase()),
    ),
    start = Math.max(
      0,
      Math.min(filtered.length - 1, Math.floor(scroll / 24)) - 5,
    ),
    visible = filtered.slice(start, start + 30);
  return (
    <MinePanel className="console-panel">
      <div className="section-heading">
        <h2>
          <Asset name="redstone" size={26} />
          {t("console")}
        </h2>
        <div className="button-row">
          <MineButton variant="ghost" onClick={() => setPaused(!paused)}>
            {t(paused ? "resume" : "pause")}
          </MineButton>
          <MineButton variant="ghost" onClick={() => setLines([])}>
            {t("clear")}
          </MineButton>
        </div>
      </div>
      <MineInput
        label={t("logSearch")}
        type="search"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setScroll(0);
          if (box.current) box.current.scrollTop = 0;
        }}
      />
      <div
        className="console-window"
        ref={box}
        onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
        role="log"
        aria-label={t("console")}
        aria-live="off"
      >
        <div
          style={{
            height: filtered.length * 24,
            minHeight: 400,
            position: "relative",
          }}
        >
          {filtered.length ? (
            visible.map((line, i) => (
              <div
                className={
                  "console-line " +
                  (/error|exception|fatal/i.test(line)
                    ? "log-error"
                    : /warn/i.test(line)
                      ? "log-warning"
                      : "")
                }
                key={start + i}
                style={{
                  position: "absolute",
                  top: (start + i) * 24,
                  height: 24,
                }}
              >
                {line
                  .replace(/\x1b\[[0-9;]*m/g, "")
                  .replace(/§[0-9a-fk-or]/gi, "")}
              </div>
            ))
          ) : (
            <p className="console-empty">{t("consoleEmpty")}</p>
          )}
        </div>
      </div>
      <form
        className="command-form"
        onSubmit={(e) => {
          e.preventDefault();
          send(command);
        }}
      >
        <span className="command-prompt">/</span>
        <input
          aria-label={t("command")}
          value={command}
          placeholder={t("command")}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") {
              e.preventDefault();
              const index = Math.min(history.length - 1, historyIndex + 1);
              setHistoryIndex(index);
              setCommand(history[index] ?? "");
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              const index = Math.max(-1, historyIndex - 1);
              setHistoryIndex(index);
              setCommand(history[index] ?? "");
            }
          }}
        />
        <MineButton
          type="submit"
          disabled={s.state !== "RUNNING" || action.isPending}
        >
          {t("send")}
        </MineButton>
      </form>
      {s.state !== "RUNNING" && <MineNotice>{t("consoleOffline")}</MineNotice>}
      <section className="console-shortcuts" aria-label={t("quickCommands")}>
        <h3>{t("quickCommands")}</h3>
        <div className="button-row">
          {quickCommands.map((item) => (
            <MineButton
              key={item.command}
              variant="secondary"
              disabled={!canSend}
              onClick={() => send(item.command)}
              title={item.command}
            >
              {t(item.label)}
            </MineButton>
          ))}
        </div>
        <form
          className="console-action-form"
          onSubmit={(event) => {
            event.preventDefault();
            send(`difficulty ${difficulty}`);
          }}
        >
          <label className="field">
            <span>{t("difficulty")}</span>
            <select
              value={difficulty}
              onChange={(event) => setDifficulty(event.target.value)}
            >
              {["peaceful", "easy", "normal", "hard"].map((value) => (
                <option key={value} value={value}>
                  {t(value as TranslationKey)}
                </option>
              ))}
            </select>
          </label>
          <MineButton type="submit" variant="secondary" disabled={!canSend}>
            {t("applyDifficulty")}
          </MineButton>
        </form>
        <form
          className="console-action-form"
          onSubmit={(event) => {
            event.preventDefault();
            send(`say ${announcement.trim()}`);
          }}
        >
          <MineInput
            label={t("announcement")}
            value={announcement}
            maxLength={2000}
            onChange={(event) => setAnnouncement(event.target.value)}
          />
          <MineButton
            type="submit"
            variant="secondary"
            disabled={!canSend || !announcement.trim()}
          >
            {t("broadcast")}
          </MineButton>
        </form>
      </section>
      <p className="muted">{t("technicalOnly")}</p>
      <ErrorNotice error={q.error ?? action.error} />
    </MinePanel>
  );
}
