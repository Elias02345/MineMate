import type {
  ReactNode,
  ButtonHTMLAttributes,
  InputHTMLAttributes,
} from "react";
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
      {...props}
      onClick={(e) => {
        void sound.play("interface");
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
      <Asset name={icon} size={70} />
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
        <Asset name="grassBlock" size={32} />
      </div>
      <span>{message}</span>
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
  return (
    <div className="mine-tabs" role="tablist">
      {items.map((item) => (
        <button
          key={item.id}
          role="tab"
          aria-selected={active === item.id}
          className={active === item.id ? "active" : ""}
          onClick={() => onChange(item.id)}
        >
          {item.label}
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
