import type {
  ReactNode,
  ButtonHTMLAttributes,
  InputHTMLAttributes,
} from "react";
import { useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Asset, type AssetName } from "./assets.tsx";
import { sound } from "./sound.ts";
export { Asset, Landscape } from "./assets.tsx";
export function MineButton({
  children,
  variant = "primary",
  className = "",
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  return (
    <button
      type="button"
      className={`mine-button ${variant} ${className}`}
      data-sound={variant === "danger" ? "stone" : "wood"}
      {...props}
      onClick={(e) => {
        onClick?.(e);
      }}
    >
      {children}
    </button>
  );
}
export function MinePanel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={"mine-panel " + className}>{children}</section>;
}
export function MineBadge({
  children,
  tone = "stone",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={"mine-badge " + tone}>{children}</span>;
}
export function MineInput({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input {...props} />
    </label>
  );
}
export function MineToggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="toggle-row">
      <span>
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
export function MineModal({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (open) void sound.play("chest");
  }, [open]);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="mine-modal">
          <div className="modal-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <MineButton
                variant="ghost"
                aria-label={
                  document.documentElement.lang === "de" ? "Schließen" : "Close"
                }
              >
                <X size={20} />
              </MineButton>
            </Dialog.Close>
          </div>
          {description ? (
            <Dialog.Description>{description}</Dialog.Description>
          ) : (
            <Dialog.Description className="sr-only">{title}</Dialog.Description>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function MineEmpty({
  icon = "grassBlock",
  title,
  description,
  children,
}: {
  icon?: AssetName;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-diorama" aria-hidden="true">
        <Asset name="diamond" size={24} className="empty-orbit orbit-one" />
        <Asset name={icon} size={88} className="empty-main" />
        <Asset name="bee" size={32} className="empty-orbit orbit-two" />
        <Asset name="pickaxe" size={26} className="empty-orbit orbit-three" />
        <i className="diorama-island" />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function MineProgress({ message }: { message: string }) {
  return (
    <div className="crafting-progress" role="status">
      <div className="crafting-cube">
        <Asset name="pickaxe" size={36} />
      </div>
      <span>{message}</span>
      <div className="crafting-meter" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}
export function MineNotice({
  children,
  tone = "warning",
}: {
  children: ReactNode;
  tone?: "warning" | "error" | "success";
}) {
  return (
    <div
      className={"notice " + tone}
      role={tone === "error" ? "alert" : "status"}
    >
      <Asset name={tone === "success" ? "diamond" : "redstone"} size={24} />
      <div>{children}</div>
    </div>
  );
}
export function MineTabs({
  items,
  active,
  onChange,
}: {
  items: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}) {
  const icons: Record<string, AssetName> = {
    overview: "grassBlock",
    console: "redstone",
    settings: "pickaxe",
    players: "creeper",
    worlds: "dirtBlock",
    content: "diamond",
    backups: "chest",
    updates: "book",
    network: "portal",
    files: "book",
    permissions: "enderPearl",
  };
  return (
    <div className="mine-tabs" role="tablist">
      {items.map((item, index) => (
        <button
          key={item.id}
          role="tab"
          aria-selected={active === item.id}
          tabIndex={active === item.id ? 0 : -1}
          className={active === item.id ? "active" : ""}
          onClick={() => onChange(item.id)}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : (index +
                      (event.key === "ArrowRight" ? 1 : -1) +
                      items.length) %
                    items.length;
            onChange(items[next]!.id);
            event.currentTarget.parentElement
              ?.querySelectorAll<HTMLButtonElement>("button")
              [next]?.focus();
            void sound.play("wood");
          }}
          data-sound={
            item.id === "network"
              ? "portal"
              : item.id === "backups"
                ? "chest"
                : "wood"
          }
        >
          <Asset name={icons[item.id] ?? "grassBlock"} size={24} />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
export function MineBook({ children }: { children: ReactNode }) {
  return <MinePanel className="mine-book">{children}</MinePanel>;
}
export function MineChest({ children }: { children: ReactNode }) {
  return (
    <MinePanel className="mine-chest">
      <Asset name="chest" size={40} />
      {children}
    </MinePanel>
  );
}
export function MineItemSlot({ children }: { children: ReactNode }) {
  return <div className="item-slot">{children}</div>;
}
