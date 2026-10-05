import {
  useState,
  createContext,
  useContext,
  type FormEvent,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { api, mutate, setCsrf } from "./api.ts";
import { useI18n } from "./i18n.tsx";
import {
  MineButton,
  MineInput,
  MinePanel,
  MineProgress,
  Landscape,
  Asset,
} from "../../../packages/ui/src/index.tsx";
import { ErrorNotice } from "./hooks.tsx";
import { useExperience, useScene } from "./Experience.tsx";
import { savePreferences } from "../../../packages/ui/src/preferences.ts";
import { sound } from "../../../packages/ui/src/sound.ts";
import { Volume2, VolumeX } from "lucide-react";
import type { User } from "../../../packages/shared/src/index.ts";
const authContext = createContext<User>(null!);
export const useUser = () => useContext(authContext);
export function AuthGate({ children }: { children: ReactNode }) {
  const { t, language, setLanguage } = useI18n(),
    { preferences } = useExperience(),
    client = useQueryClient();
  const status = useQuery({
    queryKey: ["auth"],
    queryFn: async () => {
      const s = await api<{
        setupRequired: boolean;
        user: User | null;
        csrf: string | null;
      }>("/auth/status");
      setCsrf(s.csrf);
      return s;
    },
    retry: false,
  });
  useScene(status.data?.user ? null : "welcome");
  if (status.isPending)
    return (
      <div className="full-screen">
        <MineProgress message={t("loading")} />
      </div>
    );
  if (status.error)
    return (
      <div className="full-screen">
        <MinePanel>
          <ErrorNotice error={status.error} />
          <MineButton onClick={() => void status.refetch()}>
            {t("retry")}
          </MineButton>
        </MinePanel>
      </div>
    );
  if (status.data.user)
    return (
      <authContext.Provider value={status.data.user}>
        {children}
      </authContext.Provider>
    );
  return (
    <div className="auth-world">
      <Landscape />
      <div className="auth-language">
        <button
          aria-label={t("sounds")}
          aria-pressed={preferences.enabled}
          onClick={() => {
            savePreferences({ ...preferences, enabled: !preferences.enabled });
            void sound.play("craft");
          }}
        >
          {preferences.enabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          {t(preferences.enabled ? "soundOn" : "soundOff")}
        </button>
        <button onClick={() => setLanguage(language === "en" ? "de" : "en")}>
          {language === "en" ? "Deutsch" : "English"}
        </button>
      </div>
      <div className="auth-card">
        <div className="brand large">
          <Asset name="grassBlock" size={44} />
          <span>
            MineMate<small>{t("tagline")}</small>
          </span>
        </div>
        <MinePanel>
          <span className="eyebrow auth-eyebrow">
            <Asset name="diamond" size={19} />
            {t("readyToCraft")}
          </span>
          <h1>{t(status.data.setupRequired ? "welcome" : "login")}</h1>
          <p>{t(status.data.setupRequired ? "welcomeBody" : "loginBody")}</p>
          <AuthForm
            setup={status.data.setupRequired}
            onSuccess={() =>
              void client.invalidateQueries({ queryKey: ["auth"] })
            }
          />
        </MinePanel>
        <small className="auth-foot">{t("tagline")}</small>
      </div>
    </div>
  );
}
function AuthForm({
  setup,
  onSuccess,
}: {
  setup: boolean;
  onSuccess: () => void;
}) {
  const { t } = useI18n(),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState("");
  const login = useMutation({
    mutationFn: () =>
      mutate<{ user: User; csrf: string }>(
        setup ? "/auth/bootstrap" : "/auth/login",
        { username, password },
      ),
    onSuccess: (data) => {
      setCsrf(data.csrf);
      onSuccess();
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    login.mutate();
  }
  return (
    <form onSubmit={submit}>
      <h3>{t(setup ? "bootstrap" : "signIn")}</h3>
      {setup && <p className="muted">{t("bootstrapHint")}</p>}
      <MineInput
        label={t("username")}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        autoComplete="username"
        minLength={3}
        maxLength={48}
        required
      />
      <MineInput
        label={t("password")}
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete={setup ? "new-password" : "current-password"}
        minLength={12}
        maxLength={256}
        required
      />
      <ErrorNotice error={login.error} />
      <MineButton type="submit" disabled={login.isPending} className="wide">
        {t(login.isPending ? "loading" : setup ? "begin" : "signIn")}
      </MineButton>
    </form>
  );
}
