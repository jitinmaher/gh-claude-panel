import { useCallback, useState } from "react";

interface Props {
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onReset?: () => void;
}

export function Composer({ busy, onSend, onStop, onReset }: Props) {
  const [text, setText] = useState("");

  const submit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    onSend(trimmed);
    setText("");
  }, [text, busy, onSend]);

  return (
    <div className="composer">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Ask about this PR... (Cmd/Ctrl+Enter to send)"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
        }}
        disabled={busy}
      />
      <div className="composer-row">
        {onReset && (
          <button className="btn btn-secondary" onClick={onReset} disabled={busy}>
            Clear
          </button>
        )}
        <span className="spacer" />
        {busy ? (
          <button className="btn btn-secondary" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button className="btn" onClick={submit} disabled={!text.trim()}>
            Send
          </button>
        )}
      </div>
    </div>
  );
}
