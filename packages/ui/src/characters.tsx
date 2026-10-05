export type CharacterKind = "creeper" | "alex" | "pig" | "bee";

/** Original articulated pixel sprites; the limbs are animated independently. */
export function Character({ kind }: { kind: CharacterKind }) {
  return (
    <svg
      className={"character-sprite character-" + kind}
      viewBox="0 0 40 48"
      width="56"
      height="68"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <ellipse
        className="character-shadow"
        cx="20"
        cy="46"
        rx="14"
        ry="2"
        fill="#10281c66"
      />
      {kind === "creeper" && (
        <>
          <g className="leg leg-left">
            <path fill="#234f32" d="M8 35h10v10H8z" />
            <path fill="#80ae40" d="M8 35h7v6H8z" />
            <path fill="#141f20" d="M8 43h10v3H8z" />
          </g>
          <g className="leg leg-right">
            <path fill="#234f32" d="M22 35h10v10H22z" />
            <path fill="#70a23e" d="M22 35h7v6H22z" />
            <path fill="#141f20" d="M22 43h10v3H22z" />
          </g>
          <path fill="#4a883b" d="M12 21h16v17H12z" />
          <path fill="#8ab94b" d="M12 21h6v12h-6zm10 10h6v7h-6z" />
          <path fill="#2b6435" d="M18 24h5v8h-5z" />
          <g className="character-head">
            <path fill="#71a842" d="M7 3h26v22H7z" />
            <path fill="#acd167" d="M7 3h10v5H7zm15 0h11v6H22zm-15 9h5v6H7z" />
            <path fill="#3d7837" d="M27 9h6v16h-6zm-12 10h7v6h-7z" />
            <g className="character-eyes">
              <path fill="#142c28" d="M11 10h6v6h-6zm12 0h6v6h-6z" />
            </g>
            <path fill="#142c28" d="M17 15h6v4h-6zm-3 3h12v7h-4v-4h-4v4h-4z" />
          </g>
        </>
      )}
      {kind === "alex" && (
        <>
          <g className="leg leg-left">
            <path fill="#64546f" d="M12 31h8v13h-8z" />
            <path fill="#263330" d="M10 42h10v4H10z" />
          </g>
          <g className="leg leg-right">
            <path fill="#493e59" d="M21 31h8v13h-8z" />
            <path fill="#263330" d="M21 42h10v4H21z" />
          </g>
          <path fill="#6d9c54" d="M11 17h19v17H11z" />
          <path fill="#a0bd73" d="M11 17h6v13h-6z" />
          <path fill="#385839" d="M12 29h17v4H12z" />
          <g className="arm arm-left">
            <path fill="#7aa65b" d="M5 18h7v9H5z" />
            <path fill="#f0be92" d="M5 26h7v9H5z" />
          </g>
          <g className="arm arm-right">
            <path fill="#567b45" d="M29 18h6v9h-6z" />
            <path fill="#d9986e" d="M29 26h6v9h-6z" />
            <g className="character-tool">
              <path fill="#815037" d="M33 21h3v16h-3z" />
              <path fill="#70e0cc" d="M29 20h10v4H29z" />
              <path fill="#c7fff0" d="M29 19h8v2h-8z" />
            </g>
          </g>
          <g className="character-head">
            <path fill="#b65d27" d="M9 1h22v19H9z" />
            <path fill="#e89541" d="M9 1h19v5H9z" />
            <path fill="#f0bf93" d="M11 6h18v12H11z" />
            <path fill="#cd7734" d="M9 4h7v6H9zm17 1h5v17h-5z" />
            <g className="character-eyes">
              <path fill="#fff9e3" d="M12 10h5v3h-5zm10 0h5v3h-5z" />
              <path fill="#467d57" d="M14 10h3v3h-3zm8 0h3v3h-3z" />
            </g>
            <path fill="#ac674d" d="M17 15h5v2h-5z" />
          </g>
        </>
      )}
      {kind === "pig" && (
        <>
          <g className="leg leg-left">
            <path fill="#d8898c" d="M7 34h8v10H7z" />
            <path fill="#815563" d="M7 42h8v4H7z" />
          </g>
          <g className="leg leg-right">
            <path fill="#c87583" d="M26 34h8v10h-8z" />
            <path fill="#815563" d="M26 42h8v4h-8z" />
          </g>
          <path fill="#e9a0a0" d="M5 23h30v15H5z" />
          <path fill="#ffc2b9" d="M5 23h30v5H5z" />
          <path fill="#c77b85" d="M32 26h5v10h-5z" />
          <g className="character-head">
            <path fill="#f2aaa7" d="M15 13h22v21H15z" />
            <path fill="#ffc2b9" d="M15 13h22v5H15z" />
            <path fill="#d4848a" d="M15 9h6v7h-6zm16 0h6v7h-6z" />
            <g className="character-eyes">
              <path fill="#3e3b3a" d="M18 20h3v4h-3zm13 0h3v4h-3z" />
            </g>
            <path fill="#d7878c" d="M21 25h12v7H21z" />
            <path fill="#85485c" d="M23 27h3v3h-3zm6 0h2v3h-2z" />
          </g>
        </>
      )}
      {kind === "bee" && (
        <g className="bee-body">
          <g className="bee-wing wing-left">
            <path fill="#c4efed" d="M7 8h10v13H7z" />
            <path fill="#f6ffe7" d="M7 8h5v10H7z" />
          </g>
          <g className="bee-wing wing-right">
            <path fill="#dbf5e6" d="M21 7h10v14H21z" />
            <path fill="#f6ffe7" d="M24 7h7v7h-7z" />
          </g>
          <path fill="#744b30" d="M5 20h31v17H5z" />
          <path fill="#f5cb52" d="M5 20h7v17H5zm13 0h7v17h-7zm12 0h7v17h-7z" />
          <path fill="#ffdf7c" d="M5 20h7v4H5zm13 0h7v4h-7zm12 0h7v4h-7z" />
          <g className="character-eyes">
            <path fill="#213b3f" d="M30 25h4v5h-4z" />
            <path fill="#fff9d4" d="M30 25h2v2h-2z" />
          </g>
          <path fill="#5e4933" d="M8 37h3v4H8zm13 0h3v4h-3zM2 25h3v4H2z" />
        </g>
      )}
    </svg>
  );
}
