// Tab Overview — background service worker
// Captures a thumbnail of each tab as you view it, and opens/closes the overview.
// Nothing leaves the browser: thumbnails live in chrome.storage.session (memory only,
// wiped when Edge quits). No network requests, no analytics.

const OVERVIEW_URL = chrome.runtime.getURL('overview.html');
const THUMB_WIDTH = 440;        // px; cards are ~220–420px wide, retina-friendly
const THUMB_QUALITY = 0.6;      // JPEG quality for stored thumbnails
const CAPTURE_GAP_MS = 600;     // captureVisibleTab is limited to ~2 calls/second

let refreshing = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- overlay state (kept in session storage so it survives worker restarts)

async function getOverlay() {
  const { overlay } = await chrome.storage.session.get('overlay');
  return overlay || null;
}

async function setOverlay(overlay) {
  if (overlay) await chrome.storage.session.set({ overlay });
  else await chrome.storage.session.remove('overlay');
}

// ---------- thumbnail capture

function isCapturable(url) {
  if (!url || !/^(https?|file):/i.test(url)) return false;
  // Browsers block extensions from capturing their own extension stores.
  if (/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore|microsoftedge\.microsoft\.com\/addons)/i.test(url)) return false;
  return true;
}

let lastCapture = 0;
let captureChain = Promise.resolve();

// Queue a capture of `tabId`, which must be the visible tab of `windowId`.
function captureTab(windowId, tabId) {
  captureChain = captureChain.then(async () => {
    const wait = lastCapture + CAPTURE_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      const [tab] = await chrome.tabs.query({ windowId, active: true });
      if (!tab || tab.id !== tabId || !isCapturable(tab.url)) return;
      lastCapture = Date.now();
      const raw = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 85 });
      const small = await downscale(raw);
      await saveThumb(tabId, small);
    } catch (e) {
      // Restricted page, minimized window, window closed mid-capture, etc. Skip quietly.
    }
  });
  return captureChain;
}

async function downscale(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, THUMB_WIDTH / bmp.width);
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: THUMB_QUALITY });
  const bytes = new Uint8Array(await out.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return 'data:image/jpeg;base64,' + btoa(bin);
}

async function saveThumb(tabId, img) {
  const key = 't:' + tabId;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await chrome.storage.session.set({ [key]: { img, at: Date.now() } });
      return;
    } catch (e) {
      // Session storage is capped (~10 MB). Make room and retry.
      if (!(await evict())) return;
    }
  }
}

async function evict() {
  const all = await chrome.storage.session.get(null);
  const live = new Set((await chrome.tabs.query({})).map((t) => 't:' + t.id));
  const thumbKeys = Object.keys(all).filter((k) => k.startsWith('t:'));
  const dead = thumbKeys.filter((k) => !live.has(k));
  if (dead.length) {
    await chrome.storage.session.remove(dead);
    return true;
  }
  const oldest = thumbKeys
    .sort((a, b) => all[a].at - all[b].at)
    .slice(0, Math.max(10, Math.ceil(thumbKeys.length * 0.1)));
  if (!oldest.length) return false;
  await chrome.storage.session.remove(oldest);
  return true;
}

// Debounced capture of whatever is visible in a window.
const pendingCapture = new Map();
function scheduleCapture(windowId, delay) {
  if (refreshing) return;
  clearTimeout(pendingCapture.get(windowId));
  pendingCapture.set(windowId, setTimeout(async () => {
    pendingCapture.delete(windowId);
    const [tab] = await chrome.tabs.query({ windowId, active: true }).catch(() => []);
    if (tab) captureTab(windowId, tab.id);
  }, delay));
}

// ---------- open / close the overview

async function openOverview() {
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  let active = null;
  if (win) {
    [active] = await chrome.tabs.query({ windowId: win.id, active: true });
    if (active) await captureTab(win.id, active.id); // freshest possible thumbnail
  }

  if (win && win.state === 'fullscreen') {
    // A separate window can't sit on top of a macOS full-screen Space, so open as a tab.
    const tab = await chrome.tabs.create({
      url: OVERVIEW_URL, windowId: win.id, index: active ? active.index + 1 : undefined, active: true,
    });
    await setOverlay({ mode: 'tab', tabId: tab.id, windowId: tab.windowId, returnWindowId: win.id, returnTabId: active?.id });
    return;
  }

  // Default: a window laid exactly over the current Edge window, like Mission Control.
  const opts = { url: OVERVIEW_URL, type: 'popup', focused: true };
  if (win && win.state !== 'minimized') {
    Object.assign(opts, { left: win.left, top: win.top, width: win.width, height: win.height });
  } else {
    opts.state = 'maximized';
  }
  let w;
  try {
    w = await chrome.windows.create(opts);
  } catch (e) {
    // Odd bounds (e.g. window partly off-screen): fall back to a maximized overlay.
    w = await chrome.windows.create({ url: OVERVIEW_URL, type: 'popup', focused: true, state: 'maximized' });
  }
  await setOverlay({ mode: 'window', windowId: w.id, tabId: w.tabs[0].id, returnWindowId: win?.id, returnTabId: active?.id });
}

async function closeOverview(returnToOriginal = true) {
  const ov = await getOverlay();
  if (!ov) return false;
  await setOverlay(null); // clear first so focus/remove events don't re-trigger
  try {
    if (ov.mode === 'tab' && returnToOriginal && ov.returnTabId) {
      await chrome.tabs.update(ov.returnTabId, { active: true }).catch(() => {});
    }
    if (ov.mode === 'window') await chrome.windows.remove(ov.windowId);
    else await chrome.tabs.remove(ov.tabId);
  } catch (e) {
    return false; // already gone
  }
  return true;
}

async function toggleOverview() {
  if (await closeOverview()) return;
  await openOverview();
}

async function activateTab(tabId, windowId) {
  const ov = await getOverlay();
  await setOverlay(null);
  await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(windowId, { focused: true });
  if (ov) {
    if (ov.mode === 'window') await chrome.windows.remove(ov.windowId).catch(() => {});
    else await chrome.tabs.remove(ov.tabId).catch(() => {});
  }
}

// ---------- "Refresh all": flip through every tab to capture it

function waitForComplete(tabId, timeout) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (id, info) => { if (id === tabId && info.status === 'complete') finish(); };
    chrome.tabs.onUpdated.addListener(listener);
    const timer = setTimeout(finish, timeout);
    chrome.tabs.get(tabId).then((t) => { if (t.status === 'complete') finish(); }).catch(finish);
  });
}

async function refreshAll(includeSleeping) {
  if (refreshing) return;
  refreshing = true;
  const ov = await getOverlay();
  try {
    const wins = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
    const jobs = [];
    for (const w of wins) {
      if (w.state === 'minimized') continue;
      for (const t of w.tabs) {
        if (!isCapturable(t.url)) continue;
        if (t.discarded && !includeSleeping) continue;
        jobs.push({ w, t });
      }
    }
    let done = 0;
    await chrome.storage.session.set({ refresh: { done, total: jobs.length } });

    for (const w of wins) {
      const mine = jobs.filter((j) => j.w.id === w.id);
      if (!mine.length) continue;
      const originalActive = w.tabs.find((t) => t.active);
      await chrome.windows.update(w.id, { focused: true }).catch(() => {});
      for (const { t } of mine) {
        try {
          await chrome.tabs.update(t.id, { active: true });
          await waitForComplete(t.id, 4000);
          await sleep(300); // let it paint
          await captureTab(w.id, t.id);
        } catch (e) { /* tab closed meanwhile */ }
        done++;
        await chrome.storage.session.set({ refresh: { done, total: jobs.length } });
      }
      if (originalActive) await chrome.tabs.update(originalActive.id, { active: true }).catch(() => {});
    }
  } finally {
    refreshing = false;
    await chrome.storage.session.remove('refresh');
    if (ov && ov.mode === 'window') await chrome.windows.update(ov.windowId, { focused: true }).catch(() => {});
    if (ov && ov.mode === 'tab') {
      await chrome.tabs.update(ov.tabId, { active: true }).catch(() => {});
      await chrome.windows.update(ov.windowId, { focused: true }).catch(() => {});
    }
  }
}

// ---------- events

chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === 'toggle-overview') toggleOverview();
});

chrome.action.onClicked.addListener(() => toggleOverview());

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  (async () => {
    if (msg.type === 'activate') await activateTab(msg.tabId, msg.windowId);
    else if (msg.type === 'close-overview') await closeOverview();
    else if (msg.type === 'refresh-all') refreshAll(!!msg.includeSleeping); // runs on; progress via storage
    sendResponse({ ok: true });
  })();
  return true;
});

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  scheduleCapture(windowId, 400);
  // Tab mode: switching away from the overview tab closes it.
  const ov = await getOverlay();
  if (ov && ov.mode === 'tab' && ov.windowId === windowId && tabId !== ov.tabId && !refreshing) {
    await setOverlay(null);
    chrome.tabs.remove(ov.tabId).catch(() => {});
  }
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' && tab.active) scheduleCapture(tab.windowId, 600);
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  scheduleCapture(windowId, 300);
  // Clicking another Edge window dismisses the overlay, like Mission Control.
  const ov = await getOverlay();
  if (ov && ov.mode === 'window' && windowId !== ov.windowId && !refreshing) {
    await setOverlay(null);
    chrome.windows.remove(ov.windowId).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  chrome.storage.session.remove('t:' + tabId);
  const ov = await getOverlay();
  if (ov && ov.tabId === tabId) await setOverlay(null);
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const ov = await getOverlay();
  if (ov && ov.windowId === windowId) await setOverlay(null);
});

chrome.tabs.onReplaced.addListener(async (addedId, removedId) => {
  const key = 't:' + removedId;
  const got = await chrome.storage.session.get(key);
  if (got[key]) {
    await chrome.storage.session.set({ ['t:' + addedId]: got[key] });
    await chrome.storage.session.remove(key);
  }
});
