import { useI18n } from "../i18n.tsx";
import { CopyButton } from "../Dashboard.tsx";
import {
  MinePanel,
  MineBadge,
  MineNotice,
  Asset,
} from "../../../../packages/ui/src/index.tsx";
import type { Server } from "../../../../packages/shared/src/index.ts";
export default function NetworkPanel({ server: s }: { server: Server }) {
  const { t } = useI18n(),
    endpoint = `${s.endpoint.host}:${s.port}`,
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
