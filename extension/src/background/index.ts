/**
 * MV3 service worker.
 *
 * Responsibilities:
 *  - Toggle the side panel when the toolbar action is clicked
 *  - Forward messages between the panel iframe and content script if needed
 *
 * Note: heavy work (streaming, fetch) happens inside the panel iframe itself,
 * not here. The SW is short-lived under MV3.
 */

const GITHUB_HOSTS = ["https://github.com/", "https://github.intuit.com/"];

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url) return;
  const isGithub = GITHUB_HOSTS.some((h) => tab.url!.startsWith(h));
  if (!isGithub) {
    // Open the options page on non-GitHub tabs so users still have a path in.
    chrome.runtime.openOptionsPage();
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "togglePanel" });
  } catch {
    // No content script on this tab — almost always means the tab was loaded
    // before the extension (or before its last reload). Tell the user to
    // refresh; we can't programmatically inject the bundled file by path
    // here because Vite/CRX hashes its name.
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

chrome.runtime.onInstalled.addListener(() => {
  console.log("[gh-claude-panel] installed");
});
