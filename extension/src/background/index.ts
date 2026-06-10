/**
 * MV3 service worker.
 *
 * Responsibilities:
 *  - Toggle the side panel when the toolbar action is clicked.
 *  - Recognize whatever GitHub hosts the user has currently permitted
 *    (the static github.com plus any enterprise hosts added at runtime
 *    via the options page).
 *  - Register the content script dynamically for newly-permitted
 *    enterprise hosts so they get injected just like github.com does.
 *
 * Heavy work (streaming, fetch) happens inside the panel iframe itself.
 * The SW is short-lived under MV3.
 */

import { STATIC_HOSTS, loadEnterpriseHosts, isValidHost } from "../github/selectors";

/**
 * Resolve the current GitHub-host prefix list, freshly, from storage.
 *
 * Previously this was cached in a module-level variable filled by a
 * fire-and-forget refreshHostPrefixes() — that races on every SW cold
 * start. MV3 service workers are short-lived: between two clicks the
 * SW can shut down and restart, leaving the cache empty long enough
 * for a click to fall through to "this isn't a GitHub host, open
 * options instead." Reading from storage on each click is a sub-ms
 * cost and authoritative.
 */
async function getHostPrefixes(): Promise<string[]> {
  const enterprise = await loadEnterpriseHosts();
  return [...STATIC_HOSTS, ...enterprise].map((h) => `https://${h}/`);
}

/* ─────────────── Toolbar click ─────────────── */

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url) return;
  const hostPrefixes = await getHostPrefixes();
  const isGithub = hostPrefixes.some((h) => tab.url!.startsWith(h));
  if (!isGithub) {
    // Off-GitHub click — give users a path into options.
    chrome.runtime.openOptionsPage();
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "togglePanel" });
  } catch {
    // No content script on this tab — almost always means the tab was loaded
    // before the extension (or before its last reload), or it's a newly-added
    // enterprise host the user hasn't refreshed yet.
    await chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#d73a49" });
    await chrome.action.setTitle({
      tabId: tab.id,
      title:
        "Reload this tab — the extension was loaded after the page. " +
        "Then click the icon again.",
    });
    setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id!, text: "" }), 4000);
  }
});

/* ─────────────── Dynamic content-script registration ───────────────
 *
 * The manifest's static `content_scripts` entry covers github.com. For
 * user-added enterprise hosts we register at runtime via
 * chrome.scripting.registerContentScripts(), keyed on a single id we
 * own ("pat-enterprise-content"). The script file path comes from the
 * built manifest so we don't have to hard-code Vite's hashed filename.
 *
 * We re-run reconciliation:
 *  - On install / update (chrome.runtime.onInstalled).
 *  - On SW startup (chrome.runtime.onStartup).
 *  - On every change to enterpriseHosts in storage.
 *  - On chrome.permissions.onAdded / onRemoved (so revoking from
 *    chrome://extensions also cleans up).
 *
 * Reconcile = "make Chrome's registered set match the storage set,
 * filtered to hosts we actually have permission for." That last
 * filter is important: if a user adds a host but denies the
 * permission prompt, we shouldn't try to register the script.
 */

const ENTERPRISE_SCRIPT_ID = "pat-enterprise-content";

function getContentScriptFile(): string | null {
  const manifest = chrome.runtime.getManifest();
  const cs = manifest.content_scripts?.[0];
  return cs?.js?.[0] ?? null;
}

async function reconcileEnterpriseContentScripts(): Promise<void> {
  const file = getContentScriptFile();
  if (!file) return;

  const storedHosts = await loadEnterpriseHosts();
  if (storedHosts.length === 0) {
    // Nothing to register; remove any existing dynamic registration.
    await safeUnregister(ENTERPRISE_SCRIPT_ID);
    return;
  }

  // Filter to hosts we actually have permission to inject into.
  const grantedOrigins = await new Promise<string[]>((resolve) => {
    chrome.permissions.getAll((p) => resolve(p.origins ?? []));
  });
  const grantedHostnames = new Set(
    grantedOrigins
      .map((o) => {
        try {
          return new URL(o.replace(/\*/g, "x")).hostname;
        } catch {
          return null;
        }
      })
      .filter((h): h is string => h !== null && isValidHost(h)),
  );
  const matches = storedHosts
    .filter((h) => grantedHostnames.has(h))
    .map((h) => `https://${h}/*`);

  if (matches.length === 0) {
    await safeUnregister(ENTERPRISE_SCRIPT_ID);
    return;
  }

  // registerContentScripts errors if the id already exists, so always
  // unregister-then-register. (update() exists but is fussier across
  // Chrome versions.)
  await safeUnregister(ENTERPRISE_SCRIPT_ID);
  try {
    await chrome.scripting.registerContentScripts([
      {
        id: ENTERPRISE_SCRIPT_ID,
        matches,
        js: [file],
        runAt: "document_idle",
        allFrames: false,
      },
    ]);
  } catch (err) {
    console.warn("[pat] failed to register enterprise content scripts:", err);
  }
}

async function safeUnregister(id: string): Promise<void> {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [id] });
  } catch {
    // No such id — that's fine.
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("[pat-before-i-merge] installed");
  reconcileEnterpriseContentScripts();
});

chrome.runtime.onStartup.addListener(() => {
  reconcileEnterpriseContentScripts();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.enterpriseHosts) {
    reconcileEnterpriseContentScripts();
  }
});

chrome.permissions.onAdded.addListener(() => reconcileEnterpriseContentScripts());
chrome.permissions.onRemoved.addListener(() => reconcileEnterpriseContentScripts());
