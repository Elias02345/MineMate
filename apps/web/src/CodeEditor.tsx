import { useRef } from "react";
/** React text nodes keep highlighting safe even when a configuration contains HTML. */
export function CodeEditor({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const preview = useRef<HTMLPreElement>(null);
  const parts = value.split(
    /("(?:\\.|[^"\\])*"|'[^'\n]*'|#[^\n]*|\/\/[^\n]*|\b(?:true|false|null|\d+(?:\.\d+)?)\b)/g,
  );
  return (
    <div className="code-editor-wrap">
      <pre ref={preview} className="code-highlight" aria-hidden="true">
        {parts.map((part, index) => (
          <span
            key={index}
            className={
              part.startsWith("#") || part.startsWith("//")
                ? "code-comment"
                : part.startsWith('"') || part.startsWith("'")
                  ? "code-string"
                  : /^(true|false|null|\d)/.test(part)
                    ? "code-value"
                    : undefined
            }
          >
            {part}
          </span>
        ))}
        {"\n"}
      </pre>
      <textarea
        className="code-editor"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (preview.current) {
            preview.current.scrollTop = e.currentTarget.scrollTop;
            preview.current.scrollLeft = e.currentTarget.scrollLeft;
          }
        }}
        spellCheck={false}
        aria-label={label}
      />
    </div>
  );
}
