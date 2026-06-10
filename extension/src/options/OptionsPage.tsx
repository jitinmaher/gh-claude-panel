import { useCallback, useEffect, useState } from "react";
import {
  BACKENDS,
  BackendId,
  CUSTOM_MODEL_SENTINEL,
  MODEL_CATALOG,
  TransportSettings,
  isCatalogModel,
  loadSettings,
  saveSettings,
} from "../transports";
import { isValidHost } from "../github/selectors";

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
      <h1>Pat Before I Merge</h1>
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
            <code>~/.pat-before-i-merge/token</code>.
          </div>
        </div>
      </section>

      <section className="section">
        <h2>GitHub Enterprise hosts</h2>
        <EnterpriseHostsField />
      </section>

      <section className="section">
        <h2>GitHub access (optional)</h2>
        <div className="field">
          <label htmlFor="gh-token">Personal access token</label>
          <input
            id="gh-token"
            type="password"
            placeholder="ghp_... or github_pat_..."
            value={s.githubToken ?? ""}
            onChange={(e) => update("githubToken", e.target.value)}
          />
          <div className="hint">
            Required for diff-fetching on <strong>private repositories</strong>{" "}
            and to lift the 60-req/hr unauthenticated rate limit on public
            repos. The token is sent only to{" "}
            <code>api.github.com</code> (or your GHE host's{" "}
            <code>/api/v3</code>). Create one at{" "}
            <code>github.com/settings/tokens</code> with{" "}
            <code>repo</code> read scope (classic) or read access to{" "}
            <code>Pull requests</code> (fine-grained).
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

/**
 * Add / remove GitHub Enterprise hosts at runtime.
 *
 * Lives in its own component because it manages a separate piece of state
 * (the list of hosts + the chrome.permissions grants behind each one) and
 * has its own save path — every add/remove flushes immediately rather than
 * waiting for the global Save button. That's because granting/revoking
 * a permission is a user-facing Chrome dialog; if we batched it with
 * other settings, users would see a permission prompt at "Save" time
 * which would feel surprising.
 */
function EnterpriseHostsField() {
  const [hosts, setHosts] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial load + stay in sync if another tab changes the list.
  useEffect(() => {
    chrome.storage.local.get(["enterpriseHosts"]).then((r) => {
      const v = (r as { enterpriseHosts?: string[] }).enterpriseHosts;
      setHosts(Array.isArray(v) ? v : []);
    });
    const listener = (
      changes: { [k: string]: chrome.storage.StorageChange },
      area: chrome.storage.AreaName,
    ) => {
      if (area === "local" && changes.enterpriseHosts) {
        setHosts(
          Array.isArray(changes.enterpriseHosts.newValue)
            ? changes.enterpriseHosts.newValue
            : [],
        );
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  const addHost = useCallback(async () => {
    setError(null);
    const cleaned = draft.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!isValidHost(cleaned)) {
      setError("Enter a valid hostname like github.acme.com (no scheme, no path).");
      return;
    }
    if (cleaned === "github.com") {
      setError("github.com is always included — no need to add it.");
      return;
    }
    if (hosts.includes(cleaned)) {
      setError("That host is already in the list.");
      return;
    }
    setBusy(true);
    try {
      // Request the host permission. Chrome shows a native prompt; resolves
      // true on grant, false on deny. Must originate from a user gesture
      // (the button click), which is why this runs in the click handler.
      const granted = await chrome.permissions.request({
        origins: [`https://${cleaned}/*`],
      });
      if (!granted) {
        setError("Chrome denied the permission. The host wasn't added.");
        return;
      }
      const next = [...hosts, cleaned];
      await chrome.storage.local.set({ enterpriseHosts: next });
      setHosts(next);
      setDraft("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [draft, hosts]);

  const removeHost = useCallback(
    async (host: string) => {
      setError(null);
      setBusy(true);
      try {
        // Revoke the permission first; if Chrome refuses we keep the
        // entry in storage so state stays consistent.
        const removed = await chrome.permissions.remove({
          origins: [`https://${host}/*`],
        });
        if (!removed) {
          // Permission can't be removed (e.g. it's also covered by a
          // broader pattern the user granted). Storage cleanup is still
          // useful — drop it from the list.
        }
        const next = hosts.filter((h) => h !== host);
        await chrome.storage.local.set({ enterpriseHosts: next });
        setHosts(next);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [hosts],
  );

  return (
    <>
      <div className="field">
        <label htmlFor="enterprise-host">Add a host</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            id="enterprise-host"
            type="text"
            placeholder="github.acme.com"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addHost();
              }
            }}
            disabled={busy}
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="btn"
            onClick={addHost}
            disabled={busy || !draft.trim()}
          >
            Add
          </button>
        </div>
        <div className="hint">
          Adding a host triggers a Chrome permission prompt for that origin.
          After granting, hard-reload any open tabs on the new host
          (Cmd/Ctrl+Shift+R) so the content script attaches. github.com is
          always included.
        </div>
        {error && (
          <div className="hint" style={{ color: "var(--danger-fg)" }}>
            {error}
          </div>
        )}
      </div>

      {hosts.length > 0 && (
        <div className="field">
          <label>Added hosts</label>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            {hosts.map((h) => (
              <li
                key={h}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "6px 10px",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  background: "var(--bg)",
                }}
              >
                <code style={{ fontSize: 13 }}>{h}</code>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => removeHost(h)}
                  disabled={busy}
                  style={{ padding: "3px 10px", fontSize: 11 }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
