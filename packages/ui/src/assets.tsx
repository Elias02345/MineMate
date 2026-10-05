import { useEffect, useRef, type CSSProperties } from "react";
export type AssetName =
  | "grassBlock"
  | "dirtBlock"
  | "chest"
  | "diamond"
  | "redstone"
  | "enderPearl"
  | "portal"
  | "creeper"
  | "bee"
  | "cloud"
  | "sun"
  | "moon"
  | "book"
  | "pickaxe"
  | "compass"
  | "jukebox"
  | "heart"
  | "torch"
  | "mushroom"
  | "sword";
const art: Record<AssetName, string> = {
  compass:
    '<path fill="#273f42" d="M8 2h16v4h5v22H3V6h5z"/><path fill="#c7d4c3" d="M8 5h16v4h3v14h-4v4H9v-4H5V9h3z"/><path fill="#7b9290" d="M9 8h14v15H9z"/><path fill="#e66c52" d="m18 8 2 9-8 5 2-9z"/><path fill="#f8eaca" d="m14 13 6 4-8 5z"/>',
  jukebox:
    '<path fill="#573b2c" d="M2 5h28v25H2z"/><path fill="#c29252" d="M4 7h24v7H4z"/><path fill="#352f2c" d="M9 9h14v3H9zM6 17h20v10H6z"/><path fill="#936343" d="M8 19h3v6H8zm6 0h3v6h-3zm6 0h3v6h-3z"/><path fill="#e6c477" d="M4 7h24v2H4z"/>',
  heart:
    '<path fill="#652f37" d="M3 7h11v4h4V7h11v15h-5v5h-5v4h-6v-4H8v-5H3z"/><path fill="#e56868" d="M5 9h7v4h8V9h7v11h-5v5h-6v4h-1v-4h-5v-5H5z"/><path fill="#ffb2a0" d="M7 10h5v4H7z"/>',
  torch:
    '<path fill="#65492e" d="M13 12h7v20h-7z"/><path fill="#b08448" d="M13 12h3v20h-3z"/><path fill="#e58635" d="M10 5h13v10H10z"/><path fill="#f6c852" d="M12 2h9v10h-9z"/><path fill="#fff3ad" d="M14 3h5v6h-5z"/>',
  mushroom:
    '<path fill="#7f352e" d="M8 3h16v4h5v10H3V7h5z"/><path fill="#e0764e" d="M8 3h16v4h3v8H5V7h3z"/><path fill="#fff0ce" d="M8 5h5v4H8zm12 3h5v5h-5zM12 16h8v12h-8z"/><path fill="#c5a87b" d="M17 17h3v11h-3z"/>',
  sword:
    '<path fill="#1b615d" d="M23 1h8v8L13 27l-8-8z"/><path fill="#8de2cf" d="M24 3h5v5L13 24l-5-5z"/><path fill="#e3fff0" d="M24 3h3L10 20l-2-2z"/><path fill="#87714a" d="M4 15h4v4h5v4h4v4h-7v-4H6v-4H4zM1 27l6-6 4 4-6 6H1z"/>',
  grassBlock:
    '<path fill="#745037" d="M3 11h26v18H3z"/><path fill="#9c6b40" d="M3 11h6v4h5v-4h8v8h7v6h-8v-4h-8v8H3z"/><path fill="#67a844" d="M3 3h26v10H3z"/><path fill="#95c956" d="M3 3h8v4h8V3h10v4h-5v4H9V7H3z"/><path fill="#3f7f34" d="M3 11h26v4h-5v4h-4v-4h-8v3H7v-3H3z"/>',
  dirtBlock:
    '<path fill="#795339" d="M3 3h26v26H3z"/><path fill="#ad7951" d="M3 5h8v4H3zm12 6h10v5H15zm-8 9h8v5H7z"/><path fill="#554136" d="M3 13h7v4H3zm17 10h9v6h-9z"/>',
  chest:
    '<path fill="#59371f" d="M2 8h28v21H2z"/><path fill="#db9b3c" d="M4 10h24v7H4zm0 10h24v7H4z"/><path fill="#f4c76b" d="M4 10h24v3H4zm0 10h3v7H4z"/><path fill="#3b302a" d="M2 17h28v3H2z"/><path fill="#e8dfb1" d="M13 15h6v9h-6z"/><path fill="#817753" d="M15 18h2v4h-2z"/>',
  diamond:
    '<path fill="#135e73" d="M8 3h16v4h5v9h-5v5h-5v6h-6v-6H8v-5H3V7h5z"/><path fill="#5ae1d9" d="M8 5h16v4h3v5h-6v6h-5v5h-2v-5H9v-6H5V9h3z"/><path fill="#c1fff0" d="M9 5h7v4H9zm-4 5h8v4H5z"/>',
  redstone:
    '<path fill="#852e32" d="M10 5h12v5h6v13h-8v5H9v-6H4V12h6z"/><path fill="#e65a48" d="M10 7h9v6h7v7H14v5H9v-7H6v-4h7z"/>',
  enderPearl:
    '<path fill="#203d47" d="M10 3h12v4h5v5h3v9h-5v5h-5v4H9v-4H4v-5H1v-9h4V7h5z"/><path fill="#3a9486" d="M10 6h10v4h6v10h-6v6H9v-6H5V11h5z"/><path fill="#8ee0bd" d="M10 7h9v4h-9zm-4 5h4v7H6z"/>',
  portal:
    '<path fill="#302b46" d="M5 1h22v30H5z"/><path fill="#8c4ac0" d="M9 5h14v22H9z"/><path fill="#c178e1" d="M9 5h5v6h9v5h-5v6h-9zm9 19h5v3h-5z"/>',
  creeper:
    '<path fill="#5c9b49" d="M5 3h22v25H5z"/><path fill="#8ac45b" d="M5 3h8v8H5zm15 0h7v5h-7zm-7 14h7v11h-7z"/><path fill="#25352b" d="M8 10h6v6H8zm11 0h6v6h-6zm-5 6h5v4h-5zm-4 3h13v7h-4v-4h-5v4h-4z"/>',
  bee: '<path fill="#d6ecf2" d="M5 3h8v9H5zm15 0h8v9h-8z"/><path fill="#efc341" d="M3 11h26v13H3z"/><path fill="#6d4b2b" d="M9 11h4v13H9zm9 0h4v13h-4z"/><path fill="#202c2c" d="M25 13h3v4h-3z"/>',
  cloud: '<path fill="#fff8df" d="M1 13h6V7h12v4h7v6h5v6H1z"/>',
  sun: '<path fill="#f5c759" d="M8 8h16v16H8zM13 1h6v4h-6zm0 26h6v4h-6zM1 13h4v6H1zm26 0h4v6h-4z"/><path fill="#fff0ad" d="M10 10h8v6h-8z"/>',
  moon: '<path fill="#e4eadd" d="M8 3h9v5h-4v8h5v5h9v5H12v-4H6v-7H3V8h5z"/>',
  book: '<path fill="#87533c" d="M3 5h26v25H3z"/><path fill="#f2e2b0" d="M5 3h21v24H5z"/><path fill="#c9b579" d="M8 7h15v2H8zm0 5h15v2H8zm0 5h10v2H8z"/>',
  pickaxe:
    '<path fill="#8b613e" d="m7 27 17-17 4 4L11 31z"/><path fill="#50d6cf" d="M5 3h19v5h5v14h-5V11h-9V8H5z"/>',
};
export const assetRegistry = Object.freeze(art);
export function Asset({
  name,
  size = 32,
  className = "",
  style,
}: {
  name: AssetName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={"asset " + className}
      style={style}
      shapeRendering="crispEdges"
      dangerouslySetInnerHTML={{ __html: assetRegistry[name] }}
    />
  );
}
export function Landscape({
  night = false,
  compact = false,
}: {
  night?: boolean;
  compact?: boolean;
}) {
  const scene = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = scene.current;
    if (!element || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(([entry]) => {
      element.dataset.visible = String(entry?.isIntersecting ?? false);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={scene}
      className={`landscape ${night ? "night" : ""} ${compact ? "compact" : ""}`}
      aria-hidden="true"
    >
      <div className="landscape-sky" />
      <div className="landscape-art" />
      <div className="landscape-atmosphere" />
      <Asset name={night ? "moon" : "sun"} size={64} className="scene-sun" />
      <Asset name="cloud" size={150} className="scene-cloud cloud-one" />
      <Asset name="cloud" size={110} className="scene-cloud cloud-two" />
      <div className="mountains far" />
      <div className="mountains near" />
      <div className="scene-water" />
      <div className="scene-ground" />
      <div className="voxel-tree tree-one">
        <i />
        <b />
      </div>
      <div className="voxel-tree tree-two">
        <i />
        <b />
      </div>
      <div className="scene-flowers">
        <i />
        <i />
        <i />
      </div>
      <Asset name="bee" size={26} className="scene-bee" />
      <div className="scene-particles">
        {Array.from({ length: 8 }, (_, i) => (
          <i key={i} style={{ "--i": i } as CSSProperties} />
        ))}
      </div>
      <div className="scene-stars" aria-hidden="true">
        {Array.from({ length: 12 }, (_, i) => (
          <i key={i} style={{ "--i": i } as CSSProperties} />
        ))}
      </div>
    </div>
  );
}
