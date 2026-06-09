import { useCallback, useEffect, useRef, useState } from "react";
import {
  AgentTransport,
  BACKENDS,
  BackendId,
  ChatMessage,
  StreamEvent,
  TransportSettings,
  loadSettings,
  makeTransport,
  saveSettings,
} from "../transports";
import { ChatStream } from "./ChatStream";
import { Composer } from "./Composer";
import { ContextChips } from "./ContextChips";
import { BackendPicker } from "./BackendPicker";
import { EmptyState } from "./EmptyState";
import { usePRContext } from "./usePRContext";
import { useHostTheme } from "./useHostTheme";
import { buildContextBlocks } from "../github/pr-context";

interface UIMessage extends ChatMessage {
  id: string;
  streaming?: boolean;
  error?: boolean;
}

export default function App() {
  useHostTheme();
  const [settings, setSettings] = useState<TransportSettings | null>(null);
  const [backendId, setBackendId] = useState<BackendId>("anthropic-cloud");
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const prCtx = usePRContext();

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      if (s.defaultBackend) setBackendId(s.defaultBackend);
    });
  }, []);

  const onPickBackend = useCallback((id: BackendId) => {
    setBackendId(id);
    saveSettings({ defaultBackend: id });
  }, []);

  const send = useCallback(
    async (text: string) => {
      if (!settings || busy) return;
      const transport: AgentTransport = makeTransport(backendId, settings);
      if (!(await transport.isReady())) {
        const advice =
          backendId === "anthropic-cloud"
            ? "Add an Anthropic API key in extension options."
            : "Start the local bridge and paste its token in extension options.";
        setMessages((prev) => [
          ...prev,
          mkMsg("user", text),
          { ...mkMsg("assistant", advice), error: true },
        ]);
        return;
      }

      const userMsg = mkMsg("user", text);
      const asstMsg: UIMessage = { ...mkMsg("assistant", ""), streaming: true };
      setMessages((prev) => [...prev, userMsg, asstMsg]);
      setBusy(true);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const chatMessages: ChatMessage[] = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const contextBlocks = prCtx ? buildContextBlocks(prCtx) : undefined;

      try {
        const stream = transport.stream(
          {
            messages: chatMessages,
            system: SYSTEM_PROMPT,
            contextBlocks,
          },
          ctrl.signal,
        );

        for await (const ev of stream) {
          applyEvent(setMessages, asstMsg.id, ev);
          if (ev.type === "done" || ev.type === "error") break;
        }
      } catch (err) {
        applyEvent(setMessages, asstMsg.id, {
          type: "error",
          message: (err as Error).message,
        });
      } finally {
        setBusy(false);
        abortRef.current = null;
        setMessages((prev) =>
          prev.map((m) => (m.id === asstMsg.id ? { ...m, streaming: false } : m)),
        );
      }
    },
    [settings, backendId, busy, messages, prCtx],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    setMessages([]);
  }, []);

  const onClose = useCallback(() => {
    window.parent.postMessage({ type: "gh-claude-close" }, "*");
  }, []);

  const openOptions = useCallback(() => {
    chrome.runtime.openOptionsPage();
  }, []);

  if (!settings) {
    return <div className="panel" />;
  }

  return (
    <div className="panel">
      <header className="panel-header">
        <h1>Claude on GitHub</h1>
        <BackendPicker value={backendId} onChange={onPickBackend} />
        <button className="icon-btn" onClick={openOptions} title="Settings">
          settings
        </button>
        <button className="icon-btn" onClick={onClose} title="Close">
          close
        </button>
      </header>
      <ContextChips prCtx={prCtx} />
      {messages.length === 0 ? (
        <EmptyState prCtx={prCtx} onPick={send} />
      ) : (
        <ChatStream messages={messages} />
      )}
      <Composer
        busy={busy}
        onSend={send}
        onStop={stop}
        onReset={messages.length > 0 ? reset : undefined}
      />
    </div>
  );
}

function mkMsg(role: ChatMessage["role"], content: string): UIMessage {
  return {
    id: Math.random().toString(36).slice(2),
    role,
    content,
  };
}

function applyEvent(
  setMessages: React.Dispatch<React.SetStateAction<UIMessage[]>>,
  asstId: string,
  ev: StreamEvent,
) {
  setMessages((prev) =>
    prev.map((m) => {
      if (m.id !== asstId) return m;
      if (ev.type === "delta") {
        return { ...m, content: m.content + ev.text };
      }
      if (ev.type === "error") {
        return {
          ...m,
          content: m.content + (m.content ? "\n\n" : "") + `Error: ${ev.message}`,
          error: true,
        };
      }
      return m;
    }),
  );
}

const _availableBackendsIds = BACKENDS.map((b) => b.id);

const SYSTEM_PROMPT = `You are an assistant helping a developer review a GitHub pull request.
Reference specific files and line ranges from the diff when relevant.

When you identify concrete issues, suggestions, or risks in the code, format
each one as a fenced block with a severity tag so the UI can render it as a
colored card:

\`\`\`finding:high
Short title of the issue (one line).
Optional explanation, code references, and reasoning on the lines below.
\`\`\`

Severity tags: high (bugs, security, data loss, broken contracts),
medium (regressions, perf risks, fragile code, test gaps),
low (style, naming, nits, minor suggestions),
info (FYI observations).

Use normal markdown for everything else (summaries, overviews, replies).
Do not wrap a whole review in a finding block — only specific issues.`;
