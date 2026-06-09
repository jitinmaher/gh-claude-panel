import { useEffect, useRef } from "react";
import { Markdown } from "./markdown";

interface Msg {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  streaming?: boolean;
  error?: boolean;
}

export function ChatStream({ messages }: { messages: Msg[] }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  return (
    <div className="chat-stream">
      {messages.map((m) => (
        <div
          key={m.id}
          className={`message ${m.role} ${m.error ? "error" : ""} ${m.streaming ? "streaming" : ""}`}
        >
          <div className="message-role">
            <span className="role-label">{m.role}</span>
            {m.streaming && (
              <span className="role-streaming">
                <span className="thinking-dot" />
                <span className="thinking-dot" />
                <span className="thinking-dot" />
              </span>
            )}
          </div>
          <div className="message-body">
            {m.role === "assistant" && !m.error && m.content ? (
              <Markdown text={m.content} />
            ) : m.content ? (
              m.content
            ) : m.streaming ? (
              <span className="thinking-shimmer">Reviewing the diff…</span>
            ) : null}
          </div>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
