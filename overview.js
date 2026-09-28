// Tab Overview — the overview page (grid of every tab in every window).

const GROUP_COLORS = {
  grey: '#8a8f98', blue: '#3b82f6', red: '#ef4444', yellow: '#eab308', green: '#22c55e',
  pink: '#ec4899', purple: '#a855f7', cyan: '#06b6d4', orange: '#f97316',
};

const $ = (s) => document.querySelector(s);
const filterEl = $('#filter');
const windowsEl = $('#windows');

const state = {
  windows: [],
  groups: new Map(),
  thumbs: {},
  overlay: null,
  selfTabId: null,
  selectedTabId: null,
  firstLoad: true,
};

let dragTabId = null;

// ---------- data

async function load() {
  const [wins, groups, session, self] = await Promise.all([
    chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }),
    chrome.tabGroups.query({}),
    chrome.storage.session.get(null),
    chrome.tabs.getCurrent(),
  ]);
  state.selfTabId = self ? self.id : null;
  state.overlay = session.overlay || null;
  state.groups = new Map(groups.map((g) => [g.id, g]));
  state.thumbs = {};
  for (const [k, v] of Object.entries(session)) {
    if (k.startsWith('t:')) state.thumbs[k.slice(2)] = v.img;
  }

  const home = state.overlay ? state.overlay.returnWindowId : null;
  wins.sort((a, b) => (b.id === home) - (a.id === home) || a.id - b.id);
  state.windows = wins
    .map((w) => ({ ...w, tabs: w.tabs.filter((t) => t.id !== state.selfTabId) }))
    .filter((w) => w.tabs.length);

  if (state.firstLoad) {
    state.firstLoad = false;
    state.selectedTabId = state.overlay ? state.overlay.returnTabId : null;
  }
  showRefreshProgress(session.refresh);
  render();
}

// ---------- rendering (DOM built with textContent only — page titles are never parsed as HTML)

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function hostOf(url) {
  try {
    const u = new URL(url);
    return u.protocol.startsWith('http') ? u.hostname.replace(/^www\./, '') : u.protocol.replace(':', '') + '://';
  } catch { return ''; }
}

function matches(tab, terms) {
  if (!terms.length) return true;
  const hay = ((tab.title || '') + ' ' + (tab.url || '')).toLowerCase();
  return terms.every((t) => hay.includes(t));
}

function favicon(tab) {
  const img = el('img');
  img.alt = '';
  if (tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://')) img.src = tab.favIconUrl;
  else img.style.visibility = 'hidden';
  img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
  return img;
}

function renderCard(tab) {
  const card = el('div', 'card');
  card.draggable = true;
  card.dataset.tabId = tab.id;
  card.dataset.windowId = tab.windowId;
  card.dataset.index = tab.index;
  card.dataset.groupId = tab.groupId;
  card.title = (tab.title || '') + '\n' + (tab.url || '');
  if (tab.discarded) card.classList.add('sleeping');
  if (tab.id === state.selectedTabId) card.classList.add('selected');

  const group = tab.groupId > -1 ? state.groups.get(tab.groupId) : null;
  if (group) {
    card.classList.add('grouped');
    card.style.setProperty('--group-color', GROUP_COLORS[group.color] || GROUP_COLORS.grey);
  }

  const thumb = el('div', 'thumb');
  const shot = state.thumbs[tab.id];
  if (shot) {
    const img = el('img', 'shot');
    img.alt = '';
    img.src = shot;
    thumb.append(img);
  } else {
    const ph = el('div', 'placeholder');
    ph.append(favicon(tab), el('span', null, tab.discarded ? 'Sleeping — no preview yet' : 'No preview yet'));
    thumb.append(ph);
  }

  const close = el('button', 'close', '×');
  close.type = 'button';
  close.title = 'Close tab';
  close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(tab.id); });

  const meta = el('div', 'meta');
  const fav = favicon(tab);
  fav.className = 'fav';
  meta.append(fav, el('span', 'title', tab.title || tab.url || 'Untitled'));

  const sub = el('div', 'sub');
  if (tab.active) sub.append(el('span', 'pill current', 'Current'));
  if (group) {
    const gp = el('span', 'pill group', group.title || 'Group');
    sub.append(gp);
  }
  if (tab.pinned) sub.append(el('span', 'pill', 'Pinned'));
  if (tab.discarded) sub.append(el('span', 'pill', 'Sleeping'));
  sub.append(el('span', 'host', hostOf(tab.url)));

  card.append(thumb, close, meta, sub);

  card.addEventListener('click', () => activate(tab));
  card.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id); } });
  wireDrag(card, tab);
  return card;
}

function render() {
  const terms = filterEl.value.toLowerCase().split(/\s+/).filter(Boolean);
  const scroll = windowsEl.scrollTop;
  windowsEl.replaceChildren();

  let shown = 0;
  let total = 0;
  const home = state.overlay ? state.overlay.returnWindowId : null;

  state.windows.forEach((w, i) => {
    total += w.tabs.length;
    const tabs = w.tabs.filter((t) => matches(t, terms));
    if (!tabs.length) return;
    shown += tabs.length;

    const section = el('section', 'window');
    section.dataset.windowId = w.id;
    const h = el('h2');
    const activeTab = w.tabs.find((t) => t.active);
    h.append(
      el('span', null, w.id === home ? 'This window' : `Window ${i + 1}`),
      el('span', 'sub', `${w.tabs.length} tab${w.tabs.length === 1 ? '' : 's'}${activeTab ? ' · ' + (activeTab.title || '') : ''}`),
    );
    const grid = el('div', 'grid');
    grid.dataset.windowId = w.id;
    tabs.forEach((t) => grid.append(renderCard(t)));
    wireGridDrop(grid, w.id);
    section.append(h, grid);
    windowsEl.append(section);
  });

  if (!shown) windowsEl.append(el('div', 'empty', terms.length ? 'No tabs match your filter.' : 'No tabs open.'));
  $('#count').textContent = terms.length ? `${shown} of ${total} tabs` : `${total} tabs in ${state.windows.length} window${state.windows.length === 1 ? '' : 's'}`;

  // Keep selection on a visible card.
  const cards = visibleCards();
  if (cards.length && !cards.some((c) => +c.dataset.tabId === state.selectedTabId)) select(cards[0], false);
  windowsEl.scrollTop = scroll;
  if (!state.scrolledOnce) {
    state.scrolledOnce = true;
    const sel = document.querySelector('.card.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }
}

// ---------- selection + keyboard

function visibleCards() { return [...document.querySelectorAll('.card')]; }

function select(card, scroll = true) {
  document.querySelectorAll('.card.selected').forEach((c) => c.classList.remove('selected'));
  if (!card) { state.selectedTabId = null; return; }
  card.classList.add('selected');
  state.selectedTabId = +card.dataset.tabId;
  if (scroll) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function moveSelection(dir) {
  const cards = visibleCards();
  if (!cards.length) return;
  const cur = cards.find((c) => +c.dataset.tabId === state.selectedTabId);
  if (!cur) return select(cards[0]);
  const i = cards.indexOf(cur);
  if (dir === 'left') return select(cards[Math.max(0, i - 1)]);
  if (dir === 'right') return select(cards[Math.min(cards.length - 1, i + 1)]);

  const r = cur.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  let best = null;
  let bestScore = Infinity;
  for (const c of cards) {
    if (c === cur) continue;
    const rr = c.getBoundingClientRect();
    const dy = dir === 'down' ? rr.top - r.bottom : r.top - rr.bottom;
    if (dy < -5) continue;
    const score = dy * 4 + Math.abs(rr.left + rr.width / 2 - cx);
    if (score < bestScore) { bestScore = score; best = c; }
  }
  if (best) select(best);
}

function findTab(tabId) {
  for (const w of state.windows) {
    const t = w.tabs.find((x) => x.id === tabId);
    if (t) return t;
  }
  return null;
}

document.addEventListener('keydown', (e) => {
  const arrows = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  if (arrows[e.key]) {
    e.preventDefault();
    moveSelection(arrows[e.key]);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const t = findTab(state.selectedTabId);
    if (t) activate(t);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    if (filterEl.value) { filterEl.value = ''; render(); } else closeOverview();
  } else if (e.key === 'Backspace' && e.metaKey) {
    e.preventDefault();
    if (state.selectedTabId != null) closeTab(state.selectedTabId);
  } else if (document.activeElement !== filterEl && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
    filterEl.focus(); // start typing anywhere to filter
  }
});

filterEl.addEventListener('input', () => render());

// ---------- actions

function activate(tab) {
  chrome.runtime.sendMessage({ type: 'activate', tabId: tab.id, windowId: tab.windowId });
}

function closeOverview() {
  chrome.runtime.sendMessage({ type: 'close-overview' });
}

async function closeTab(tabId) {
  // Move the selection to a neighbour before the card disappears.
  const cards = visibleCards();
  const i = cards.findIndex((c) => +c.dataset.tabId === tabId);
  if (tabId === state.selectedTabId && i > -1) {
    const next = cards[i + 1] || cards[i - 1];
    state.selectedTabId = next ? +next.dataset.tabId : null;
  }
  try { await chrome.tabs.remove(tabId); } catch (e) { toast('Could not close that tab.'); }
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- drag to reorder / move between windows

function clearDropMarks() {
  document.querySelectorAll('.drop-before, .drop-after, .drop-end').forEach((c) => c.classList.remove('drop-before', 'drop-after', 'drop-end'));
}

function wireDrag(card, tab) {
  card.addEventListener('dragstart', (e) => {
    dragTabId = tab.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(tab.id));
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => {
    dragTabId = null;
    card.classList.remove('dragging');
    clearDropMarks();
  });
  card.addEventListener('dragover', (e) => {
    if (dragTabId == null || dragTabId === tab.id) return;
    e.preventDefault();
    e.stopPropagation();
    const r = card.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    clearDropMarks();
    card.classList.add(after ? 'drop-after' : 'drop-before');
  });
  card.addEventListener('drop', (e) => {
    if (dragTabId == null || dragTabId === tab.id) return;
    e.preventDefault();
    e.stopPropagation();
    const after = card.classList.contains('drop-after');
    clearDropMarks();
    moveTab(dragTabId, tab, after);
  });
}

function wireGridDrop(grid, windowId) {
  grid.addEventListener('dragover', (e) => {
    if (dragTabId == null) return;
    e.preventDefault();
    clearDropMarks();
    grid.classList.add('drop-end');
  });
  grid.addEventListener('dragleave', (e) => {
    if (!grid.contains(e.relatedTarget)) grid.classList.remove('drop-end');
  });
  grid.addEventListener('drop', async (e) => {
    if (dragTabId == null) return;
    e.preventDefault();
    clearDropMarks();
    const id = dragTabId;
    try {
      await chrome.tabs.move(id, { windowId, index: -1 });
      const t = await chrome.tabs.get(id);
      if (t.groupId > -1) await chrome.tabs.ungroup(id);
    } catch (err) { toast('Could not move that tab (pinned tabs stay with pinned tabs).'); }
  });
}

async function moveTab(tabId, target, after) {
  try {
    const src = await chrome.tabs.get(tabId);
    let index = target.index + (after ? 1 : 0);
    if (src.windowId === target.windowId && src.index < index) index -= 1;
    await chrome.tabs.move(tabId, { windowId: target.windowId, index });
    // Join the target's tab group, or leave a group when dropped among ungrouped tabs.
    if (target.groupId > -1) await chrome.tabs.group({ groupId: target.groupId, tabIds: tabId });
    else if (src.groupId > -1) await chrome.tabs.ungroup(tabId);
    state.selectedTabId = tabId;
  } catch (err) {
    toast('Could not move that tab (pinned tabs stay with pinned tabs).');
  }
}

// ---------- refresh all

function showRefreshProgress(p) {
  const btn = $('#refresh');
  if (p && p.total) {
    btn.disabled = true;
    btn.textContent = `Capturing ${p.done}/${p.total}…`;
  } else {
    btn.disabled = false;
    btn.textContent = 'Refresh all';
  }
}

$('#refresh').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'refresh-all', includeSleeping: $('#includeSleeping').checked });
});

// ---------- settings (card size, sleeping-tab toggle)

async function loadSettings() {
  const { cardWidth = 260, includeSleeping = true } = await chrome.storage.local.get(['cardWidth', 'includeSleeping']);
  $('#size').value = cardWidth;
  document.documentElement.style.setProperty('--card-min', cardWidth + 'px');
  $('#includeSleeping').checked = includeSleeping;
}
$('#size').addEventListener('input', (e) => {
  document.documentElement.style.setProperty('--card-min', e.target.value + 'px');
  chrome.storage.local.set({ cardWidth: +e.target.value });
});
$('#includeSleeping').addEventListener('change', (e) => chrome.storage.local.set({ includeSleeping: e.target.checked }));

// ---------- live updates

let reloadTimer = null;
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(load, 120);
}

chrome.tabs.onCreated.addListener(scheduleReload);
chrome.tabs.onRemoved.addListener(scheduleReload);
chrome.tabs.onMoved.addListener(scheduleReload);
chrome.tabs.onAttached.addListener(scheduleReload);
chrome.tabs.onDetached.addListener(scheduleReload);
chrome.tabs.onActivated.addListener(scheduleReload);
chrome.tabs.onUpdated.addListener((id, info) => {
  if ('title' in info || 'favIconUrl' in info || 'groupId' in info || 'pinned' in info || 'url' in info || 'discarded' in info) scheduleReload();
});
chrome.tabGroups.onUpdated.addListener(scheduleReload);
chrome.tabGroups.onRemoved.addListener(scheduleReload);

chrome.storage.session.onChanged.addListener((changes) => {
  for (const [k, { newValue }] of Object.entries(changes)) {
    if (k === 'refresh') { showRefreshProgress(newValue); continue; }
    if (!k.startsWith('t:')) continue;
    const id = k.slice(2);
    if (newValue) state.thumbs[id] = newValue.img; else delete state.thumbs[id];
    const card = document.querySelector(`.card[data-tab-id="${CSS.escape(id)}"]`);
    if (!card || !newValue) continue;
    const thumb = card.querySelector('.thumb');
    let img = thumb.querySelector('img.shot');
    if (!img) {
      img = el('img', 'shot');
      img.alt = '';
      thumb.replaceChildren(img);
    }
    img.src = newValue.img;
  }
});

loadSettings().then(load).then(() => filterEl.focus());
