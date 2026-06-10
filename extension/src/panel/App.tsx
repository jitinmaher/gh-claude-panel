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
import { PanelContext } from "./PanelContext";
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
  /**
   * IDs (file:line:side:title) of findings the user successfully
   * inserted as draft review comments. Kept in-memory per panel session;
   * resets on iframe reload. Drives the "Inserted" badge on the card.
   */
  const [insertedFindings, setInsertedFindings] = useState<Set<string>>(
    () => new Set(),
  );
  const abortRef = useRef<AbortController | null>(null);
  const prCtx = usePRContext();

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      if (s.defaultBackend) setBackendId(s.defaultBackend);
    });
  }, []);

  // Listen for insert-result acknowledgements from the content script.
  // On success, mark the finding as inserted so the card swaps its
  // primary button for a green checkmark.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type !== "gh-claude-insert-result") return;
      const { ok, findingId: id } = e.data as { ok: boolean; findingId?: string };
      if (ok && typeof id === "string") {
        setInsertedFindings((prev) => {
          if (prev.has(id)) return prev;
          const next = new Set(prev);
          next.add(id);
          return next;
        });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
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
    <PanelContext.Provider
      value={{
        appendDraftedBy: settings.appendDraftedBy ?? true,
        insertedFindings,
      }}
    >
      <div className="panel">
        <header className="panel-header">
          <div className="panel-header-row">
            <LayoutControls />
            <h1>Pat Before I Merge</h1>
            <button
              className="icon-btn"
              onClick={openOptions}
              title="Settings"
              aria-label="Settings"
            >
            {/* Gear icon (Primer-style). 14px viewBox; sized via CSS. */}
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <path
                fill="currentColor"
                d="M8 0a8.2 8.2 0 0 1 .701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.392.021 1.82.63.27.385.506.792.704 1.218.315.675.111 1.422-.364 1.891l-.814.806c-.049.048-.098.147-.088.294.016.257.016.515 0 .772-.01.147.038.246.088.294l.814.806c.475.469.679 1.216.364 1.891a7.977 7.977 0 0 1-.704 1.217c-.428.61-1.176.807-1.82.63l-1.102-.302c-.067-.019-.177-.011-.3.071a5.909 5.909 0 0 1-.668.386c-.133.066-.194.158-.211.224l-.29 1.106c-.168.646-.715 1.196-1.458 1.26a8.006 8.006 0 0 1-1.402 0c-.743-.064-1.289-.614-1.458-1.26l-.289-1.106c-.018-.066-.079-.158-.212-.224a5.738 5.738 0 0 1-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.176-1.392-.021-1.82-.63a8.12 8.12 0 0 1-.704-1.218c-.315-.675-.111-1.422.363-1.891l.815-.806c.05-.048.098-.147.088-.294a6.214 6.214 0 0 1 0-.772c.01-.147-.038-.246-.088-.294l-.815-.806C.635 6.045.431 5.298.746 4.623a7.92 7.92 0 0 1 .704-1.217c.428-.61 1.176-.807 1.82-.63l1.102.302c.067.019.177.011.3-.071.214-.143.437-.272.668-.386.133-.066.194-.158.211-.224l.29-1.106C5.91.645 6.456.095 7.199.03 7.433.01 7.667 0 7.902 0H8Zm-.571 1.525c-.036.003-.108.036-.137.146l-.289 1.105c-.147.561-.549.967-.998 1.189-.173.086-.34.183-.5.29-.417.278-.97.423-1.529.27l-1.103-.303c-.109-.03-.175.016-.195.045-.22.312-.412.644-.573.99-.014.031-.021.11.059.19l.815.806c.411.406.562.957.53 1.456a4.709 4.709 0 0 0 0 .582c.032.499-.119 1.05-.53 1.456l-.815.806c-.081.08-.073.159-.059.19.162.346.353.677.573.989.02.03.085.076.195.046l1.102-.303c.56-.153 1.113-.008 1.53.27.161.107.328.204.501.29.447.222.85.629.997 1.189l.289 1.105c.029.109.101.143.137.146a6.6 6.6 0 0 0 1.142 0c.036-.003.108-.036.137-.146l.289-1.105c.147-.561.549-.967.998-1.189.173-.086.34-.183.5-.29.417-.278.97-.423 1.529-.27l1.102.303c.11.03.175-.016.195-.045.22-.313.412-.644.573-.99.014-.031.022-.11-.058-.19l-.815-.806c-.411-.406-.562-.957-.53-1.456a4.709 4.709 0 0 0 0-.582c-.032-.499.119-1.05.53-1.456l.815-.806c.08-.08.073-.159.058-.19a6.464 6.464 0 0 0-.573-.989c-.02-.03-.085-.076-.195-.046l-1.102.303c-.56.153-1.113.008-1.53-.27a4.44 4.44 0 0 0-.501-.29c-.447-.222-.85-.629-.997-1.189l-.289-1.105c-.029-.11-.101-.143-.137-.146a6.6 6.6 0 0 0-1.142 0ZM11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9.5 8a1.5 1.5 0 1 0-3.001.001A1.5 1.5 0 0 0 9.5 8Z"
              />
            </svg>
          </button>
          <button
            className="icon-btn"
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >
            {/* X icon. */}
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <path
                fill="currentColor"
                d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"
              />
            </svg>
          </button>
          </div>
          <div className="panel-header-row panel-header-row-secondary">
            <BackendPicker value={backendId} onChange={onPickBackend} />
            <ModelPicker
              value={settings.anthropicModel ?? "claude-sonnet-4-6"}
              onChange={onPickModel}
            />
          </div>
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
    </PanelContext.Provider>
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
