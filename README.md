# Pat Before I Merge

> A Chrome side panel that reviews your GitHub PR before you hit merge — without leaving the page.

Click the toolbar icon on any pull request, get a streaming review from Claude (cloud), your local `claude` CLI, or a local Cursor agent. The current PR's diff is attached automatically. Findings come back as colored cards with **Insert on line**, **Show in diff**, and **Copy** buttons that stage real review comments on the exact line in GitHub's UI.

Works on **github.com** (classic and the new `/changes` viewer) and on **any GitHub Enterprise host** — add hosts at runtime from the options page, no rebuild needed. See [GitHub Enterprise hosts](#github-enterprise-hosts).

https://github.com/user-attachments/assets/ff87f3c6-6fdb-4f98-9ae4-ac235cd0795a

---

## What it does

| | |
|---|---|
| **One-click review** | Toolbar icon → side panel slides in. PR diff, title, author, file list, and per-line numbers are scraped from the page and attached to every message. |
| **Three backends** | Cloud Claude (bring your own API key), local `claude` CLI via a small bridge daemon, or local `cursor-agent` via the same bridge. Pick from a dropdown at the top of the panel. |
| **Findings as cards** | Claude wraps issues in `finding:high\|medium\|low\|info` fenced blocks with `file:`, `line:`, `side:` metadata. The UI renders each as a red / amber / green / blue card with a severity badge. |
| **Insert on line** | Each card with a valid file+line has an **Insert on line N** button. Clicking it navigates to the Files Changed tab if needed, opens GitHub's inline comment box on that line, fills it with the finding text, and clicks **Start a review** — the comment is staged as a draft. You submit the whole review yourself. |
| **Show in diff** | Hover or click the file:line chip on a card to scroll the diff to that row and pulse a yellow highlight. Read-only — opens no forms. |
| **Movable panel** | Drag the grip in the header to dock left, dock right, or float as a window anywhere on the page. Resize docked panels via the inner edge. Position persists across tabs. |
| **Diff-aware** | The diff fetch tries three paths: live DOM scrape → raw `.diff` endpoint → `/files` HTML fallback. Works on the classic `/files` viewer and the new React `/changes` viewer. |
| **Streaming UX** | Pulsing accent border + animated dots while Claude is thinking, smooth transition to streamed markdown text. |
| **Theme-aware** | Reads GitHub's `data-color-mode` and font stack at mount, follows light/dark/auto toggles automatically. |
| **No context-switching** | Quick-prompt buttons in the empty state ("Review end-to-end", "Suggest a clearer title", "What test coverage is missing?"). |

---

## Architecture

```
┌─────────────────────────────────┐      ┌───────────────────────────┐
│  Chrome extension (MV3)         │      │  Local bridge (Node)      │
│                                 │      │                           │
│  ┌─────────────────────────┐    │      │  WebSocket :7321          │
│  │ background SW           │    │      │  127.0.0.1 only           │
│  │ (toolbar action)        │    │      │  Token auth               │
│  └─────────────────────────┘    │      │                           │
│  ┌─────────────────────────┐    │      │  ┌──────────────────┐     │
│  │ content script          │ ws ├─────►│  │ ClaudeAdapter    │     │
│  │ - iframe injection      │    │      │  │ spawns `claude   │     │
│  │ - drag + dock + resize  │    │      │  │  --print`        │     │
│  │ - DOM scrape + .diff    │    │      │  └──────────────────┘     │
│  │ - review-comment insert │    │      │  ┌──────────────────┐     │
│  └─────────────────────────┘    │      │  │ CursorAdapter    │     │
│  ┌─────────────────────────┐    │      │  │ spawns `cursor-  │     │
│  │ side panel (iframe)     │    │      │  │  agent`          │     │
│  │ - React + markdown      │    │      │  └──────────────────┘     │
│  │ - finding cards         │    │      └───────────────────────────┘
│  │ - 3 transport impls     │    │
│  └─────────────────────────┘    │      ┌───────────────────────────┐
│  ┌─────────────────────────┐    │ HTTPS│  api.anthropic.com        │
│  │ options page            │    ├─────►│  /v1/messages (SSE)       │
│  └─────────────────────────┘    │      └───────────────────────────┘
└─────────────────────────────────┘
```

All three backends implement a common `AgentTransport` interface (`stream(req, signal): AsyncIterable<StreamEvent>`), so the UI doesn't know which one is active. See [`extension/src/transports/types.ts`](./extension/src/transports/types.ts).

---

## Quickstart

Requires Node 20+ (Vite 5 / Chrome's MV3 module loader).

```bash
git clone https://github.com/jitinmaher/pat-before-i-merge.git
cd pat-before-i-merge
npm install
npm run build:ext

# Load it into Chrome:
#   chrome://extensions
#   → toggle Developer mode on
#   → "Load unpacked"
#   → select extension/dist
```

Then click the toolbar icon on any GitHub PR.

### Configure backends

Right-click the toolbar icon → **Options**.

**For Anthropic Cloud (default):**
1. Get an API key from `console.anthropic.com`.
2. Paste into Options → save.
3. Pick a model from the grouped dropdown (defaults to Sonnet 4.6). If the model you want isn't listed, choose **Custom…** and type the ID.

**For Local Claude Code / Cursor:**
```bash
npm run dev:bridge
```
1. Bridge prints a token on first run and saves it to `~/.pat-before-i-merge/token` (existing `~/.gh-claude-panel/token` is migrated automatically).
2. Paste the token into Options → Bridge token → save.
3. Change "Default backend" to **Local Claude Code** or **Local Cursor**.

Local backends use your existing `claude` / `cursor-agent` CLI with their full tool access. The bridge passes `--allowedTools "Bash(gh:*),Bash(git:*),Read,Glob,Grep,WebFetch"` by default so the agent can run `gh pr view`, `git diff`, etc. without prompting. Override with `GH_CLAUDE_ALLOWED_TOOLS=...`.

### Development workflow

```bash
npm run dev:ext       # Vite watch build → extension/dist
npm run dev:bridge    # tsx watch the bridge daemon
```

After extension changes: reload it in `chrome://extensions`, then hard-reload the GitHub tab (Cmd+Shift+R) so the new content script attaches.

---

## How the review-comment insertion works

Claude is instructed (via the system prompt in [`App.tsx`](./extension/src/panel/App.tsx)) to wrap concrete issues like this:

````
```finding:high
file: src/auth.ts
line: 42
side: RIGHT
title: Concurrent writes can corrupt the cache.
The new `updateCache()` writes without a lock. Two concurrent
calls will interleave and leave the map inconsistent.
```
````

The panel renders this as a card with the file:line chip below the title and three buttons:

- **Insert on line 42** — the content script does the equivalent of:
  1. If you're on Conversation/Commits/Checks, click the Files Changed tab anchor (Turbo-friendly, no reload).
  2. Find the row by `(file, line, side)` — checks both classic `td.blob-num[data-line-number=...][data-side=...]` and the new viewer's selectors.
  3. Scroll into view, click GitHub's `+` button.
  4. Fill the textarea via the native value setter + input event (so React state updates).
  5. Click **Start a review** to queue a draft. Nothing is submitted until you hit Submit review.
- **Show in diff** — same row-finding logic, but read-only: scroll + flash a yellow highlight on the row.
- **Copy** — copies the comment markdown to clipboard.

If the file/line can't be resolved (Claude hallucinated a line, file isn't in the PR, GitHub selectors changed), the comment falls back to clipboard with a toast explaining why.

The diff context the model sees is line-numbered — each diff line is prefixed with its post-image line number (right side) or pre-image line number (for deletions, left side):

```
@@ -10,7 +10,9 @@
   10   const x = 1;
   11 - const y = 2;
   12 + const y = 3;
```

This is what makes "line 42" actually mean line 42.

---

## Severity findings

The four severity levels (with aliases):

| Tag | Color | Meaning | Aliases |
|---|---|---|---|
| `finding:high` | red | Bugs, security, data loss, broken contracts | `critical`, `bug`, `error` |
| `finding:medium` | amber | Regressions, perf risks, fragile code, test gaps | `warning`, `risk` |
| `finding:low` | green | Style, naming, nits, minor suggestions | `nit`, `suggestion` |
| `finding:info` | blue | FYI observations | `note` |

Cards without a `file:`/`line:` field still render — they just don't show Insert / Show-in-diff buttons. Copy is always available.

---

## Movable panel

The panel has three layout modes, persisted across tabs in `chrome.storage.local`:

| Mode | How to get there | Behavior |
|---|---|---|
| **Docked right** (default) | Drag near right edge, or click ➡ | Full-height bar, 420px wide by default, resize via inner edge |
| **Docked left** | Drag near left edge, or click ⬅ | Same but on the left side |
| **Floating** | Drag to the middle, or click ⊞ | Window with rounded corners and shadow, can be dragged anywhere within a 16px no-fly zone from viewport edges |

Drag the **⋮⋮ grip** on the far left of the header. Drop within 80px of either edge to snap-dock; drop in open space to float. Width clamps to 300–800px when docked.

---

## Repo layout

```
pat-before-i-merge/
├── extension/                       Chrome MV3 extension (workspace)
│   ├── manifest.config.ts           CRX manifest definition
│   ├── src/
│   │   ├── background/              Service worker (toolbar action)
│   │   ├── content/inject.ts        Content script — iframe injection, drag, comment-insert, toast
│   │   ├── panel/                   React UI
│   │   │   ├── App.tsx              Main panel, system prompt, message routing
│   │   │   ├── ChatStream.tsx       Message list with streaming animation
│   │   │   ├── LayoutControls.tsx   Grip + dock/float buttons
│   │   │   ├── markdown.tsx         Markdown renderer + FindingCard
│   │   │   ├── ContextChips.tsx     PR metadata chips
│   │   │   ├── useHostTheme.ts      Theme sync from parent
│   │   │   ├── usePRContext.ts      Cross-frame PR data hook
│   │   │   └── styles.css           Primer-aligned tokens, dark mode, animations
│   │   ├── github/
│   │   │   ├── selectors.ts         GitHub DOM selectors (single source of truth)
│   │   │   ├── pr-context.ts        DOM scrape + .diff fallback + /files fallback
│   │   │   └── review-insert.ts     DOM-driven review-comment insertion & preview
│   │   ├── transports/              AgentTransport + 3 implementations
│   │   └── options/                 Settings page (React)
│   └── public/icons/                Extension icons + source SVG
├── bridge/                          Local Node WebSocket daemon (workspace)
│   ├── src/
│   │   ├── adapters/                Per-CLI adapters (claude.ts, cursor.ts)
│   │   ├── server.ts                ws server, token auth, 127.0.0.1 binding
│   │   └── auth.ts                  First-run token generation
│   └── bin/pat-bridge.ts            CLI entrypoint
└── README.md
```

---

## Security

- **API key** is stored in `chrome.storage.local`, scoped to this extension, sent only to `api.anthropic.com`. It never reaches the bridge.
- **Bridge token** is generated with `crypto.randomBytes(24)` on first run and persisted to `~/.pat-before-i-merge/token` mode 0600. Legacy `~/.gh-claude-panel/token` is read and migrated on first run so existing users don't have to re-copy. The bridge binds to `127.0.0.1` only and rejects non-loopback connections.
- **Diff fetching** uses your existing GitHub session cookies via same-origin content-script fetches — no GitHub OAuth scope or PAT needed.
- **Review comments** are always staged as drafts via "Start a review" — never auto-submitted. You explicitly click Submit review in GitHub when you're ready.
- **Local CLI permissions**: the bridge passes a default read-only allowlist (`Bash(gh:*),Bash(git:*),Read,Glob,Grep,WebFetch`) to `claude --print`. Override via `GH_CLAUDE_ALLOWED_TOOLS=...` only with intent.

---

## GitHub Enterprise hosts

The extension ships with **just `github.com`** permitted at install time. To use it against any other GHE host:

1. Open the extension's Options page (right-click the toolbar icon → Options).
2. Under **GitHub Enterprise hosts**, type the hostname (e.g. `github.acme.com`) and click **Add**.
3. Chrome shows a native permission prompt for that origin. Grant it.
4. Hard-reload any open tabs on the new host so the content script attaches (Cmd/Ctrl+Shift+R).

That's it. The extension stores your hosts in `chrome.storage.local`, dynamically registers the content script for each granted host via `chrome.scripting.registerContentScripts()`, and revokes both on **Remove**.

No rebuild, no sideload edits, no Intuit-specific anything baked in. The static manifest grants only `github.com` and declares `optional_host_permissions: ["https://*/*"]` as the pattern space the runtime is allowed to request from — actual access for any non-github.com host is opt-in per host.

> **Why isn't this a one-click wildcard?** Chrome MV3 forbids wildcard `host_permissions` like `https://github.*` at install time. Each Enterprise host must be granted explicitly. The options page just makes that grant a button click instead of a manifest edit.

---

## Environment variables

| Var | Default | Effect |
|---|---|---|
| `PAT_BRIDGE_PORT` / `GH_CLAUDE_BRIDGE_PORT` | `7321` | WebSocket port the bridge listens on |
| `PAT_BRIDGE_HOST` / `GH_CLAUDE_BRIDGE_HOST` | `127.0.0.1` | Bind address (loopback only by default) |
| `GH_CLAUDE_ALLOWED_TOOLS` | `Bash(gh:*),Bash(git:*),Read,Glob,Grep,WebFetch` | Tools the local Claude adapter pre-allows |
| `GH_CLAUDE_CURSOR_BIN` | `cursor-agent` | Cursor CLI binary name |
| `GH_CLAUDE_CURSOR_ARGS` | *(none)* | Extra args passed to the Cursor CLI |

---

## FAQ

**Why a side panel instead of using GitHub's built-in Copilot review?** It uses *your* Claude (cloud or local) with *your* context. The same prompt format and finding cards work on personal accounts, GHE, and behind corporate proxies. No special enrollment.

**Does it work on private repos?** Yes — the diff fetch uses your existing GitHub session cookies, so anything you can see in the browser, the extension can scrape.

**What about non-PR pages?** The panel only attaches PR context on `/pull/N/*` URLs. On other pages it still opens (so you can chat with Claude generally) but the chips show "no PR detected" and no diff is sent.

**Will it ever post a comment by itself?** No. The Insert action stages a draft via GitHub's "Start a review" path. You explicitly click Submit review to make anything live.

**Does it work with the new `/pull/N/changes` viewer?** Yes — the diff fallback fetches the raw `.diff` endpoint when the new viewer's DOM doesn't match the classic selectors.
