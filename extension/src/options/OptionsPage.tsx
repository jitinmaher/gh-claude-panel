import { useEffect, useState } from "react";
import {
  BACKENDS,
  BackendId,
  TransportSettings,
  loadSettings,
  saveSettings,
} from "../transports";

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
          <input
            id="model"
            type="text"
            placeholder="claude-sonnet-4-5"
            value={s.anthropicModel ?? ""}
            onChange={(e) => update("anthropicModel", e.target.value)}
          />
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
