import { useEffect, useState } from "react";
import {
  BACKENDS,
  BackendId,
  TransportSettings,
  loadSettings,
  saveSettings,
} from "../transports";

/**
 * Catalog of Claude model IDs to expose in the picker. Grouped by family;
 * within each family newest first. Sourced from the claude-api skill on
 * 2026-06-09. If Anthropic ships a new model, add it here.
 *
 * The "Custom…" option lets users enter an ID we don't ship in the
 * dropdown (older snapshots, retired aliases, GHE proxies, etc.) without
 * waiting for us to update this list.
 */
const MODEL_CATALOG: { group: string; models: { id: string; label: string }[] }[] = [
  {
    group: "Opus (most capable)",
    models: [
      { id: "claude-opus-4-8", label: "Claude Opus 4.8 (latest)" },
      { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
      { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
      { id: "claude-opus-4-5", label: "Claude Opus 4.5" },
      { id: "claude-opus-4-1", label: "Claude Opus 4.1" },
    ],
  },
  {
    group: "Sonnet (balanced)",
    models: [
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (latest)" },
      { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    ],
  },
  {
    group: "Haiku (fastest)",
    models: [{ id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (latest)" }],
  },
];

const CUSTOM_MODEL_SENTINEL = "__custom__";

function isCatalogModel(id: string | undefined): boolean {
  if (!id) return true; // empty = will fall back to default; treat as catalog
  return MODEL_CATALOG.some((g) => g.models.some((m) => m.id === id));
}

export function OptionsPage() {
  const [s, setS] = useState<TransportSettings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadSettings().then(setS);
  }, []);

  if (!s) return null;

  const update = <K extends keyof TransportSettings>(k: K, v: TransportSettings[K]) => {
    setS((prev) => ({ ...prev!, [k]: v }));
    setSaved(false);
  };

  const save = async () => {
    await saveSettings(s);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="options-shell">
      <h1>GH Claude Panel</h1>
      <div className="lede">
        Settings sync to <code>chrome.storage.local</code>. The Anthropic API key
        never leaves your machine.
      </div>

      <section className="section">
        <h2>Anthropic Cloud</h2>
        <div className="field">
          <label htmlFor="api-key">API key</label>
          <input
            id="api-key"
            type="password"
            placeholder="sk-ant-..."
            value={s.anthropicApiKey ?? ""}
            onChange={(e) => update("anthropicApiKey", e.target.value)}
          />
          <div className="hint">
            Get a key at <code>console.anthropic.com</code>. Required for the
            "Anthropic Cloud" backend.
          </div>
        </div>

        <div className="field">
          <label htmlFor="model">Model</label>
          <select
            id="model"
            value={
              isCatalogModel(s.anthropicModel)
                ? s.anthropicModel ?? "claude-sonnet-4-6"
                : CUSTOM_MODEL_SENTINEL
            }
            onChange={(e) => {
              const v = e.target.value;
              if (v === CUSTOM_MODEL_SENTINEL) {
                // Switch into custom mode — clear so the text input doesn't
                // pre-fill with the previously-selected catalog ID, which
                // would be misleading.
                update("anthropicModel", "");
              } else {
                update("anthropicModel", v);
              }
            }}
          >
            {MODEL_CATALOG.map((group) => (
              <optgroup key={group.group} label={group.group}>
                {group.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
            ))}
            <option value={CUSTOM_MODEL_SENTINEL}>Custom…</option>
          </select>
          {!isCatalogModel(s.anthropicModel) && (
            <input
              id="model-custom"
              type="text"
              placeholder="e.g. claude-opus-4-1-20250805"
              value={s.anthropicModel ?? ""}
              onChange={(e) => update("anthropicModel", e.target.value)}
              style={{ marginTop: 6 }}
              aria-label="Custom model ID"
            />
          )}
          <div className="hint">
            Newer = more capable. Sonnet 4.6 is a good default for PR review.
            Pick "Custom…" to enter an ID not in the list (older snapshots,
            retired aliases, or proxy-rewritten IDs).
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Local Bridge (Claude Code / Cursor)</h2>
        <div className="field">
          <label htmlFor="bridge-url">Bridge WebSocket URL</label>
          <input
            id="bridge-url"
            type="text"
            placeholder="ws://127.0.0.1:7321"
            value={s.bridgeUrl ?? ""}
            onChange={(e) => update("bridgeUrl", e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="bridge-token">Bridge token</label>
          <input
            id="bridge-token"
            type="password"
            placeholder="(printed by `npm run dev:bridge`)"
            value={s.bridgeToken ?? ""}
            onChange={(e) => update("bridgeToken", e.target.value)}
          />
          <div className="hint">
            Start the bridge with <code>npm run dev:bridge</code>. The token is
            printed to the console on first run and persisted to{" "}
            <code>~/.gh-claude-panel/token</code>.
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Defaults</h2>
        <div className="field">
          <label htmlFor="default-backend">Default backend</label>
          <select
            id="default-backend"
            value={s.defaultBackend ?? "anthropic-cloud"}
            onChange={(e) => update("defaultBackend", e.target.value as BackendId)}
          >
            {BACKENDS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <div className="actions">
        <button className="btn" onClick={save}>
          Save
        </button>
        {saved && <span className="saved">Saved.</span>}
      </div>
    </div>
  );
}
