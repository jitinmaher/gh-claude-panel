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
import { ModelPicker } from "./ModelPicker";
import { EmptyState } from "./EmptyState";
import { LayoutControls } from "./LayoutControls";
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

  const onPickModel = useCallback((modelId: string) => {
    setSettings((prev) => (prev ? { ...prev, anthropicModel: modelId } : prev));
    saveSettings({ anthropicModel: modelId });
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
        <LayoutControls />
        <h1>Pat Before I Merge</h1>
        <BackendPicker value={backendId} onChange={onPickBackend} />
        <ModelPicker
          value={settings.anthropicModel ?? "claude-sonnet-4-6"}
          onChange={onPickModel}
        />
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

CRITICAL: each diff line in the context is prefixed with its line number
in the post-image (the file AFTER this PR's changes), e.g.

       @@ -10,7 +10,9 @@
      10   const x = 1;
      11 - const y = 2;
      12 + const y = 3;
      13 + const z = 4;
      14   return x + y;

Use those gutter numbers when filling the "line:" field of a finding.
For added lines (+) use the post-image number shown. For deleted lines
(-), use the same number and set "side: LEFT". For context lines (no
prefix) use the post-image number with side: RIGHT.

NEVER set line: 1 unless the issue is actually on line 1 of the file —
"1" is not a fallback. If you can't identify a specific line, OMIT the
file/line/side fields entirely and the card will render without an Insert
button.

When you identify a concrete issue, suggestion, or risk tied to a specific
location in the diff, format it as a fenced block with a severity tag and
metadata. The UI will render this as a colored card with a button that
inserts the comment on the exact line in GitHub's review UI.

\`\`\`finding:high
file: path/to/file.ts
line: 42
side: RIGHT
title: Concurrent writes can corrupt the cache.
The new updateCache() writes without a lock. Two concurrent calls will
interleave and leave the map in an inconsistent state.
\`\`\`

Metadata fields (each on its own line at the top of the block):
- file: required for inserting on a line — use the exact path shown in the diff
- line: required — the line number in the post-image (RIGHT side) or pre-image (LEFT side)
- side: optional, defaults to RIGHT — use LEFT only when commenting on a removed line
- title: required — one-line summary shown as the card heading

After the metadata lines, write the comment body in markdown. Everything
below the metadata becomes the review comment text on GitHub.

Severity tags: high (bugs, security, data loss, broken contracts),
medium (regressions, perf risks, fragile code, test gaps),
low (style, naming, nits, minor suggestions),
info (FYI observations).

If a finding doesn't have a specific line (e.g. a high-level architectural
concern about the whole PR), omit the file/line/side fields — the card
will still render and the user can copy it manually.

Use normal markdown for everything else (summaries, overviews, replies).
Do not wrap a whole review in a finding block — only specific issues.`;
