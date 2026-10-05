import { Component, type ReactNode } from "react";
import { fatalMessages } from "./i18n.tsx";
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      const index = (
        localStorage.getItem("minemate.language") ?? navigator.language
      ).startsWith("de")
        ? 1
        : 0;
      return (
        <main className="fatal-error">
          <h1>{fatalMessages.title[index]}</h1>
          <button onClick={() => location.reload()}>
            {fatalMessages.retry[index]}
          </button>
          <details>
            <summary>{fatalMessages.details[index]}</summary>
            <pre>{this.state.error.message}</pre>
          </details>
          <button
            onClick={() =>
              void navigator.clipboard.writeText(
                this.state.error?.message ?? "",
              )
            }
          >
            {fatalMessages.copy[index]}
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
