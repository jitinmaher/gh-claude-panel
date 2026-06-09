
# gh-claude-panel

> A Chrome side panel that lets Claude review your GitHub pull requests in place — no context switching, no copy-paste.

One click on the toolbar icon slides a chat panel out from the right edge of any GitHub PR. The current PR's diff, title, and metadata are attached to every message automatically. Pick between three backends from a dropdown:

- **Anthropic Cloud** — direct streaming from the Claude API. Bring your own key.
- **Local Claude Code** — your `claude` CLI on your machine, with its tools, MCPs, and credentials.
- **Local Cursor** — your `cursor-agent` CLI.

Works on **github.com** and **GitHub Enterprise** hosts.

https://github.com/user-attachments/assets/ff87f3c6-6fdb-4f98-9ae4-ac235cd0795a

---

## Features

- **Slide-out side panel** — pinned to the right edge, survives GitHub's Turbo / pjax navigation, doesn't disrupt the page
- **Three backends, one UI** — swap between cloud Claude, local Claude Code, and Cursor with a dropdown
- **Auto-attached PR context** — diff, file list, title, author scraped from the DOM; falls back to fetching `<pr-url>.diff` when the diff isn't rendered on the current tab
- **Markdown rendering** — code fences, lists, headings, inline code, bold/italic
- **Severity-coded finding cards** — Claude wraps issues in `finding:high|medium|low|info` fenced blocks; UI renders them as red/amber/green/blue cards with badges
- **Live streaming animation** — pulsing accent border + animated dots while Claude is thinking, smooth transition to streamed text
- **Theme-aware** — inherits GitHub's font stack and theme (data-color-mode); follows dark/light toggles automatically
- **Quick prompts** — preset starter buttons for the empty state ("Review this PR", "Suggest a better title", etc.)
- **Local bridge** — token-authenticated WebSocket daemon on `127.0.0.1` for talking to local CLIs without exposing them to the internet

---

## Screenshots

> Replace these placeholders with actual screenshots once you've taken them.

| Empty state | Streaming review |
|---|---|
| _panel-empty-state.png_ | _panel-streaming.png_ |

| Severity findings | Settings |
|---|---|
| _panel-findings.png_ | _options-page.png_ |

---

## Architecture

```
┌─────────────────────────────────┐      ┌───────────────────────────┐
│  Chrome extension (MV3)         │      │  Local bridge (Node)      │
│                                 │      │                           │
│  ┌─────────────────────────┐    │      │  WebSocket :7321          │
│  │ background service      │    │      │  127.0.0.1 only           │
│  │ worker (toolbar action) │    │      │  Token auth               │
│  └─────────────────────────┘    │      │                           │
│  ┌─────────────────────────┐    │      │  ┌──────────────────┐     │
│  │ content script          │ ws ├─────►│  │ ClaudeAdapter    │     │
│  │ - iframe injection      │    │      │  │ spawns `claude`  │     │
│  │ - DOM scraping          │    │      │  └──────────────────┘     │
│  └─────────────────────────┘    │      │  ┌──────────────────┐     │
│  ┌─────────────────────────┐    │      │  │ CursorAdapter    │     │
│  │ side panel (iframe)     │    │      │  │ spawns `cursor`  │     │
│  │ - React UI              │    │      │  └──────────────────┘     │
│  │ - markdown renderer     │    │      └───────────────────────────┘
│  │ - transports x 3        │    │
│  └─────────────────────────┘    │      ┌───────────────────────────┐
│  ┌─────────────────────────┐    │ HTTPS│  api.anthropic.com        │
│  │ options page            │    ├─────►│  /v1/messages (SSE)       │
│  └─────────────────────────┘    │      └───────────────────────────┘
└─────────────────────────────────┘
```

All three backends implement a common `AgentTransport` interface (`stream(req, signal): AsyncIterable<StreamEvent>`), so the UI is agnostic to which one is selected. See [`extension/src/transports/types.ts`](./extension/src/transports/types.ts).

---

## Quickstart

Requires Node 20+ (Vite 5 / Chrome's MV3 module loader).

```bash
# Clone and install
git clone <repo-url> gh-claude-panel
cd gh-claude-panel
npm install

# Build the extension
npm run build:ext

# Load it into Chrome
#   chrome://extensions
#   → toggle "Developer mode" on
#   → "Load unpacked"
#   → select extension/dist
```

Then click the toolbar icon on any github.com PR.

### Configure backends

Right-click the toolbar icon → **Options**.

**For Anthropic Cloud (default):**
- Paste an API key from `console.anthropic.com` → Save.

**For Local Claude Code / Cursor:**
- Start the bridge in a separate terminal:
  ```bash
  npm run dev:bridge
  ```
- Copy the token printed to the console.
- Paste it into Options → "Bridge token" → Save.
- Change "Default backend" to "Local Claude Code" or "Local Cursor".

### Development workflow

```bash
npm run dev:ext       # Vite watch build → extension/dist
npm run dev:bridge    # tsx watch the bridge daemon
```

Reload the extension in `chrome://extensions` after the first build, then HMR usually picks up changes automatically. Hard-reload the GitHub tab (Cmd+Shift+R) after extension changes to re-inject the content script.

---

## Severity findings

When Claude reviews a PR, the system prompt asks it to wrap concrete issues in a fenced block with a severity tag:

````
```finding:high
Concurrent writes can corrupt the cache.
The new `updateCache()` writes without a lock. Two concurrent calls
will interleave and leave the map in an inconsistent state.
```

```finding:medium
Missing test for the regex change.
The new pattern in line 42 has no test covering the multi-line case.
```

```finding:low
Variable name `x` could be clearer.
Rename to `userCount`.
```
````

The UI renders each as a colored card:

- **`finding:high`** — red, for bugs / security / data-loss
- **`finding:medium`** — amber, for regressions / perf / fragility
- **`finding:low`** — green, for nits / style / suggestions
- **`finding:info`** — blue, for observations

Aliases: `critical/bug/error → high`, `warning/risk → medium`, `nit/suggestion → low`, `note → info`.

---

## Repo layout

```
gh-claude-panel/
├── extension/                       Chrome MV3 extension
│   ├── manifest.config.ts           CRX manifest definition
│   ├── src/
│   │   ├── background/              Service worker (toolbar action)
│   │   ├── content/                 Content script + iframe injection
│   │   ├── panel/                   React UI (App, ChatStream, Markdown, …)
│   │   ├── transports/              AgentTransport + 3 implementations
│   │   ├── github/                  DOM scrapers + selectors
│   │   └── options/                 Settings page (React)
│   └── public/icons/                Extension icons (PNG + source SVG)
├── bridge/                          Local Node WebSocket daemon
│   ├── src/
│   │   ├── adapters/                Per-CLI adapters (claude.ts, cursor.ts)
│   │   ├── server.ts                WebSocket server, token auth
│   │   └── auth.ts                  First-run token generation
│   └── bin/gh-claude-bridge.ts      CLI entry point
├── package.json                     Workspace root
└── README.md
```

---

## Security notes

- **Anthropic API key** is stored in `chrome.storage.local`, scoped to this extension, and sent only to `api.anthropic.com`. It is never sent to the bridge.
- **Bridge token** is generated with `crypto.randomBytes(24)` on first run and persisted to `~/.gh-claude-panel/token` mode 0600. The bridge binds to `127.0.0.1` only and rejects non-loopback connections.
- **Browser-direct API access** uses `anthropic-dangerous-direct-browser-access: true` because the extension calls the Anthropic API from a content-script context. Fine for a personal prototype on your own machine. For multi-user deployment, proxy through a server instead.
- **Local Claude / Cursor adapters** run with a read-only allow-list by default: `Bash(gh:*), Bash(git:*), Read, Glob, Grep, WebFetch`. Override with `GH_CLAUDE_ALLOWED_TOOLS` env var if you want to widen it.

---

## Environment variables (bridge)

| Variable | Default | Purpose |
|---|---|---|
| `GH_CLAUDE_BRIDGE_PORT` | `7321` | WebSocket port |
| `GH_CLAUDE_BRIDGE_HOST` | `127.0.0.1` | Bind host. Do not change unless you know what you're doing |
| `GH_CLAUDE_ALLOWED_TOOLS` | `Bash(gh:*),Bash(git:*),Read,Glob,Grep,WebFetch` | Tools the local Claude CLI may use |
| `GH_CLAUDE_CURSOR_BIN` | `cursor-agent` | Cursor CLI binary name |
| `GH_CLAUDE_CURSOR_ARGS` | `(empty)` | Extra args passed to Cursor before the prompt |

---

## FAQ

**Why does the panel say "0 files" sometimes?**
The DOM-based diff scraper only finds files on the "Files changed" tab. On Conversation or Commits tabs, the panel falls back to fetching `<pr-url>.diff` with your session cookies. If that 404s (deleted PR, lost session), the chip stays at zero — Claude still answers, just without diff context.

**Why isn't the panel showing up after I install the extension?**
The content script only auto-injects on *new* page loads. Hard-reload the GitHub tab (Cmd+Shift+R) once after installing.

**Does it work on GitHub Enterprise?**
Yes — `github.intuit.com` and `github.com` are wired up by default. To add another GHE host, edit `extension/manifest.config.ts` (host_permissions, content_scripts, web_accessible_resources) **and** `extension/src/github/selectors.ts` (`GITHUB_HOSTS`).

**Can Claude post comments to GitHub directly?**
Not yet — v1 is read-only. Copy responses out manually for now. Direct comment-posting via Octokit is on the v2 list.

**Why "dangerous direct browser access" — is that bad?**
The Anthropic API normally expects a server-side proxy. Calling it from the browser exposes your API key to any code running in the panel — fine for a personal extension installed only by you, dangerous if you ever distributed the extension publicly. For team distribution, replace `AnthropicCloudTransport` with a call to your own backend.

**What's not in v1?**
Issue pages, single-file view, commit pages, posting comments via Octokit, tool-approval round-trip from local Claude, Firefox / Safari, Chrome Web Store publishing.

---

## License

MIT. Personal prototype — provided as-is.
