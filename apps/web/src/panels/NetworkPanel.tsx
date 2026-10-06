import { useI18n } from "../i18n.tsx";
import { CopyButton } from "../Dashboard.tsx";
import {
  MinePanel,
  MineBadge,
  MineNotice,
  MineButton,
  Asset,
} from "../../../../packages/ui/src/index.tsx";
import type { Server } from "../../../../packages/shared/src/index.ts";
export default function NetworkPanel({
  server: s,
  onManageAccess,
}: {
  server: Server;
  onManageAccess?: () => void;
}) {
  const { t } = useI18n(),
    endpoint = `${s.endpoint.host}:${s.port}`,
    invitation = `${s.name}\nMinecraft ${s.config.edition === "JAVA" ? "Java" : "Bedrock"} · ${s.config.version}\n${t("hostAddress")}: ${s.endpoint.host}\n${t("port")}: ${s.port}\n${t("lanHint")}`,
    target = `Host: ${s.endpoint.host}\nPort: ${s.port}\nProtocol: ${s.endpoint.protocol}`;
  return (
    <div className="network-layout">
      <MinePanel>
        <Asset name="redstone" size={44} />
        <h2>{t("networkTitle")}</h2>
        <h3>{t("lanTitle")}</h3>
        <p>{t("lanHint")}</p>
        <div className="connection-target">
          <code>{endpoint}</code>
          <CopyButton value={endpoint} />
        </div>
        <MineBadge tone={s.state === "RUNNING" ? "grass" : "stone"}>
          {t(s.state)}
        </MineBadge>
        <MineBadge>
          {s.config.edition === "JAVA" ? "Java" : "Bedrock"} ·{" "}
          {s.endpoint.protocol}
        </MineBadge>
        <h3>{t("inviteText")}</h3>
        <textarea
          className="share-invitation"
          aria-label={t("inviteText")}
          value={invitation}
          rows={6}
          readOnly
        />
        <CopyButton value={invitation} label={t("copyInvitation")} />
        {onManageAccess && (
          <>
            <p>{t("shareAccessHint")}</p>
            <MineButton variant="secondary" onClick={onManageAccess}>
              {t("managementAccess")}
            </MineButton>
          </>
        )}
      </MinePanel>
      <MinePanel className="cloudgate-panel">
        <Asset name="portal" size={50} />
        <span className="eyebrow">CloudGate</span>
        <h2>{t("cloudgateTitle")}</h2>
        <p>{t("cloudgateBody")}</p>
        <div className="redstone-route">
          <Asset name="grassBlock" />
          <i />
          <Asset name="redstone" />
          <i />
          <Asset name="portal" />
        </div>
        <div className="cloudgate-target">
          <div>
            <span>{t("hostAddress")}</span>
            <code>{s.endpoint.host}</code>
          </div>
          <div>
            <span>{t("port")}</span>
            <code>{s.port}</code>
          </div>
          <div>
            <span>{t("protocol")}</span>
            <code>{s.endpoint.protocol}</code>
          </div>
        </div>
        <div className="button-row">
          <b>{t("cloudgateAction")}</b>
          <CopyButton value={target} />
        </div>
        {s.config.edition === "BEDROCK" && (
          <MineNotice>{t("bedrockNote")}</MineNotice>
        )}
      </MinePanel>
    </div>
  );
}
