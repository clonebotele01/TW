try {
  if (window.ScriptAPI && typeof ScriptAPI.register === 'function') {
    ScriptAPI.register('BuildingRedMulti', true, 'clonebotele01', 'World 155 utility');
  }
} catch (e) {
  console.warn('[BuildingRedMulti] ScriptAPI registration skipped', e);
}

window.BuildingRedMulti = window.BuildingRedMulti || {};
window.BuildingRedMulti.Main = (function () {
  const ID = 'br2_panel';
  const SETTINGS_KEY = 'buildingred_v2_settings_v1';

  let requestChain = Promise.resolve();
  let nextRequestAt = 0;
  let rows = [];

  const now = () => Date.now();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dec = s => { try { return decodeURIComponent(String(s || '').replace(/\+/g, ' ')); } catch { return String(s || '').replace(/\+/g, ' '); } };
  const n = x => parseInt(String(x || '').replace(/[^\d-]/g, ''), 10) || 0;

  function status(text) {
    const el = document.getElementById('br2_status');
    if (el) el.textContent = text;
  }

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; }
    catch { return {}; }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      minHours: Math.max(0, +document.getElementById('br2_min_hours')?.value || 0),
      minMinutes: Math.max(0, +document.getElementById('br2_min_minutes')?.value || 0),
      maxVillages: Math.max(1, +document.getElementById('br2_max_villages')?.value || 200),
      requestGap: Math.max(250, +document.getElementById('br2_gap')?.value || 400),
      forceSpend: document.getElementById('br2_force')?.checked !== false,
    }));
  }

  function thresholdSeconds() {
    const hours = Math.max(0, +document.getElementById('br2_min_hours')?.value || 0);
    const minutes = Math.max(0, +document.getElementById('br2_min_minutes')?.value || 0);
    return hours * 3600 + minutes * 60;
  }

  function queueRequest(work) {
    const gap = Math.max(250, +document.getElementById('br2_gap')?.value || 400);
    requestChain = requestChain.catch(() => {}).then(() => new Promise((resolve, reject) => {
      const delay = Math.max(0, nextRequestAt - now());
      nextRequestAt = Math.max(nextRequestAt, now()) + gap;
      setTimeout(() => {
        try { Promise.resolve(work()).then(resolve, reject); }
        catch (e) { reject(e); }
      }, delay);
    }));
    return requestChain;
  }

  function fetchText(url) {
    return queueRequest(() => fetch(url, { credentials: 'same-origin' }).then(r => {
      if (!r.ok) throw Error(`${r.status} ${url}`);
      return r.text();
    }));
  }

  function parseDurationSeconds(text) {
    const raw = String(text || '').trim().toLowerCase();
    if (!raw) return null;

    let days = 0;
    const dayMatch = raw.match(/(\d+)\s*(?:d|day|days|tag|tage)/);
    if (dayMatch) days = +dayMatch[1];

    const clock = raw.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (clock) {
      const a = +clock[1];
      const b = +clock[2];
      const c = clock[3] == null ? null : +clock[3];
      return days * 86400 + (c == null ? a * 60 + b : a * 3600 + b * 60 + c);
    }

    const h = (raw.match(/(\d+)\s*(?:h|hour|hours|std)/) || [0, 0])[1];
    const m = (raw.match(/(\d+)\s*(?:m|min|minute|minutes)/) || [0, 0])[1];
    const s = (raw.match(/(\d+)\s*(?:s|sec|second|seconds)/) || [0, 0])[1];
    const total = days * 86400 + (+h || 0) * 3600 + (+m || 0) * 60 + (+s || 0);
    return total > 0 ? total : null;
  }

  function formatDuration(seconds) {
    if (seconds == null) return '?';
    seconds = Math.max(0, Math.round(seconds));
    const d = Math.floor(seconds / 86400);
    seconds %= 86400;
    const h = Math.floor(seconds / 3600);
    seconds %= 3600;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return (d ? d + 'd ' : '') + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function tableHeaderMap(row) {
    const table = row.closest('table');
    if (!table) return {};
    const headerRow = [...table.querySelectorAll('tr')].find(tr => tr.querySelector('th'));
    const headers = [...(headerRow?.querySelectorAll('th') || [])].map(th => th.textContent.trim().toLowerCase());
    return {
      construction: headers.findIndex(h => /construction|building/.test(h)),
      duration: headers.findIndex(h => /duration/.test(h)),
      speed: headers.findIndex(h => /speed\s*up|speed|reduce/.test(h)),
    };
  }

  function cellByHeader(row, key, fallbackIndex) {
    const cells = [...row.querySelectorAll('td')];
    const map = tableHeaderMap(row);
    const index = map[key] >= 0 ? map[key] : fallbackIndex;
    return cells[index] || null;
  }

  function constructionCell(row) {
    return cellByHeader(row, 'construction', 0);
  }

  function durationCell(row) {
    return cellByHeader(row, 'duration', -1);
  }

  function speedCell(row) {
    return cellByHeader(row, 'speed', -1);
  }

  function readRemainingSeconds(row) {
    const parsedDuration = parseDurationSeconds(durationCell(row)?.textContent);
    if (parsedDuration != null) return parsedDuration;

    const endNode = row.querySelector('[data-endtime], [data-end-time], [data-finish], [data-completion]');
    if (endNode) {
      const raw = endNode.getAttribute('data-endtime') || endNode.getAttribute('data-end-time') || endNode.getAttribute('data-finish') || endNode.getAttribute('data-completion');
      const val = n(raw);
      if (val > 0) {
        const ms = val > 100000000000 ? val : val * 1000;
        return Math.max(0, Math.ceil((ms - now()) / 1000));
      }
    }

    const timer = row.querySelector('.timer, .timer_replace, [class*="timer"], .build_duration, .queue_duration');
    return parseDurationSeconds(timer?.textContent);
  }

  function isReductionControl(el) {
    const img = el.querySelector?.('img');
    const hay = [
      el.textContent,
      el.getAttribute?.('title'),
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('href'),
      el.getAttribute?.('onclick'),
      img?.getAttribute('title'),
      img?.getAttribute('alt'),
      img?.getAttribute('src'),
    ].join(' ').toLowerCase();
    const mentionsHalf = /50\s*%|halve|half/.test(hay);
    const mentionsBuild = /build|construction|duration|time|reduce|reduc|shorten|premium|coin|pp/.test(hay);
    return mentionsHalf && mentionsBuild;
  }

  function findReductionControl(row) {
    const cell = speedCell(row);
    return [...(cell || row).querySelectorAll('a, button')].find(isReductionControl) || null;
  }

  function reductionUrl(control, baseUrl) {
    const href = control?.getAttribute?.('href') || '';
    if (!href || href === '#') return '';
    if (/^javascript:/i.test(href)) return '';
    try { return new URL(href, baseUrl).href; } catch { return ''; }
  }

  function rowLabel(row, index) {
    const source = constructionCell(row) || row;
    const clone = source.cloneNode(true);
    clone.querySelectorAll('a, button, .timer, .timer_replace, [class*="timer"], .build_duration, .queue_duration').forEach(el => {
      if (isReductionControl(el) || parseDurationSeconds(el.textContent) != null || /cancel|destroy|50\s*%/i.test(el.textContent || '')) el.remove();
    });
    const img = clone.querySelector('img[title], img[alt]');
    const imgText = img?.getAttribute('title') || img?.getAttribute('alt');
    if (imgText) return imgText.trim();
    const text = clone.textContent.replace(/\s+/g, ' ').replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, '').replace(/50\s*%/g, '').trim();
    return text ? text.slice(0, 80) : 'Queue item ' + (index + 1);
  }

  function parseVillageTxt(txt) {
    const ownId = String(window.game_data?.player?.id || '');
    return txt.trim().split(/\n+/).flatMap(line => {
      const q = line.split(',');
      if (String(q[4] || '') !== ownId) return [];
      return [{
        id: String(q[0]),
        name: dec(q[1]),
        coord: `${+q[2]}|${+q[3]}`,
        points: +q[5] || 0,
      }];
    });
  }

  function visibleVillagesFromSwitcher() {
    const out = {};
    document.querySelectorAll('a[href*="village="]').forEach(a => {
      try {
        const url = new URL(a.href, location.href);
        const id = url.searchParams.get('village');
        if (!id) return;
        const text = a.textContent.replace(/\s+/g, ' ').trim();
        const coord = (text.match(/\d{1,3}\|\d{1,3}/) || [''])[0];
        out[id] = { id, name: text || 'Village ' + id, coord, points: 0 };
      } catch {}
    });
    return Object.values(out);
  }

  async function getOwnVillages() {
    const max = Math.max(1, +document.getElementById('br2_max_villages')?.value || 200);
    try {
      const txt = await fetchText(location.origin + '/map/village.txt');
      const mapVillages = parseVillageTxt(txt);
      if (mapVillages.length) return mapVillages.slice(0, max);
    } catch (e) {
      console.warn('[BuildingRedMulti] village.txt failed; using visible switcher links', e);
    }
    return visibleVillagesFromSwitcher().slice(0, max);
  }

  function parseQueue(doc, village, pageUrl) {
    const seen = new Set();
    const candidates = [];
    const selectors = [
      '#buildqueue tr',
      '#build_queue tr',
      '#construction_queue tr',
      '#buildqueue_wrap tr',
      'table.vis tr',
    ];

    selectors.forEach(sel => doc.querySelectorAll(sel).forEach(row => {
      if (seen.has(row)) return;
      seen.add(row);
      if (!durationCell(row) && row.querySelector('th')) return;
      const remaining = readRemainingSeconds(row);
      if (remaining == null) return;
      const control = findReductionControl(row);
      const actionUrl = reductionUrl(control, pageUrl);
      if (!control && !row.querySelector('.timer, .timer_replace, [class*="timer"], .build_duration, .queue_duration, [data-endtime], [data-end-time], [data-finish], [data-completion]')) return;
      candidates.push({
        villageId: village.id,
        villageName: village.name,
        villageCoord: village.coord,
        pageUrl,
        name: rowLabel(row, candidates.length),
        remaining,
        hasControl: !!control,
        actionUrl,
      });
    }));

    return candidates;
  }

  function eligibleRows() {
    const threshold = thresholdSeconds();
    return rows.filter(r => r.remaining != null && r.remaining > threshold && r.hasControl);
  }

  function render() {
    const threshold = thresholdSeconds();
    const eligible = eligibleRows();
    const body = rows.map((r, i) => `<tr style="background:${i % 2 ? '#fff8e8' : '#f7ebcd'}">
      <td>${i + 1}</td>
      <td>${esc(r.villageCoord || r.villageName || r.villageId)}</td>
      <td>${esc(r.name)}</td>
      <td>${formatDuration(r.remaining)}</td>
      <td>${r.remaining > threshold ? 'YES' : '-'}</td>
      <td>${r.hasControl ? (r.actionUrl ? 'URL' : 'PAGE') : '-'}</td>
      <td><button data-br2-open="${esc(r.pageUrl)}">Open</button></td>
    </tr>`).join('');

    document.getElementById('br2_results').innerHTML = `<table style="width:100%;border-collapse:collapse;background:#fff8e8">
      <tr style="background:#d2b06d"><th>#</th><th>Village</th><th>Building</th><th>Remaining</th><th>Over min</th><th>50%</th><th>Page</th></tr>
      ${body || '<tr><td colspan="7">No construction queues found.</td></tr>'}
    </table>`;

    document.querySelectorAll('[data-br2-open]').forEach(b => {
      b.onclick = () => { location.href = b.getAttribute('data-br2-open'); };
    });
    document.getElementById('br2_quick').disabled = !eligible.length;
  }

  async function scanAll() {
    saveSettings();
    rows = [];
    render();
    const villages = await getOwnVillages();
    status(`Scanning ${villages.length} village(s)...`);

    for (let i = 0; i < villages.length; i++) {
      const v = villages[i];
      const pageUrl = `${location.origin}/game.php?village=${encodeURIComponent(v.id)}&screen=main`;
      status(`Scanning ${i + 1}/${villages.length}: ${v.coord || v.name || v.id}`);
      try {
        const html = await fetchText(pageUrl);
        const doc = new DOMParser().parseFromString(html, 'text/html');
        rows.push(...parseQueue(doc, v, pageUrl));
        rows.sort((a, b) => b.remaining - a.remaining);
        render();
      } catch (e) {
        console.warn('[BuildingRedMulti] scan failed', v, e);
      }
    }

    const eligible = eligibleRows();
    status(`Scan done. ${rows.length} queue item(s), ${eligible.length} eligible over ${formatDuration(thresholdSeconds())}.`);
  }

  function quickReduce() {
    const item = eligibleRows().sort((a, b) => b.remaining - a.remaining)[0];
    if (!item) {
      render();
      return status('No eligible building found. Scan all villages first.');
    }

    const forceSpend = document.getElementById('br2_force')?.checked !== false;
    if (!forceSpend) {
      const ok = confirm(`Use 50% premium reduction for:\n\n${item.villageCoord || item.villageName || item.villageId}\n${item.name}\nRemaining: ${formatDuration(item.remaining)}\n\nThis may spend Premium Points.`);
      if (!ok) return;
    }

    if (item.actionUrl) {
      status(`Opening 50% reduction URL for ${item.villageCoord || item.villageName || item.villageId} / ${item.name}.`);
      location.href = item.actionUrl;
      return;
    }

    status(`This 50% control is page-bound. Opening ${item.villageCoord || item.villageName || item.villageId}; run BuildingRed there or use the page button.`);
    location.href = item.pageUrl;
  }

  function init() {
    document.getElementById(ID)?.remove();
    const s = loadSettings();
    const panel = document.createElement('div');
    panel.id = ID;
    panel.style.cssText = 'position:fixed;z-index:2147483647;top:70px;right:20px;width:min(96vw,1040px);max-height:84vh;overflow:auto;background:#f4e4bc;color:#2b1a0f;border:2px solid #7d510f;box-shadow:0 8px 30px #0008;font:12px Verdana,Arial;padding:6px';
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;background:#7d510f;color:white;padding:6px;margin:-6px -6px 8px -6px">
        <b>BuildingRed v2.0 multi-village</b><button id="br2_x">X</button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <label>Min h <input id="br2_min_hours" type="number" value="${s.minHours ?? Math.floor((s.minMinutes ?? 60) / 60)}" min="0" style="width:50px"></label>
        <label>Min m <input id="br2_min_minutes" type="number" value="${s.minHours == null ? ((s.minMinutes ?? 60) % 60) : (s.minMinutes ?? 0)}" min="0" max="59" style="width:50px"></label>
        <label>Max villages <input id="br2_max_villages" type="number" value="${s.maxVillages ?? 200}" min="1" style="width:60px"></label>
        <label>Gap ms <input id="br2_gap" type="number" value="${s.requestGap ?? 400}" min="250" style="width:60px"></label>
        <label><input id="br2_force" type="checkbox" ${s.forceSpend === false ? '' : 'checked'}> Force spend PP</label>
        <button id="br2_scan">Scan all villages</button>
        <button id="br2_quick">Quick 50%</button>
      </div>
      <pre id="br2_status" style="background:#fff8e8;border:1px solid #c9a45c;padding:6px;white-space:pre-wrap">Ready. Quick 50% spends one reduction per click.</pre>
      <div id="br2_results"></div>
    `;
    document.body.appendChild(panel);
    document.getElementById('br2_x').onclick = () => panel.remove();
    document.getElementById('br2_scan').onclick = scanAll;
    document.getElementById('br2_quick').onclick = quickReduce;
    ['br2_min_hours','br2_min_minutes','br2_max_villages','br2_gap','br2_force'].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => { saveSettings(); render(); });
    });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || !document.getElementById(ID)) return;
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      e.preventDefault();
      quickReduce();
    });
    saveSettings();
    render();
  }

  return { init };
})();

(() => window.BuildingRedMulti.Main.init())();
