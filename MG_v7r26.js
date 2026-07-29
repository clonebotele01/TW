// MapGod v7r26: optional yellow/unknown farming, own-home troop budgeting, full FA sync and live commands.
try {
  if (window.ScriptAPI && typeof ScriptAPI.register === 'function') {
    ScriptAPI.register('MapGodQuickbar', true, 'clonebotele01', 'World 155 utility');
  }
} catch (e) {
  console.warn('[MapGodQuickbar] ScriptAPI registration skipped', e);
}

window.MapGodQuickbar = window.MapGodQuickbar || {};
window.MapGodQuickbar.Main = (function () {
  const init = async function () {
  const ID = 'mgq_panel';
  const HISTORY_KEY = 'mapgod_sent_history_v1';
  const SETTINGS_KEY = 'mapgod_quickbar_settings_v1';
  const ARRIVAL_KEY = 'mapgod_planned_arrivals_v1';
  const UNIT_SPEEDS_KEY = 'mapgod_unit_speeds_v1';
  const TARGET_CACHE_KEY = 'mapgod_target_cache_v7r14';
  const ORIGIN_CACHE_KEY = 'mapgod_origin_cache_v7r24';
  const REPORT_SYNC_KEY = 'mapgod_report_sync_v1';
  const FA_IMPORT_GAP_MS = 450;
  const FA_IMPORT_MAX_PAGES = 100;
  const REPORT_SYNC_GAP_MS = 400;
  const REPORT_SYNC_MAX_PAGES = 5;
  const REPORT_SYNC_BOOTSTRAP_PAGES = 20;
  const COMMAND_SYNC_GAP_MS = 300;
  const COMMAND_SYNC_MAX_PAGES = 100;
  const TARGET_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
  const ORIGIN_CACHE_TTL_MS = 2 * 60 * 1000;
  const PLAN_RENDER_PAGE_SIZE = 300;
  const CANDIDATE_POOL_MAX = 50000;
  const ORIGIN_IMPORT_GAP_MS = 300;
  const ORIGIN_IMPORT_MAX_PAGES = 80;
  const FORCE_SEND = true;
  const INCLUDE_BONUS = true;
  const INCLUDE_BARB = true;
  const currentScreen = window.game_data?.screen || new URLSearchParams(location.search).get('screen');
  if (currentScreen !== 'am_farm') {
    const farmUrl = window.TribalWars?.buildURL
      ? TribalWars.buildURL('GET', 'am_farm')
      : (window.game_data?.link_base_pure ? window.game_data.link_base_pure + 'am_farm' : location.origin + '/game.php?screen=am_farm');
    location.href = farmUrl;
    return;
  }
  document.getElementById(ID)?.remove();
  const settings = loadSettings();

  const panel = document.createElement('div');
  panel.id = ID;
  panel.style.cssText = 'position:fixed;z-index:2147483647;top:70px;right:20px;width:min(96vw,760px);max-height:82vh;overflow:auto;background:#f4e4bc;color:#2b1a0f;border:2px solid #7d510f;box-shadow:0 8px 30px #0008;font:12px Verdana,Arial;padding:6px';
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;background:#7d510f;color:white;padding:6px;margin:-10px -10px 10px -10px">
      <b>MG V7R26 multi-cache</b><button id="mgq_x">X</button>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
      <label>Org <input id="mgq_origin" value="${window.game_data?.village?.coord || '481|412'}" style="width:80px"></label>
      <label>Org ID <input id="mgq_origin_id" value="${window.game_data?.village?.id || ''}" style="width:70px"></label>
      <label>Dist <input id="mgq_dist" type="number" value="${settings.dist ?? 20}" style="width:50px"></label>
      <label>Lim <input id="mgq_limit" type="number" value="${settings.limit ?? 100}" style="width:55px"></label>
      <label>CD <input id="mgq_cd" type="number" value="${settings.cd ?? 30}" style="width:45px"></label>
      <label>Group <input id="mgq_group" type="number" value="${settings.group ?? 0}" style="width:55px"></label>
      <label><input id="mgq_hide_cd" type="checkbox" ${settings.hideCd !== false ? 'checked' : ''}> hide sent</label>
      <label><input id="mgq_farm_yellow" type="checkbox" ${settings.farmYellow ? 'checked' : ''}> Farm yellow</label>
      <label><input id="mgq_farm_unknown" type="checkbox" ${settings.farmUnknown !== false ? 'checked' : ''}> Farm unknown</label>
      <button id="mgq_scan">Scan</button>
      <button id="mgq_multi">Multi</button>
      <button id="mgq_refresh">Refresh cache</button>
      <button id="mgq_quick_a">Quick A</button>
      <button id="mgq_quick_b">Quick B</button>
      <button id="mgq_quick_send">Quick send</button>
      <button id="mgq_copy">Copy</button>
      <button id="mgq_probe">Probe</button>
      <button id="mgq_import">Import all FA</button>
      <button id="mgq_clear">Clear</button>
    </div>
    <pre id="mgq_status" style="background:#fff8e8;border:1px solid #c9a45c;padding:6px;white-space:pre-wrap">Ready</pre>
    <div id="mgq_progress_wrap" style="display:none;margin:6px 0;background:#d8c08a;border:1px solid #7d510f;height:18px;position:relative">
      <div id="mgq_progress_bar" style="height:100%;width:0%;background:#6f9f2d"></div>
      <span id="mgq_progress_text" style="position:absolute;left:0;right:0;top:1px;text-align:center;font-size:11px;color:#1e160b">0%</span>
    </div>
    <div id="mgq_results"></div>
  `;
  document.body.appendChild(panel);
  document.getElementById('mgq_x').onclick = () => panel.remove();

  let last = [];
  let templates = {};
  let availableUnits = {};
  let unitSpeeds = {};
  let worldUnits = [];
  let targetCache = null;
  let originCache = null;
  let busy = false;
  let faImportBusy = false;
  let lastClickAt = 0;
  let planTotal = 0;
  let planDone = 0;
  let renderPage = 0;
  let renderModeLabel = '';
  let originTemplateBlocks = new Set();

  const dec = s => { try { return decodeURIComponent(String(s).replace(/\+/g, ' ')); } catch { return String(s).replace(/\+/g, ' '); } };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const coord = s => { const m = String(s).match(/(\d{1,3})\s*[|,;:\s]\s*(\d{1,3})/); return m ? { x: +m[1], y: +m[2] } : null; };
  const status = t => document.getElementById('mgq_status').textContent = t;
  const now = () => Date.now();
  const n = x => parseInt(String(x || '').replace(/[^\d-]/g, ''), 10) || 0;
  const hasNum = x => /\d/.test(String(x ?? ''));

  function setProgress(percent, text, show = true) {
    const wrap = document.getElementById('mgq_progress_wrap');
    const bar = document.getElementById('mgq_progress_bar');
    const label = document.getElementById('mgq_progress_text');
    const p = Math.max(0, Math.min(100, Math.round(percent || 0)));
    if (!wrap || !bar || !label) return;
    wrap.style.display = show ? 'block' : 'none';
    bar.style.width = p + '%';
    label.textContent = text || (p + '%');
  }

  function setPlanProgress(done, total) {
    planDone = Math.max(0, done || 0);
    planTotal = Math.max(0, total || 0);
    if (!planTotal) return setProgress(0, 'No planned targets', true);
    const remaining = Math.max(0, planTotal - planDone);
    setProgress((planDone / planTotal) * 100, `${planDone}/${planTotal} sent - ${remaining} left`, true);
  }

  function loadHistory() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}'); } catch { return {}; } }
  function saveHistory(h) { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); }
  function loadArrivals() { try { return JSON.parse(localStorage.getItem(ARRIVAL_KEY) || '{}'); } catch { return {}; } }
  function saveArrivals(h) { localStorage.setItem(ARRIVAL_KEY, JSON.stringify(h)); }
  function loadSettings() { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { return {}; } }
  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      dist: +document.getElementById('mgq_dist')?.value || 20,
      limit: +document.getElementById('mgq_limit')?.value || 100,
      cd: +document.getElementById('mgq_cd')?.value || 0,
      group: +document.getElementById('mgq_group')?.value || 0,
      hideCd: !!document.getElementById('mgq_hide_cd')?.checked,
      farmYellow: !!document.getElementById('mgq_farm_yellow')?.checked,
      farmUnknown: !!document.getElementById('mgq_farm_unknown')?.checked,
    }));
  }
  function historyKey(originId, targetId) { return originId ? `${originId}:${targetId}` : String(targetId); }
  function historyEntry(hist, originId, targetId) {
    const keyed = hist[historyKey(originId, targetId)];
    if (keyed) return keyed;
    const legacy = hist[targetId];
    if (originId && histInfo(legacy).src === 'fa') return null;
    return legacy;
  }
  function latestTargetReportEntry(hist, targetId) {
    let best = null;
    const suffix = ':' + targetId;
    Object.entries(hist || {}).forEach(([key, value]) => {
      const hi = histInfo(value);
      if (key !== String(targetId) && !key.endsWith(suffix)) return;
      if (!hi.coord || (!hi.dot && !hi.result && !hi.loot && !hi.full)) return;
      const proof = compareHistoryProof(hi, best);
      if (!best || proof > 0 || (proof === 0 && histTime(hi) > histTime(best))) best = hi;
    });
    return best;
  }
  function buildLatestTargetReportMap(hist) {
    const latest = new Map();
    Object.entries(hist || {}).forEach(([key, value]) => {
      const hi = histInfo(value);
      if (!hi.coord || (!hi.dot && !hi.result && !hi.loot && !hi.full)) return;
      const targetId = String(key).includes(':') ? String(key).split(':').pop() : String(key);
      const best = latest.get(targetId);
      const proof = compareHistoryProof(hi, best);
      if (!best || proof > 0 || (proof === 0 && histTime(hi) > histTime(best))) latest.set(targetId, hi);
    });
    return latest;
  }
  function markSent(targetId, originId) {
    const h = loadHistory();
    const key = historyKey(originId, targetId);
    h[key] = { ...(histInfo(h[key])), t: now(), src: 'mapgod', originId: String(originId || '') };
    saveHistory(h);
  }
  function markTargetBlocked(target, reason) {
    if (!target?.id) return;
    const h = loadHistory();
    h[target.id] = { ...(typeof h[target.id] === 'object' ? h[target.id] : {}), t: now(), seen: now(), coord: target.coord, result: 'blocked', dot: 'red', reason, src: 'mapgod' };
    saveHistory(h);
  }
  function minutesAgo(ts) { return Math.floor((now() - ts) / 60000); }
  function historyAgeLabel(hi) {
    const info = histInfo(hi);
    const timestamp = +info.reportAt || +info.seen || +info.t || 0;
    if (!timestamp) return 'age ?';
    const age = Math.max(0, minutesAgo(timestamp));
    return (+info.reportAt ? 'report ' : 'seen ') + age + 'm';
  }

  async function loadUnitSpeeds() {
    if (Object.keys(unitSpeeds).length) {
      if (!worldUnits.length) worldUnits = Object.keys(unitSpeeds);
      return unitSpeeds;
    }
    try { unitSpeeds = JSON.parse(localStorage.getItem(UNIT_SPEEDS_KEY) || '{}'); } catch { unitSpeeds = {}; }
    if (Object.keys(unitSpeeds).length) {
      worldUnits = Object.keys(unitSpeeds);
      return unitSpeeds;
    }
    const xml = await fetch(location.origin + '/interface.php?func=get_unit_info', { credentials: 'same-origin' }).then(r => {
      if (!r.ok) throw Error('unit info HTTP ' + r.status);
      return r.text();
    });
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    [...doc.querySelectorAll('config > *')].forEach(el => {
      const speed = parseFloat(el.querySelector('speed')?.textContent || '');
      worldUnits.push(el.nodeName);
      if (Number.isFinite(speed)) unitSpeeds[el.nodeName] = speed;
    });
    localStorage.setItem(UNIT_SPEEDS_KEY, JSON.stringify(unitSpeeds));
    return unitSpeeds;
  }

  function getWorldUnits() {
    const fromGame = Array.isArray(window.game_data?.units) ? window.game_data.units : [];
    return [...new Set((fromGame.length ? fromGame : (worldUnits.length ? worldUnits : Object.keys(unitSpeeds))).filter(Boolean))];
  }

  function templateSpeed(templateName) {
    const tpl = templates[templateName];
    if (!tpl) return null;
    const speeds = Object.keys(tpl.units || {}).map(unit => unitSpeeds[unit]).filter(Number.isFinite);
    return speeds.length ? Math.max(...speeds) : null;
  }

  function estimateArrivalAt(target, templateName) {
    const speed = templateSpeed(templateName);
    return speed == null ? null : now() + target.d * speed * 60000;
  }

  function activeArrivals(targetId, cooldownMin) {
    const all = loadArrivals();
    const keepAfter = now() - Math.max(0, cooldownMin) * 60000;
    const list = (all[targetId] || []).filter(x => x && x.arrivalAt >= keepAfter);
    if (list.length) all[targetId] = list;
    else delete all[targetId];
    saveArrivals(all);
    return list;
  }

  function arrivalConflict(targetId, arrivalAt, cooldownMin) {
    if (!arrivalAt || cooldownMin <= 0) return null;
    const windowMs = cooldownMin * 60000;
    return activeArrivals(targetId, cooldownMin).find(x => Math.abs(x.arrivalAt - arrivalAt) < windowMs) || null;
  }

  function prepareActiveArrivalMap(cooldownMin) {
    const all = loadArrivals();
    const keepAfter = now() - Math.max(0, cooldownMin) * 60000;
    let changed = false;
    Object.keys(all).forEach(targetId => {
      const list = (all[targetId] || []).filter(x => x && x.arrivalAt >= keepAfter);
      if (list.length) {
        if (list.length !== (all[targetId] || []).length) changed = true;
        all[targetId] = list;
      } else {
        delete all[targetId];
        changed = true;
      }
    });
    if (changed) saveArrivals(all);
    return all;
  }

  function arrivalConflictFromMap(arrivals, targetId, arrivalAt, cooldownMin) {
    if (!arrivalAt || cooldownMin <= 0) return null;
    const windowMs = cooldownMin * 60000;
    return (arrivals?.[targetId] || []).find(x => Math.abs(x.arrivalAt - arrivalAt) < windowMs) || null;
  }

  function markArrival(target, templateName, originId, arrivalAt, originCoord) {
    if (!arrivalAt) return;
    const all = loadArrivals();
    const list = activeArrivals(target.id, +document.getElementById('mgq_cd').value || 0);
    list.push({ arrivalAt, sentAt: now(), originId: String(originId), originCoord: originCoord || document.getElementById('mgq_origin').value, template: templateName });
    all[target.id] = list;
    saveArrivals(all);
  }

  function arrivalLabel(arrivalAt) {
    if (!arrivalAt) return '?';
    return Math.max(0, Math.round((arrivalAt - now()) / 60000)) + 'm';
  }


  function histTime(v) { return typeof v === 'number' ? v : (v && v.t) || 0; }
  function histInfo(v) { return typeof v === 'object' && v ? v : {}; }
  function normalizedEpoch(value) {
    const nValue = Number(value);
    if (!Number.isFinite(nValue) || nValue <= 0) return 0;
    if (nValue > 1e12) return Math.round(nValue);
    if (nValue > 1e9) return Math.round(nValue * 1000);
    return 0;
  }
  function historyTimestampFromElement(el) {
    if (!el) return 0;
    const timed = el.querySelector('[data-timestamp], [data-time], [data-report-time], time[datetime]');
    if (!timed) return 0;
    for (const attr of ['data-timestamp', 'data-time', 'data-report-time']) {
      const timestamp = normalizedEpoch(timed.getAttribute(attr));
      if (timestamp) return timestamp;
    }
    const parsed = Date.parse(timed.getAttribute('datetime') || '');
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function hasHistoryStatus(entry) {
    const hi = histInfo(entry);
    return !!(hi.dot || hi.result || hi.loot || hi.full || hi.partial);
  }
  function compareHistoryProof(a, b) {
    const aa = histInfo(a);
    const bb = histInfo(b);
    const aId = +aa.reportId || 0;
    const bId = +bb.reportId || 0;
    if (aId || bId) {
      if (aId && bId) return Math.sign(aId - bId);
      return aId ? 1 : -1;
    }
    const aAt = +aa.reportAt || 0;
    const bAt = +bb.reportAt || 0;
    if (aAt || bAt) {
      if (aAt && bAt) return Math.sign(aAt - bAt);
      return aAt ? 1 : -1;
    }
    return 0;
  }
  function reportIdFromUrl(url) {
    try { return +(new URL(url || '', location.href).searchParams.get('view') || 0); }
    catch { return 0; }
  }
  function mergeHistoryEntry(h, key, entry) {
    const previous = histInfo(h[key]);
    const proof = compareHistoryProof(entry, previous);
    const sameReport = (+entry.reportId || 0) && (+entry.reportId || 0) === (+previous.reportId || 0);
    const sameTimestamp = (+entry.reportAt || 0) && (+entry.reportAt || 0) === (+previous.reportAt || 0);
    const authoritativeLiveFA = !!entry.liveFA && !(+previous.reportId || +previous.reportAt);
    if (hasHistoryStatus(previous) && proof < 0) return false;
    if (hasHistoryStatus(previous) && proof === 0 && !sameReport && !sameTimestamp && !authoritativeLiveFA) {
      // Without a newer report ID or actual timestamp, import order is not
      // evidence. Keep the established result instead of silently replacing it.
      return false;
    }
    h[key] = {
      ...previous,
      ...entry,
      sources: [...new Set([...(previous.sources || (previous.src ? [previous.src] : [])), entry.src].filter(Boolean))],
      // A report overview does not always contain a haul icon. In that case,
      // a provably newer result must make haul unknown, not inherit an older haul.
      ...(entry.lootKnown ? { loot: entry.loot, full: entry.loot } : {
        loot: proof > 0 ? false : previous.loot,
        full: proof > 0 ? false : previous.full,
        lootKnown: proof > 0 ? false : previous.lootKnown,
      }),
    };
    return true;
  }
  function resultLabel(hi){ const r=hi.result||''; const d=hi.dot||''; if(r==='win'||d==='green')return '✅'; if(r==='losses'||d==='yellow'||d==='red_yellow')return '⚠️'; if(r==='defeat'||d==='red')return '❌'; if(d==='blue')return '🔎'; if(d==='red_blue')return '❌🔎'; return ''; }
  function haulLabel(hi){ if(hi.full||hi.loot)return '📦'; if(hi.partial)return '📦'; if(hi.haul&&hi.haul!=='?')return '📦'; return ''; }
  function farmOriginIdFromUrl(url) {
    try { return new URL(url || location.href, location.href).searchParams.get('village') || String(window.game_data?.village?.id || ''); }
    catch { return String(window.game_data?.village?.id || ''); }
  }

  function importFAHistoryFrom(root, h, originId) {
    let c = 0;
    let seenRows = 0;
    let withTarget = 0;
    let withStatus = 0;
    let rejectedOlder = 0;
    const handled = new Set();
    const liveFA = root === document;
    const candidates = root.querySelectorAll(
      '#plunder_list tr[id^="village_"], #plunder_list [id^="village_"], ' +
      '#plunder_list tr[data-id], #plunder_list [data-village-id], ' +
      '#plunder_list .farm-row, #plunder_list .village-item'
    );
    candidates.forEach(candidate => {
      const el = candidate.closest('tr, [id^="village_"], .farm-row, .village-item') || candidate;
      if (handled.has(el)) return;
      handled.add(el);
      seenRows++;
      const idMatch = String(el.id || '').match(/village_(\d+)/);
      const directId = el.getAttribute('data-village-id') || el.getAttribute('data-id') || '';
      const villageLink = el.querySelector('a[href*="screen=info_village"][href*="id="]');
      let hrefId = '';
      try {
        hrefId = new URL(villageLink?.getAttribute('href') || '', location.href).searchParams.get('id') || '';
      } catch {}
      const id = String((idMatch && idMatch[1]) || directId || hrefId || '');
      if (!id) return;
      withTarget++;
      const coord = (el.textContent.match(/\d{1,3}\|\d{1,3}/) || [''])[0];
      const dotImage = el.querySelector('img[src*="/dots/"], img[src*="dots/"], img[class*="dot"]');
      const dotSource = [
        dotImage?.getAttribute('src'),
        dotImage?.getAttribute('class'),
        dotImage?.getAttribute('title'),
        dotImage?.getAttribute('alt'),
      ].filter(Boolean).join(' ');
      let dot = (dotSource.match(/(?:dots\/|dot[_-]?)(green|yellow|red_blue|red_yellow|red|blue)/i) || [, ''])[1].toLowerCase();
      if (!dot) {
        dot = (dotSource.match(/\b(green|yellow|red_blue|red_yellow|red|blue)\b/i) || [, ''])[1].toLowerCase();
      }
      const loot = !!el.querySelector('img[src*="max_loot/1"]');
      const reportLink = el.querySelector('a[href*="screen=report"][href*="view="]');
      const reportId = reportIdFromUrl(reportLink?.getAttribute('href'));
      const reportAt = historyTimestampFromElement(el);
      const result = dot==='green'?'win':dot==='yellow'||dot==='red_yellow'?'losses':dot==='red'?'defeat':dot;
      if (dot) withStatus++;
      const key = historyKey(originId, id);
      const observedAt = now();
      if (mergeHistoryEntry(h, key, { t: observedAt, seen: observedAt, reportAt, coord, dot, result, loot, full: loot, lootKnown: true, reportId, liveFA, src: 'fa', originId: String(originId || '') })) c++;
      else rejectedOlder++;
    });
    window.MapGodQuickbar.lastFAImport = {
      originId: String(originId || ''),
      candidates: candidates.length,
      rows: seenRows,
      withTarget,
      withStatus,
      imported: c,
      rejectedOlder,
    };
    console.log('[MapGodQuickbar] visible FA import', window.MapGodQuickbar.lastFAImport);
    return c;
  }

  function refreshVisibleFAHistory() {
    const h = loadHistory();
    if (document.querySelector('#plunder_list [id^="village_"], #plunder_list [data-village-id], #plunder_list .farm-row, #plunder_list .village-item')) {
      const rows = importFAHistoryFrom(document, h, farmOriginIdFromUrl(location.href));
      if (rows) saveHistory(h);
    }
    return h;
  }

  function parseWorldTargets(txt) {
    const rows = [];
    for (const line of String(txt || '').trim().split('\n')) {
      const q = line.split(',');
      if (q.length < 7) continue;
      const v = { id: +q[0], name: dec(q[1]), x: +q[2], y: +q[3], player: +q[4], points: +q[5] };
      if (v.player !== 0) continue;
      // Rune villages are server-owned (player=0), just like normal barbarians,
      // so the owner field alone cannot distinguish them.
      v.rune = /\brune\s+village\b/i.test(v.name);
      if (v.rune) continue;
      v.bonus = /bonus/i.test(v.name);
      v.coord = v.x + '|' + v.y;
      if ((v.bonus && INCLUDE_BONUS) || (!v.bonus && INCLUDE_BARB)) rows.push(v);
    }
    return rows;
  }

  function buildTargetSpatialIndex(targets, cellSize = 10) {
    const cells = new Map();
    for (let i = 0; i < targets.length; i++) {
      const v = targets[i];
      const key = Math.floor(v.x / cellSize) + '|' + Math.floor(v.y / cellSize);
      let bucket = cells.get(key);
      if (!bucket) cells.set(key, bucket = []);
      bucket.push(i);
    }
    return { cells, cellSize };
  }

  function forEachNearbyTargetIndex(origin, max, index, callback) {
    const size = index.cellSize;
    const minX = Math.floor((origin.x - max) / size);
    const maxX = Math.floor((origin.x + max) / size);
    const minY = Math.floor((origin.y - max) / size);
    const maxY = Math.floor((origin.y + max) / size);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        const bucket = index.cells.get(cx + '|' + cy);
        if (bucket) {
          for (let i = 0; i < bucket.length; i++) callback(bucket[i]);
        }
      }
    }
  }

  function pushBoundedCandidate(heap, item, cap) {
    if (heap.length < cap) {
      heap.push(item);
      let i = heap.length - 1;
      while (i > 0) {
        const p = Math.floor((i - 1) / 2);
        if (heap[p].d >= heap[i].d) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
      return;
    }
    if (!heap.length || item.d >= heap[0].d) return;
    heap[0] = item;
    let i = 0;
    while (true) {
      const left = i * 2 + 1;
      const right = left + 1;
      let largest = i;
      if (left < heap.length && heap[left].d > heap[largest].d) largest = left;
      if (right < heap.length && heap[right].d > heap[largest].d) largest = right;
      if (largest === i) break;
      [heap[i], heap[largest]] = [heap[largest], heap[i]];
      i = largest;
    }
  }

  async function loadTargets(force) {
    const cached = !force && (targetCache || (() => {
      try { return JSON.parse(localStorage.getItem(TARGET_CACHE_KEY) || 'null'); } catch { return null; }
    })());
    if (cached?.rows?.length && now() - cached.t < TARGET_CACHE_TTL_MS) {
      targetCache = cached;
      setProgress(100, `Target cache ready (${cached.rows.length})`, true);
      return cached.rows;
    }

    setProgress(5, 'Loading target cache...');
    status('Fetching target cache from ' + location.origin + '/map/village.txt ...');
    const txt = await fetch(location.origin + '/map/village.txt', { credentials: 'same-origin' }).then(r => {
      if (!r.ok) throw Error('map/village.txt HTTP ' + r.status);
      return r.text();
    });
    targetCache = { t: now(), rows: parseWorldTargets(txt) };
    try { localStorage.setItem(TARGET_CACHE_KEY, JSON.stringify(targetCache)); }
    catch (e) { console.warn('[MapGodQuickbar] target cache storage skipped', e); }
    setProgress(100, `Target cache ready (${targetCache.rows.length})`, true);
    return targetCache.rows;
  }

  function removeTargetFromCache(targetId) {
    if (!targetId) return;
    const cached = targetCache || (() => {
      try { return JSON.parse(localStorage.getItem(TARGET_CACHE_KEY) || 'null'); } catch { return null; }
    })();
    if (!cached?.rows?.length) return;
    const before = cached.rows.length;
    cached.rows = cached.rows.filter(v => String(v.id) !== String(targetId));
    if (cached.rows.length === before) return;
    targetCache = cached;
    try { localStorage.setItem(TARGET_CACHE_KEY, JSON.stringify(targetCache)); }
    catch (e) { console.warn('[MapGodQuickbar] target cache update skipped', e); }
  }

  function cacheAgeLabel(cache) {
    if (!cache?.t) return 'none';
    const mins = Math.floor((now() - cache.t) / 60000);
    return mins < 60 ? mins + 'm' : Math.floor(mins / 60) + 'h';
  }

  function unitObjectFromInputs($row) {
    const units = {};
    const known = getWorldUnits();
    const unitFromElement = (element, index) => {
      const $el = $(element);
      const direct = $el.attr('data-unit') || $el.data('unit') || '';
      if (direct) return String(direct);
      const classMatch = String($el.attr('class') || '').match(/(?:unit-item-|unit_)([a-z_]+)/);
      if (classMatch) return classMatch[1];
      const src = $el.find('img[src*="unit_"]').first().attr('src') || '';
      const srcMatch = src.match(/unit_([a-z_]+?)(?:@2x)?\.(?:webp|png|gif)/);
      return (srcMatch && srcMatch[1]) || known[index] || '';
    };

    $row.find('.unit-item').each((index, element) => {
      const unit = unitFromElement(element, index);
      if (!unit) return;
      units[unit] = n($(element).text());
    });

    // Some overview variants expose data-unit elements instead of unit-item.
    $row.find('[data-unit]').each((index, element) => {
      const unit = unitFromElement(element, index);
      if (!unit || Object.prototype.hasOwnProperty.call(units, unit)) return;
      const raw = $(element).attr('data-count') || $(element).val() || $(element).text();
      if (hasNum(raw)) units[unit] = n(raw);
    });

    // Final desktop fallback: match each row cell against its table header icon.
    if (!Object.keys(units).length) {
      const $table = $row.closest('table');
      const headerUnits = [];
      $table.find('tr').first().children('th,td').each((index, cell) => {
        const src = $(cell).find('img[src*="unit_"]').first().attr('src') || '';
        const match = src.match(/unit_([a-z_]+?)(?:@2x)?\.(?:webp|png|gif)/);
        if (match) headerUnits[index] = match[1];
      });
      $row.children('td,th').each((index, cell) => {
        const unit = headerUnits[index];
        if (!unit) return;
        const raw = $(cell).find('input').first().val() || $(cell).text();
        if (hasNum(raw)) units[unit] = n(raw);
      });
    }
    return units;
  }

  function unitObjectFromMobileCard($card) {
    const units = {};
    $card.find('.overview-units-row .unit-row-item, .unit-row-item').each((_, element) => {
      const $el = $(element);
      const src = $el.find('img').attr('src') || '';
      const unitMatch = src.match(/unit_([a-z_]+?)(?:@2x)?\.(?:webp|png|gif)/);
      const unit = unitMatch && unitMatch[1];
      if (!unit) return;
      const raw = $el.find('.unit-row-name, span').first().text() || $el.text();
      units[unit] = n(raw);
    });

    // Current responsive combined overview may use a small table per village
    // without unit-row-item classes. Locate each unit by its image instead.
    getWorldUnits().forEach(unit => {
      if (!unit || Object.prototype.hasOwnProperty.call(units, unit)) return;
      const $img = $card.find(
        `img[src*="/unit/unit_${unit}."], img[src*="/unit/unit_${unit}@"], ` +
        `img[src*="unit_${unit}.png"], img[src*="unit_${unit}.webp"]`
      ).first();
      if (!$img.length) return;
      const $container = $img.closest('tr').length ? $img.closest('tr') : $img.parent();
      const raw = $container.find('.unit-row-name, .unit-item, span').last().text() || $container.text();
      units[unit] = n(raw);
    });
    $card.find('img[src*="unit_"]').each((_, image) => {
      const src = $(image).attr('src') || '';
      const match = src.match(/unit_([a-z_]+?)(?:@2x)?\.(?:webp|png|gif)/);
      const unit = match && match[1];
      if (!unit || Object.prototype.hasOwnProperty.call(units, unit)) return;
      const $container = $(image).closest('tr').length ? $(image).closest('tr') : $(image).parent();
      const raw = $container.find('.unit-row-name, .unit-item, span').last().text() || $container.text();
      units[unit] = n(raw);
    });
    return units;
  }

  function parseDedicatedUnitsTable(root, out) {
    const table = root.querySelector('#units_table');
    if (!table) return { table: 0, rows: 0, headers: 0, added: 0 };
    const before = Object.keys(out).length;
    const headerUnits = new Map();
    const headerRows = [...table.querySelectorAll('thead tr, tr')];
    const headerRow = headerRows.find(row => row.querySelector('img[src*="unit_"]'));
    if (headerRow) {
      [...headerRow.children].forEach((cell, index) => {
        const src = cell.querySelector('img[src*="unit_"]')?.getAttribute('src') || '';
        const match = src.match(/unit_([a-z_]+?)(?:@2x)?\.(?:webp|png|gif)/);
        if (match) headerUnits.set(index, match[1]);
      });
    }

    const rows = [...table.querySelectorAll('tbody tr, tr.row_a, tr.row_b')]
      .filter((row, index, all) => all.indexOf(row) === index)
      .filter(row => !headerRow || row !== headerRow);
    rows.forEach(row => {
      const c = coord(row.textContent);
      if (!c) return;
      const vn = row.querySelector('.quickedit-vn');
      const checkbox = row.querySelector(
        'input.village_checkbox[value], input[name*="village"][value], input[name*="ids"][value]'
      );
      const rowMatch = String(row.id || '').match(/(?:village_)?(\d+)/);
      let hrefId = 0;
      const villageLink = row.querySelector('a[href*="village="], a[href*="screen=info_village"][href*="id="]');
      try {
        const url = new URL(villageLink?.getAttribute('href') || '', location.href);
        hrefId = n(url.searchParams.get('village') || url.searchParams.get('id'));
      } catch {}
      const id = n(vn?.getAttribute('data-id')) || n(checkbox?.value) || n(rowMatch && rowMatch[1]) || hrefId;
      if (!id) return;

      const cells = [...row.children];
      const units = {};
      headerUnits.forEach((unit, index) => {
        const cell = cells[index];
        if (!cell) return;
        const raw = cell.querySelector('input')?.value || cell.textContent;
        if (hasNum(raw)) units[unit] = n(raw);
      });
      if (!Object.keys(units).length) {
        Object.assign(units, unitObjectFromInputs($(row)));
      }
      const key = c.x + '|' + c.y;
      const label = row.querySelector('.quickedit-label');
      out[key] = {
        id,
        coord: key,
        x: c.x,
        y: c.y,
        name: label?.getAttribute('data-text') || label?.textContent?.trim() || key,
        units,
      };
    });
    return {
      table: 1,
      rows: rows.length,
      headers: headerUnits.size,
      added: Object.keys(out).length - before,
    };
  }

  function parseOriginsFromOverview(root, out) {
    const $root = $(root);
    const before = Object.keys(out).length;
    const unitsTableStats = parseDedicatedUnitsTable(root, out);
    const $desktopRows = $root.find('#combined_table .row_a, #combined_table .row_b');
    const $mobileCards = $root.find('.overview-container > div, .overview-container .village-item');
    $desktopRows.each((_, el) => {
      const $row = $(el);
      const $label = $row.find('.quickedit-label').first();
      const c = coord($label.text()) || coord($row.text());
      const $vn = $row.find('.quickedit-vn').first();
      const rowId = String($row.attr('id') || '').match(/(?:village_)?(\d+)/);
      const villageHref = $row.find('a[href*="village="], a[href*="screen=info_village"][href*="id="]').first().attr('href') || '';
      let hrefId = 0;
      try {
        const u = new URL(villageHref, location.href);
        hrefId = n(u.searchParams.get('village') || u.searchParams.get('id'));
      } catch {}
      const id = n($vn.attr('data-id') || $vn.data('id')) || n(rowId && rowId[1]) || hrefId;
      if (!c || !id) return;
      const key = c.x + '|' + c.y;
      out[key] = {
        id,
        coord: key,
        x: c.x,
        y: c.y,
        name: $label.data('text') || $label.text().replace(/\s*\(\d{1,3}\|\d{1,3}\).*/, '').trim() || key,
        units: unitObjectFromInputs($row),
      };
    });

    $mobileCards.each((_, el) => {
      const $card = $(el);
      const $label = $card.find('.quickedit-label').first();
      const c = coord($label.text()) || coord($card.text());
      const $vn = $card.find('.quickedit-vn').first();
      const cardId = String($card.attr('id') || '').match(/(?:village_)?(\d+)/);
      const id = n($vn.attr('data-id') || $vn.data('id')) || n(cardId && cardId[1]);
      if (!c || !id) return;
      const units = unitObjectFromMobileCard($card);
      if (!Object.keys(units).length) Object.assign(units, unitObjectFromInputs($card));
      const key = c.x + '|' + c.y;
      out[key] = {
        id,
        coord: key,
        x: c.x,
        y: c.y,
        name: $label.attr('data-text') || $label.data('text') || $label.text().replace(/\s*\(\d{1,3}\|\d{1,3}\).*/, '').trim() || key,
        units,
      };
    });
    return {
      desktopRows: $desktopRows.length,
      mobileCards: $mobileCards.length,
      unitItems: $root.find('.unit-item, .unit-row-item, [data-unit]').length,
      unitsTables: unitsTableStats.table,
      unitsTableRows: unitsTableStats.rows,
      unitsTableHeaders: unitsTableStats.headers,
      added: Object.keys(out).length - before,
    };
  }

  function overviewPageLinks(root, baseUrl, group, expectedMode = 'combined') {
    const links = new Set();
    const base = new URL(baseUrl, location.href);
    root.querySelectorAll('a[href]').forEach(a => {
      try {
        const url = new URL(a.getAttribute('href'), baseUrl);
        if (url.origin !== location.origin || url.searchParams.get('screen') !== 'overview_villages') return;
        if (url.searchParams.get('mode') !== expectedMode) return;
        if (group != null && String(url.searchParams.get('group') || '0') !== String(group)) return;
        if (url.searchParams.get('page') == null) return;
        url.hash = '';
        links.add(url.href);
      } catch {}
    });
    return [...links];
  }

  async function loadOrigins(force) {
    const group = +document.getElementById('mgq_group').value || 0;
    const cached = !force && (originCache || (() => {
      try { return JSON.parse(localStorage.getItem(ORIGIN_CACHE_KEY) || 'null'); } catch { return null; }
    })());
    const cacheHasUnits = cached?.rows?.some(o => o.units && Object.keys(o.units).length);
    if (cached?.group === group && cached?.unavailable && now() - cached.t < ORIGIN_CACHE_TTL_MS) {
      originCache = cached;
      setProgress(100, 'Origin overview unavailable; using current village', true);
      return cached.rows || [];
    }
    if (cached?.group === group && cached?.rows?.length && cacheHasUnits && now() - cached.t < ORIGIN_CACHE_TTL_MS) {
      originCache = cached;
      setProgress(100, `Origin cache ready (${cached.rows.length})`, true);
      return cached.rows;
    }

    const unitsUrl = TribalWars.buildURL
      ? TribalWars.buildURL('GET', 'overview_villages', { mode: 'units', type: 'own_home', group })
      : `${location.origin}/game.php?screen=overview_villages&mode=units&type=own_home&group=${group}`;
    const combinedUrl = TribalWars.buildURL
      ? TribalWars.buildURL('GET', 'overview_villages', { mode: 'combined', group })
      : `${location.origin}/game.php?screen=overview_villages&mode=combined&group=${group}`;
    const found = {};
    let pages = 0;
    const diagnostics = {
      desktopRows: 0,
      mobileCards: 0,
      unitItems: 0,
      unitsTables: 0,
      unitsTableRows: 0,
      unitsTableHeaders: 0,
      added: 0,
    };

    const importMode = async (baseUrl, expectedMode) => {
      const pending = [baseUrl];
      const seen = new Set();
      while (pending.length && pages < ORIGIN_IMPORT_MAX_PAGES) {
        const url = pending.shift();
        if (seen.has(url)) continue;
        seen.add(url);
        pages++;
        setProgress(Math.min(95, 10 + pages * 5), `Loading ${expectedMode} origin page ${pages}...`);
        status(`Loading origin group ${group}, ${expectedMode} page ${seen.size} ...`);
        if (pages > 1) await new Promise(resolve => setTimeout(resolve, ORIGIN_IMPORT_GAP_MS));
        const html = await fetch(url, { credentials: 'same-origin' }).then(r => {
          if (!r.ok) throw Error('overview_villages HTTP ' + r.status);
          return r.text();
        });
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const parsed = parseOriginsFromOverview(doc, found);
        Object.keys(diagnostics).forEach(key => diagnostics[key] += parsed[key] || 0);
        overviewPageLinks(doc, url, group, expectedMode).forEach(link => {
          if (!seen.has(link) && !pending.includes(link)) pending.push(link);
        });
      }
    };

    let originUnitSource = 'units-own-home';
    await importMode(unitsUrl, 'units');
    let usable = Object.values(found).filter(o => o.units && Object.keys(o.units).length);

    // Fallback for accounts/worlds where the dedicated own-home overview is unavailable.
    if (!usable.length && pages < ORIGIN_IMPORT_MAX_PAGES) {
      originUnitSource = 'combined-fallback';
      status(`Own-home unit overview yielded no unit sets; trying Combined overview...`);
      await importMode(combinedUrl, 'combined');
      usable = Object.values(found).filter(o => o.units && Object.keys(o.units).length);
    }

    originCache = {
      t: now(),
      group,
      rows: Object.values(found),
      unavailable: !usable.length,
      source: usable.length ? originUnitSource : 'unavailable',
    };
    const originImportDebug = {
      world: window.game_data?.world || location.hostname.split('.')[0],
      units: getWorldUnits(),
      source: originCache.source,
      pages,
      found: originCache.rows.length,
      usable: usable.length,
      diagnostics,
    };
    window.MapGodQuickbar.lastOriginImport = originImportDebug;
    console.log('[MapGodQuickbar] origin import', originImportDebug);
    try { localStorage.setItem(ORIGIN_CACHE_KEY, JSON.stringify(originCache)); }
    catch (e) { console.warn('[MapGodQuickbar] origin cache storage skipped', e); }
    setProgress(100, `Origin cache ready (${usable.length}/${originCache.rows.length} with units)`, true);
    return originCache.rows;
  }

  function faPaginationLinks(root, baseUrl) {
    const links = new Set();
    const base = new URL(baseUrl, location.href);
    const villageId = base.searchParams.get('village') || String(window.game_data?.village?.id || '');
    root.querySelectorAll('a[href]').forEach(a => {
      try {
        const url = new URL(a.getAttribute('href'), baseUrl);
        const screen = url.searchParams.get('screen');
        const page = url.searchParams.get('Farm_page');
        const linkVillageId = url.searchParams.get('village') || villageId;
        if (url.origin !== location.origin || screen !== 'am_farm' || page == null || !/^\d+$/.test(page)) return;
        if (villageId && linkVillageId !== villageId) return;
        url.hash = '';
        links.add(url.href);
      } catch {}
    });
    return [...links];
  }

  async function importAllFAHistory() {
    if (faImportBusy) return 0;
    if (!document.querySelector('#plunder_list [id^="village_"], #plunder_list [data-village-id], #plunder_list .farm-row, #plunder_list .village-item')) return 0;
    faImportBusy = true;
    const btn = document.getElementById('mgq_import');
    if (btn) btn.disabled = true;
    const h = loadHistory();
    const pending = [];
    const seen = new Set([location.href.split('#')[0]]);
    const initialOriginId = farmOriginIdFromUrl(location.href);
    let rows = importFAHistoryFrom(document, h, initialOriginId);
    let pages = 1;
    let failed = 0;

    const queueLinks = links => links.forEach(url => {
      if (!seen.has(url) && seen.size < FA_IMPORT_MAX_PAGES) {
        seen.add(url);
        pending.push(url);
      }
    });

    queueLinks(faPaginationLinks(document, location.href));
    saveHistory(h);

    try {
      while (pending.length && pages < FA_IMPORT_MAX_PAGES) {
        const url = pending.shift();
        setProgress(Math.min(95, (pages / Math.max(1, pages + pending.length + 1)) * 100), `Importing FA page ${pages + 1}...`);
        status(`Importing FA page ${pages + 1} / ${pages + pending.length + 1} ...\nImported ${rows} rows so far.`);
        await new Promise(resolve => setTimeout(resolve, FA_IMPORT_GAP_MS));
        try {
          const html = await fetch(url, { credentials: 'same-origin' }).then(r => {
            if (!r.ok) throw Error('HTTP ' + r.status);
            return r.text();
          });
          const doc = new DOMParser().parseFromString(html, 'text/html');
          rows += importFAHistoryFrom(doc, h, farmOriginIdFromUrl(url) || initialOriginId);
          queueLinks(faPaginationLinks(doc, url));
          saveHistory(h);
        } catch (e) {
          failed++;
          console.warn('[MapGodQuickbar] FA page import failed', url, e);
        }
        pages++;
      }
      setProgress(100, `Imported ${rows} FA rows`, true);
      status(`Imported ${rows} FA rows from ${pages} page${pages === 1 ? '' : 's'}${failed ? `; ${failed} page failed` : ''}.`);
      return rows;
    } finally {
      faImportBusy = false;
      if (btn) btn.disabled = false;
    }
  }

  async function autoImportFAHistory() {
    return importAllFAHistory();
  }

  function reportOverviewPageLinks(root, baseUrl) {
    const links = new Set();
    root.querySelectorAll('a[href]').forEach(a => {
      try {
        const url = new URL(a.getAttribute('href'), baseUrl);
        if (url.origin !== location.origin || url.searchParams.get('screen') !== 'report') return;
        if (url.searchParams.get('view')) return;
        const page = url.searchParams.get('page');
        if (page == null || !/^\d+$/.test(page)) return;
        url.hash = '';
        links.add(url.href);
      } catch {}
    });
    return [...links].sort((a, b) => {
      const pa = +(new URL(a).searchParams.get('page') || 0);
      const pb = +(new URL(b).searchParams.get('page') || 0);
      return pa - pb;
    });
  }

  function parseReportOverview(root, history, targetsByCoord, originsByCoord, previousMaxReportId) {
    let reportRows = 0;
    let matched = 0;
    let newestReportId = 0;
    let reachedKnown = false;
    const handled = new Set();
    const targetsById = new Map([...targetsByCoord.values()].map(v => [String(v.id), v]));
    const originsById = new Map([...originsByCoord.values()].map(v => [String(v.id), v]));
    const links = root.querySelectorAll(
      '#report_list a[href*="screen=report"][href*="view="], ' +
      'a[href*="screen=report"][href*="mode=all"][href*="view="]'
    );

    links.forEach(link => {
      const reportId = reportIdFromUrl(link.getAttribute('href'));
      if (!reportId || handled.has(reportId)) return;
      handled.add(reportId);
      reportRows++;
      newestReportId = Math.max(newestReportId, reportId);
      if (previousMaxReportId && reportId <= previousMaxReportId) reachedKnown = true;

      const row = link.closest('tr, li, .report-row, .report_item') || link.parentElement;
      if (!row) return;
      const coords = [...String(row.textContent || '').matchAll(/\b(\d{1,3}\|\d{1,3})\b/g)].map(m => m[1]);
      const villageIds = [...row.querySelectorAll('a[href*="screen=info_village"][href*="id="]')]
        .map(a => {
          try { return new URL(a.getAttribute('href'), location.href).searchParams.get('id') || ''; }
          catch { return ''; }
        }).filter(Boolean);
      const targetCoord = [...coords].reverse().find(c => targetsByCoord.has(c)) || '';
      const targetId = [...villageIds].reverse().find(id => targetsById.has(id)) || '';
      const target = targetsByCoord.get(targetCoord) || targetsById.get(targetId);
      if (!target) return;
      const originCoord = coords.find(c => c !== target.coord && originsByCoord.has(c)) || '';
      const originId = villageIds.find(id => id !== String(target.id) && originsById.has(id)) || '';
      const origin = originsByCoord.get(originCoord) || originsById.get(originId);
      const dotSrc = row.querySelector('img[src*="graphic/dots/"]')?.getAttribute('src') || '';
      const dot = (dotSrc.match(/dots\/(green|yellow|red_blue|red_yellow|red|blue)/) || [, ''])[1];
      if (!dot) return;
      const lootFull = !!row.querySelector('img[src*="max_loot/1"]');
      const lootPartial = !!row.querySelector('img[src*="max_loot/0"]');
      const lootKnown = lootFull || lootPartial;
      const result = dot === 'green' ? 'win' : (dot === 'yellow' || dot === 'red_yellow') ? 'losses' : dot === 'red' ? 'defeat' : dot;
      const key = historyKey(origin?.id || '', target.id);
      const observedAt = now();
      if (mergeHistoryEntry(history, key, {
        t: observedAt,
        seen: observedAt,
        reportAt: historyTimestampFromElement(row),
        coord: target.coord,
        dot,
        result,
        loot: lootFull,
        full: lootFull,
        lootKnown,
        reportId,
        src: 'report',
        originId: String(origin?.id || ''),
      })) matched++;
    });

    return { reportRows, matched, newestReportId, reachedKnown };
  }

  async function syncRecentReports(targets, origins) {
    let syncState = {};
    try { syncState = JSON.parse(localStorage.getItem(REPORT_SYNC_KEY) || '{}'); } catch {}
    const previousMaxReportId = +syncState.maxReportId || 0;
    const maxPages = previousMaxReportId ? REPORT_SYNC_MAX_PAGES : REPORT_SYNC_BOOTSTRAP_PAGES;
    const history = loadHistory();
    const targetsByCoord = new Map(targets.map(v => [v.coord, v]));
    const originsByCoord = new Map(origins.map(v => [v.coord, v]));
    const baseUrl = TribalWars.buildURL
      ? TribalWars.buildURL('GET', 'report', { mode: 'all' })
      : `${location.origin}/game.php?screen=report&mode=all`;
    const pending = [baseUrl];
    const seen = new Set();
    let pages = 0;
    let reportRows = 0;
    let matched = 0;
    let newestReportId = previousMaxReportId;
    let reachedKnown = false;
    let failed = 0;

    while (pending.length && pages < maxPages && !reachedKnown) {
      const url = pending.shift();
      if (seen.has(url)) continue;
      seen.add(url);
      pages++;
      setProgress(5 + (pages / maxPages) * 20, `Syncing reports ${pages}/${maxPages}...`);
      status(`Syncing account reports page ${pages}/${maxPages} ...`);
      if (pages > 1) await new Promise(resolve => setTimeout(resolve, REPORT_SYNC_GAP_MS));
      try {
        const html = await fetch(url, { credentials: 'same-origin' }).then(r => {
          if (!r.ok) throw Error('report overview HTTP ' + r.status);
          return r.text();
        });
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const parsed = parseReportOverview(doc, history, targetsByCoord, originsByCoord, previousMaxReportId);
        reportRows += parsed.reportRows;
        matched += parsed.matched;
        newestReportId = Math.max(newestReportId, parsed.newestReportId);
        reachedKnown = parsed.reachedKnown;
        reportOverviewPageLinks(doc, url).forEach(link => {
          if (!seen.has(link) && !pending.includes(link)) pending.push(link);
        });
        saveHistory(history);
      } catch (e) {
        failed++;
        console.warn('[MapGodQuickbar] report sync page failed', url, e);
      }
    }

    // Do not advance the cursor when markup or permissions yielded no reports.
    if (reportRows && newestReportId) {
      try {
        localStorage.setItem(REPORT_SYNC_KEY, JSON.stringify({
          maxReportId: newestReportId,
          t: now(),
          pages,
        }));
      } catch {}
    }
    console.log('[MapGodQuickbar] report sync', { pages, reportRows, matched, reachedKnown, failed });
    return { history, pages, reportRows, matched, reachedKnown, failed, bootstrap: !previousMaxReportId };
  }

  function timestampFromGameText(timestr) {
    try {
      const serverDate = String(document.getElementById('serverDate')?.textContent || '')
        .split(/[\/.-]/).map(x => +x);
      if (serverDate.length < 3) return 0;
      const [day, month, year] = serverDate;
      const makePattern = (key, replacements) => {
        let text = window.lang?.[key];
        if (!text) return null;
        Object.entries(replacements).forEach(([token, value]) => { text = text.replace(token, value); });
        return new RegExp(text);
      };
      const today = makePattern('aea2b0aa9ae1534226518faaefffdaad', { '%s': '([\\d:]+)' })?.exec(timestr);
      const tomorrow = makePattern('57d28d1b211fddbb7a499ead5bf23079', { '%s': '([\\d:]+)' })?.exec(timestr);
      const later = makePattern('0cb274c906d622fa8ce524bcfbb7552d', {
        '%1': '([\\d.\\/-]+)',
        '%2': '([\\d:]+)',
      })?.exec(timestr);
      let dateParts = [day, month, year];
      let timeParts = null;
      if (today) timeParts = today[1].split(':').map(Number);
      else if (tomorrow) {
        dateParts = [day + 1, month, year];
        timeParts = tomorrow[1].split(':').map(Number);
      } else if (later) {
        const parsedDate = later[1].split(/[.\/-]/).map(Number);
        dateParts = [parsedDate[0], parsedDate[1], parsedDate[2] || year];
        timeParts = later[2].split(':').map(Number);
      }
      if (!timeParts) return 0;
      return new Date(
        dateParts[2], dateParts[1] - 1, dateParts[0],
        timeParts[0] || 0, timeParts[1] || 0, timeParts[2] || 0,
        timeParts[3] || 0
      ).getTime();
    } catch {
      return 0;
    }
  }

  function commandArrivalFromRow(row) {
    const timed = row.querySelector(
      '[data-endtime], [data-arrival], [data-arrival-time], [data-timestamp], time[datetime]'
    );
    if (timed) {
      for (const attr of ['data-endtime', 'data-arrival', 'data-arrival-time', 'data-timestamp']) {
        const timestamp = normalizedEpoch(timed.getAttribute(attr));
        if (timestamp) return timestamp;
      }
      const parsed = Date.parse(timed.getAttribute('datetime') || '');
      if (Number.isFinite(parsed)) return parsed;
    }
    const cells = row.querySelectorAll('td');
    const preferred = cells[2]?.textContent?.trim() || '';
    return timestampFromGameText(preferred) || timestampFromGameText(row.textContent || '');
  }

  function parseLiveAttackCommands(root, targetsByCoord, targetsById, arrivals) {
    let rows = 0;
    let matched = 0;
    root.querySelectorAll(
      '#commands_table .row_a, #commands_table .row_ax, #commands_table .row_b, #commands_table .row_bx, ' +
      '#commands_table tbody tr'
    ).forEach(row => {
      if (row.querySelector('th')) return;
      rows++;
      const coords = [...String(row.textContent || '').matchAll(/\b(\d{1,3}\|\d{1,3})\b/g)].map(m => m[1]);
      const targetCoord = [...coords].reverse().find(c => targetsByCoord.has(c)) || '';
      const villageIds = [...row.querySelectorAll('a[href*="screen=info_village"][href*="id="]')]
        .map(a => {
          try { return new URL(a.getAttribute('href'), location.href).searchParams.get('id') || ''; }
          catch { return ''; }
        }).filter(Boolean);
      const targetId = [...villageIds].reverse().find(id => targetsById.has(String(id))) || '';
      const target = targetsByCoord.get(targetCoord) || targetsById.get(String(targetId));
      const arrivalAt = commandArrivalFromRow(row);
      if (!target || !arrivalAt) return;
      const list = arrivals[String(target.id)] || (arrivals[String(target.id)] = []);
      if (!list.some(x => Math.abs(x.arrivalAt - arrivalAt) < 1000)) {
        list.push({ arrivalAt, src: 'commands' });
      }
      matched++;
    });
    return { rows, matched };
  }

  async function loadLiveAttackCommands(targets) {
    const targetsByCoord = new Map(targets.map(v => [v.coord, v]));
    const targetsById = new Map(targets.map(v => [String(v.id), v]));
    const arrivals = {};
    const baseUrl = TribalWars.buildURL
      ? TribalWars.buildURL('GET', 'overview_villages', { mode: 'commands', type: 'attack' })
      : `${location.origin}/game.php?screen=overview_villages&mode=commands&type=attack`;
    const pending = [baseUrl];
    const seen = new Set();
    let pages = 0;
    let rows = 0;
    let matched = 0;
    let failed = 0;

    while (pending.length && pages < COMMAND_SYNC_MAX_PAGES) {
      const url = pending.shift();
      if (seen.has(url)) continue;
      seen.add(url);
      pages++;
      setProgress(Math.min(90, 20 + pages * 3), `Loading live commands page ${pages}...`);
      status(`Loading live outgoing commands page ${pages}...`);
      if (pages > 1) await new Promise(resolve => setTimeout(resolve, COMMAND_SYNC_GAP_MS));
      try {
        const html = await fetch(url, { credentials: 'same-origin' }).then(r => {
          if (!r.ok) throw Error('command overview HTTP ' + r.status);
          return r.text();
        });
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const parsed = parseLiveAttackCommands(doc, targetsByCoord, targetsById, arrivals);
        rows += parsed.rows;
        matched += parsed.matched;
        overviewPageLinks(doc, url, null, 'commands').forEach(link => {
          if (!seen.has(link) && !pending.includes(link)) pending.push(link);
        });
      } catch (e) {
        failed++;
        console.warn('[MapGodQuickbar] command overview page failed', url, e);
      }
    }
    console.log('[MapGodQuickbar] live command sync', { pages, rows, matched, failed });
    return { arrivals, pages, rows, matched, failed };
  }

  function mergeArrivalMaps(base, extra) {
    Object.entries(extra || {}).forEach(([targetId, entries]) => {
      const list = base[targetId] || (base[targetId] = []);
      (entries || []).forEach(entry => {
        if (!list.some(x => Math.abs(x.arrivalAt - entry.arrivalAt) < 1000)) list.push(entry);
      });
    });
    return base;
  }

  function getUnitCount(unit) {
    const amUnits = window.Accountmanager?.farm?.current_units || window.Accountmanager?.farm?.units || window.Accountmanager?.units;
    if (amUnits && hasNum(amUnits[unit])) return n(amUnits[unit]);

    const selectors = [
      '#unit_' + unit,
      '#units_home #unit_' + unit,
      '#units_entry_all_' + unit,
      '#' + unit,
      '[data-unit="' + unit + '"]',
      '.unit-item-' + unit,
      '.unit_' + unit,
    ];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const raw = el.getAttribute('data-count') || el.value || el.textContent;
        if (!hasNum(raw)) continue;
        const val = n(raw);
        if (Number.isFinite(val)) return val;
      }
    }
    // fallback: TW sometimes has unit count links/images near text; keep unknown as null instead of guessing
    return null;
  }

  function parseAvailableUnits() {
    const out = {};
    const units = getWorldUnits();
    units.forEach(u => {
      const val = getUnitCount(u);
      if (val !== null) out[u] = val;
    });
    return out;
  }

  function currentVillageOrigin() {
    const c = coord(window.game_data?.village?.coord || document.getElementById('mgq_origin')?.value);
    const id = String(window.game_data?.village?.id || document.getElementById('mgq_origin_id')?.value || '');
    if (!c || !id) return null;
    const units = parseAvailableUnits();
    if (!Object.keys(units).length) return null;
    return {
      id,
      coord: c.x + '|' + c.y,
      x: c.x,
      y: c.y,
      name: window.game_data?.village?.name || c.x + '|' + c.y,
      units,
      currentFallback: true,
    };
  }

  function parseTemplatesFromPage() {
    const out = {};
    const rows = $('form[action*="action=edit_all"]').find('input[type="hidden"][name*="template"]').closest('tr');
    rows.each((i, el) => {
      const $row = $(el);
      const icon = $row.prev('tr').find('a.farm_icon').first();
      const cls = icon.attr('class') || '';
      const m = cls.match(/farm_icon_(\w+)/);
      const name = m && m[1] ? m[1].toLowerCase() : (i === 0 ? 'a' : 'b');
      const id = $row.find('input[type="hidden"][name*="template"][name*="[id]"]').first().val();
      const units = {};
      $row.find('input[type="text"], input[type="number"]').each((_, input) => {
        const $input = $(input);
        const unit = String($input.attr('name') || '').trim().split('[')[0];
        const amount = n($input.val());
        if (unit && amount > 0) units[unit] = amount;
      });
      if (id) out[name] = { id: String(id), units };
    });
    return out;
  }

  function checkTemplateAvailable(templateName) {
    const tpl = templates[templateName];
    if (!tpl) return { ok: false, reason: `template ${templateName.toUpperCase()} missing` };
    return checkTemplateAvailableFor(templateName, availableUnits);
  }

  function checkTemplateAvailableFor(templateName, units) {
    const tpl = templates[templateName];
    if (!tpl) return { ok: false, reason: `template ${templateName.toUpperCase()} missing` };
    const missing = [];
    const unknown = [];
    for (const [unit, need] of Object.entries(tpl.units || {})) {
      const have = units?.[unit];
      if (have == null) unknown.push(`${unit} need ${need}`);
      else if (have < need) missing.push(`${unit} ${have}/${need}`);
    }
    if (missing.length) return { ok: false, reason: 'not enough: ' + missing.join(', ') };
    if (unknown.length) return { ok: true, warning: 'unit count unknown: ' + unknown.join(', ') };
    return { ok: true, reason: 'available' };
  }

  function deductTemplateUnits(units, templateName) {
    const tpl = templates[templateName];
    if (!tpl) return false;
    const next = { ...(units || {}) };
    for (const [unit, need] of Object.entries(tpl.units || {})) {
      if (need <= 0) continue;
      if (next[unit] == null || next[unit] < need) return false;
      next[unit] -= need;
    }
    return next;
  }

  function saveOriginCache() {
    if (!originCache) return;
    try { localStorage.setItem(ORIGIN_CACHE_KEY, JSON.stringify(originCache)); }
    catch (e) { console.warn('[MapGodQuickbar] origin cache update skipped', e); }
  }

  function deductOriginCacheUnits(originId, templateName) {
    if (!originId || !originCache?.rows?.length) return;
    const row = originCache.rows.find(o => String(o.id) === String(originId));
    if (!row?.units) return;
    const nextUnits = deductTemplateUnits(row.units, templateName);
    if (!nextUnits) return;
    row.units = nextUnits;
    originCache.t = now();
    saveOriginCache();
  }

  function templateCapacity(templateName) {
    const tpl = templates[templateName];
    if (!tpl) return null;
    const req = Object.entries(tpl.units || {}).filter(([, need]) => need > 0);
    if (!req.length) return 0;
    let count = Infinity;
    for (const [unit, need] of req) {
      const have = availableUnits[unit];
      if (have == null) return null;
      count = Math.min(count, Math.floor(have / need));
    }
    return Number.isFinite(count) ? count : 0;
  }

  function capacityLabel(templateName) {
    const count = templateCapacity(templateName);
    return count == null ? 'x?' : 'x' + count;
  }

  function availabilityLabel(templateName) {
    const c = checkTemplateAvailable(templateName);
    const cap = capacityLabel(templateName);
    if (!c.ok) return 'NO ' + cap + ': ' + c.reason;
    if (c.warning) return '? ' + cap + ': ' + c.warning;
    return 'YES ' + cap;
  }

  function probeFA() {
    templates = parseTemplatesFromPage();
    availableUnits = parseAvailableUnits();
    const am = window.Accountmanager || null;
    const link = am && am.send_units_link;
    const originId = document.getElementById('mgq_origin_id').value || window.game_data?.village?.id || '';
    const msg = [
      `screen: ${window.game_data?.screen || 'unknown'}`,
      `origin id: ${originId}`,
      `Accountmanager: ${am ? 'FOUND' : 'missing'}`,
      `send URL type: ${typeof link}`,
      `send URL: ${typeof link === 'string' ? link : '(missing)'}`,
      `template A id: ${templates.a?.id || '(missing)'} | available: ${availabilityLabel('a')}`,
      `template B id: ${templates.b?.id || '(missing)'} | available: ${availabilityLabel('b')}`,
      `units: ${Object.keys(availableUnits).length ? JSON.stringify(availableUnits) : 'none'}`,
      '',
      (!am || typeof link !== 'string') ? 'Open am_farm first.' : 'FA OK.',
    ].join('\n');
    console.log('[MapGod v4] probe', { Accountmanager: am, send_units_link: link, templates, availableUnits });
    status(msg);
    return { am, link, templates, originId };
  }

  function firstSendButton() {
    return document.querySelector('#mgq_results button[data-mg-a-index]:not([disabled]), #mgq_results button[data-mg-b-index]:not([disabled])');
  }

  function firstAButton() {
    return document.querySelector('#mgq_results button[data-mg-a-index]:not([disabled])');
  }

  function firstBButton() {
    return document.querySelector('#mgq_results button[data-mg-b-index]:not([disabled])');
  }

  function originTemplateKey(originId, templateName) {
    return String(originId || '') + ':' + String(templateName || '').toLowerCase();
  }

  function isOriginTemplateBlocked(originId, templateName) {
    return originTemplateBlocks.has(originTemplateKey(originId, templateName));
  }

  function rowCanSendTemplate(v, templateName, smart = false) {
    if (!v || v.sentByMapGod || v.skippedByMapGod) return false;
    if (v.planningBlockedReason) return false;
    if (smart && !(v.greenReport || (v.partialLoss && v.forcedTemplate === 'b') || (v.unknownFarm && v.forcedTemplate === 'a'))) return false;
    if (v.plannedTemplate && v.plannedTemplate !== templateName) return false;
    if (v.forcedTemplate && v.forcedTemplate !== templateName) return false;
    if (isOriginTemplateBlocked(v.origin?.id, templateName)) return false;
    const avail = v.origin?.units
      ? checkTemplateAvailableFor(templateName, v.origin.units)
      : checkTemplateAvailable(templateName);
    if (!avail.ok) return false;
    if (templateName === 'a' && v.lossBlockA) return false;
    if (templateName === 'a' ? v.aConflict : v.bConflict) return false;
    return true;
  }

  function clickQuickRow(rowIndex, templateName) {
    let btn = document.querySelector(
      `#mgq_results button[data-mg-${templateName}-index="${rowIndex}"]:not([disabled])`
    );
    if (!btn) {
      renderPlan(last, renderModeLabel, Math.floor(rowIndex / PLAN_RENDER_PAGE_SIZE), false);
      btn = document.querySelector(
        `#mgq_results button[data-mg-${templateName}-index="${rowIndex}"]:not([disabled])`
      );
    }
    if (!btn) return false;
    btn.click();
    return true;
  }

  function quickSendA() {
    for (let i = 0; i < last.length; i++) {
      if (rowCanSendTemplate(last[i], 'a') && clickQuickRow(i, 'a')) return;
    }
    status('No available A target across the plan. Scan again or check A troops.');
  }

  function quickSendB() {
    for (let i = 0; i < last.length; i++) {
      if (rowCanSendTemplate(last[i], 'b') && clickQuickRow(i, 'b')) return;
    }
    status('No available B target across the plan. Scan again or check B troops.');
  }

  function quickSendSmart() {
    for (let i = 0; i < last.length; i++) {
      const v = last[i];
      const templateName = v.plannedTemplate || v.forcedTemplate || (v.fullHaul ? 'b' : 'a');
      if (rowCanSendTemplate(v, templateName, true) && clickQuickRow(i, templateName)) return;
    }
    status('No smart target across the plan. Need green history, no conflict and an origin with available template troops.');
  }

  function ensureQuickAButton() {
    if (document.getElementById('mgq_quick_a')) return;
    const scanBtn = document.getElementById('mgq_scan');
    if (!scanBtn) return;
    const btn = document.createElement('button');
    btn.id = 'mgq_quick_a';
    btn.textContent = 'Quick A';
    btn.onclick = quickSendA;
    scanBtn.insertAdjacentElement('afterend', btn);
  }

  function removeRow(rowIndex) {
    const btn = document.querySelector(`[data-mg-a-index="${rowIndex}"], [data-mg-b-index="${rowIndex}"]`);
    const tr = btn && btn.closest('tr');
    if (tr) tr.remove();
  }

  function responseText(r) {
    if (typeof r === 'string') return r;
    try { return JSON.stringify(r); } catch { return String(r); }
  }

  function isPlayerOwnedTargetError(r) {
    return /loot assistant to attack villages owned by players/i.test(responseText(r));
  }

  function isInsufficientTroopsError(r) {
    return /not enough (?:units|troops)|insufficient (?:units|troops)|(?:units|troops).*(?:not available|unavailable)/i.test(responseText(r));
  }

  function blockOriginTemplate(originId, originCoord, templateName, reason) {
    const key = originTemplateKey(originId, templateName);
    originTemplateBlocks.add(key);
    if (originCache) originCache.t = 0;
    localStorage.removeItem(ORIGIN_CACHE_KEY);
    let disabled = 0;
    last.forEach((v, i) => {
      if (String(v.origin?.id || '') !== String(originId || '')) return;
      if (v.plannedTemplate && v.plannedTemplate !== templateName) return;
      const btn = document.querySelector(`[data-mg-${templateName}-index="${i}"]`);
      if (btn && !btn.disabled) {
        btn.disabled = true;
        btn.title = reason;
      }
      disabled++;
    });
    status(
      `Origin ${originCoord || originId} cannot send template ${templateName.toUpperCase()}: ${reason}\n` +
      `Blocked ${disabled} matching planned row(s). Use Quick Send again to continue with the next viable origin.`
    );
    return disabled;
  }

  function skipTargetEverywhere(target, rowIndex, reason) {
    markTargetBlocked(target, reason);
    removeTargetFromCache(target.id);
    const removed = last.filter(v => String(v.id) === String(target.id)).length;
    last.forEach((v, i) => {
      if (String(v.id) === String(target.id)) {
        v.skippedByMapGod = true;
        removeRow(i);
      }
    });
    setPlanProgress(planDone + removed, planTotal || (planDone + removed + last.length));
    status(`Skipped ${target.coord}: ${reason}\nRemoved matching rows. Continue with next target.`);
  }

  function sendFarm(rowIndex, templateName) {
    const target = last[rowIndex];
    if (!target) return status('Target missing. Scan again.');
    const probe = probeFA();
    const link = probe.link;
    const originId = target.origin?.id || probe.originId;
    const originCoord = target.origin?.coord || document.getElementById('mgq_origin').value;
    const tpl = templates[templateName];
    const avail = target.origin?.units ? checkTemplateAvailableFor(templateName, target.origin.units) : checkTemplateAvailable(templateName);
    const cooldownMin = +document.getElementById('mgq_cd').value || 0;
    const arrivalAt = target.plannedTemplate === templateName && target.plannedArrivalAt
      ? target.plannedArrivalAt
      : estimateArrivalAt(target, templateName);
    const conflict = arrivalConflict(target.id, arrivalAt, cooldownMin);

    if (target.planningBlockedReason) return status(`Review only: ${target.planningBlockedReason}`);
    if (target.plannedTemplate && templateName !== target.plannedTemplate) return status(`Use planned ${target.plannedTemplate.toUpperCase()} for this multi row.`);
    if (target.forcedTemplate && templateName !== target.forcedTemplate) return status(`Use required ${target.forcedTemplate.toUpperCase()} for this row.`);
    if (typeof link !== 'string') return status('No FA send URL. Open am_farm.');
    if (!tpl?.id) return status(`No tpl ${templateName.toUpperCase()} id.`);
    if (isOriginTemplateBlocked(originId, templateName)) {
      return status(`Origin ${originCoord} is already blocked for template ${templateName.toUpperCase()}. Use Quick Send to continue with another origin.`);
    }
    if (!avail.ok) {
      blockOriginTemplate(originId, originCoord, templateName, avail.reason || 'not enough cached troops');
      return;
    }
    if (conflict) return status(`Cannot send ${templateName.toUpperCase()}: arrival overlaps ${conflict.template.toUpperCase()} from ${conflict.originCoord}.`);
    if (!originId) return status('No origin id.');
    if (busy) return status('Busy.');
    if (now() - lastClickAt < 250) return status('Too fast.');

    if (!FORCE_SEND) {
      const ok = confirm(`SEND template ${templateName.toUpperCase()} to ${target.coord} / ${target.name} / id ${target.id}?\n\nAvailability: ${avail.warning || avail.reason || 'available'}\n\nFarmGod post.`);
      if (!ok) return;
    }

    busy = true;
    lastClickAt = now();
    const postUrl = link.replace(/village=(\d+)/, 'village=' + originId);
    const payload = { target: target.id, template_id: tpl.id, source: originId };
    console.log('[MapGod v4] sending', { postUrl, payload, target, template: tpl });

    TribalWars.post(
      postUrl,
      null,
      payload,
      function (r) {
        busy = false;
        markSent(target.id, originId);
        markArrival(target, templateName, originId, arrivalAt, originCoord);
        deductOriginCacheUnits(originId, templateName);
        target.sentByMapGod = true;
        removeRow(rowIndex);
        setPlanProgress(planDone + 1, planTotal || (planDone + 1 + Math.max(0, last.length - 1)));
        console.log('[MapGod v4] send success', r);
        if (window.UI && UI.SuccessMessage) UI.SuccessMessage(r.success || 'Farm sent');
        status(`OK ${templateName.toUpperCase()} to ${target.coord}\nResponse: ${JSON.stringify(r)}\nCD saved.`);
      },
      function (r) {
        busy = false;
        console.error('[MapGod v4] send error', r);
        if (isPlayerOwnedTargetError(r)) {
          skipTargetEverywhere(target, rowIndex, 'now owned by player');
          return;
        }
        if (isInsufficientTroopsError(r)) {
          blockOriginTemplate(originId, originCoord, templateName, 'server reports insufficient troops');
          if (window.UI && UI.ErrorMessage) UI.ErrorMessage(r || 'Not enough troops');
          return;
        }
        if (window.UI && UI.ErrorMessage) UI.ErrorMessage(r || 'Farm send error');
        status(`ERR ${templateName.toUpperCase()} to ${target.coord}\nResponse: ${responseText(r)}`);
      }
    );
  }

  function enrichTarget(base, origin, hist, cooldownMin, options = {}) {
    const v = { ...base };
    v.origin = origin;
    v.d = dist(origin, v);
    const rawHistory = historyEntry(hist, origin?.id, v.id);
    const reportHistory = options.latestReport
      ? ((options.latestReportMap
          ? options.latestReportMap.get(String(v.id))
          : latestTargetReportEntry(hist, v.id)) || rawHistory)
      : rawHistory;
    const hi = histInfo(reportHistory);
    v.sentAt = histTime(rawHistory);
    const match = !hi.coord || hi.coord === v.coord;
    v.dot = match ? (hi.dot || '') : '';
    v.result = match ? resultLabel(hi) : '';
    v.greenReport = match && (hi.result === 'win' || hi.dot === 'green');
    v.partialLoss = match && (
      hi.result === 'losses' || hi.dot === 'yellow' || hi.dot === 'red_yellow'
    );
    v.redReport = match && (
      hi.result === 'defeat' || hi.dot === 'red' || hi.dot === 'red_blue'
    );
    v.scoutedReport = match && (hi.result === 'blue' || hi.dot === 'blue');
    v.unknownReport = !v.greenReport && !v.partialLoss && !v.redReport;
    v.noFarmHistory = v.unknownReport && !v.scoutedReport;
    v.lossBlockA = match && (
      hi.result === 'losses' || hi.dot === 'yellow' || hi.dot === 'red_yellow' ||
      hi.result === 'defeat' || hi.dot === 'red' || hi.dot === 'red_blue'
    );
    v.fullHaul = match && !!(hi.full || hi.loot);
    v.haulKnown = match && hi.lootKnown !== false;
    v.haulStatus = match ? haulLabel(hi) : '';
    v.loot = match ? !!hi.loot : false;
    v.haul = match ? (hi.haul || '') : '';
    v.rem = match ? (hi.rem || '') : '';
    v.historySource = match ? ((hi.sources || (hi.src ? [hi.src] : [])).join('+') || 'unknown') : 'coord mismatch';
    v.historyReportId = match ? (+hi.reportId || 0) : 0;
    v.historyAge = match ? historyAgeLabel(hi) : 'age ?';
    v.historyVerified = match && !!(hi.reportId || hi.reportAt);
    v.aArrivalAt = estimateArrivalAt(v, 'a');
    v.bArrivalAt = estimateArrivalAt(v, 'b');
    v.aConflict = options.arrivals
      ? arrivalConflictFromMap(options.arrivals, v.id, v.aArrivalAt, cooldownMin)
      : arrivalConflict(v.id, v.aArrivalAt, cooldownMin);
    v.bConflict = options.arrivals
      ? arrivalConflictFromMap(options.arrivals, v.id, v.bArrivalAt, cooldownMin)
      : arrivalConflict(v.id, v.bArrivalAt, cooldownMin);
    v.cooldown = !!(v.aConflict && v.bConflict);
    return v;
  }

  function renderPlan(rows, modeLabel, page = 0, resetProgress = true) {
    const escapeAttr = s => String(s ?? '').replace(/"/g, '&quot;');
    const aAvailGlobal = checkTemplateAvailable('a').ok;
    const bAvailGlobal = checkTemplateAvailable('b').ok;
    if (resetProgress) setPlanProgress(0, rows.filter(v => !v.planningBlockedReason).length);
    renderModeLabel = modeLabel;
    const indexedRows = rows.map((v, i) => ({ v, i }));
    const maxPage = Math.max(0, Math.ceil(indexedRows.length / PLAN_RENDER_PAGE_SIZE) - 1);
    renderPage = Math.max(0, Math.min(page, maxPage));
    const start = renderPage * PLAN_RENDER_PAGE_SIZE;
    const visibleRows = indexedRows
      .slice(start, start + PLAN_RENDER_PAGE_SIZE)
      .filter(x => !x.v.sentByMapGod && !x.v.skippedByMapGod);
    const controls = indexedRows.length > PLAN_RENDER_PAGE_SIZE
      ? '<div style="margin:6px 0"><button id="mgq_page_prev" ' + (renderPage === 0 ? 'disabled' : '') + '>Prev</button> ' +
        '<span>Rows ' + (start + 1) + '-' + Math.min(start + PLAN_RENDER_PAGE_SIZE, indexedRows.length) + ' of ' + indexedRows.length + '</span> ' +
        '<button id="mgq_page_next" ' + (renderPage >= maxPage ? 'disabled' : '') + '>Next</button></div>'
      : '';
    document.getElementById('mgq_results').innerHTML = controls + '<table style="width:100%;border-collapse:collapse;background:#fff8e8"><tr style="background:#d2b06d"><th>#</th><th>Origin</th><th>D</th><th>Coord</th><th>Pts</th><th>Last result</th><th>ETA</th><th>Go</th></tr>' + visibleRows.map(({ v, i }) => {
      const aAvail = v.origin?.units ? checkTemplateAvailableFor('a', v.origin.units).ok : aAvailGlobal;
      const bAvail = v.origin?.units ? checkTemplateAvailableFor('b', v.origin.units).ok : bAvailGlobal;
      const planned = v.plannedTemplate || '';
      const aPlanBlocked = planned && planned !== 'a';
      const bPlanBlocked = planned && planned !== 'b';
      const aPolicyBlocked = !!v.planningBlockedReason || (v.forcedTemplate && v.forcedTemplate !== 'a');
      const bPolicyBlocked = !!v.planningBlockedReason || (v.forcedTemplate && v.forcedTemplate !== 'b');
      const aOriginBlocked = isOriginTemplateBlocked(v.origin?.id, 'a');
      const bOriginBlocked = isOriginTemplateBlocked(v.origin?.id, 'b');
      const aDisabled = !aAvail || aPlanBlocked || aPolicyBlocked || aOriginBlocked || v.lossBlockA || v.aConflict;
      const bDisabled = !bAvail || bPlanBlocked || bPolicyBlocked || bOriginBlocked || v.bConflict;
      const aTitle = v.planningBlockedReason || (!aAvail ? 'A unavailable' : aPolicyBlocked ? 'Policy requires B' : aPlanBlocked ? 'Not planned: troop budget chose ' + planned.toUpperCase() : aOriginBlocked ? 'Origin blocked: insufficient A troops' : v.lossBlockA ? 'A blocked: last report losses/defeat' : 'A arrival cooldown overlap');
      const bTitle = v.planningBlockedReason || (!bAvail ? 'B unavailable' : bPolicyBlocked ? 'Policy blocks B' : bPlanBlocked ? 'Not planned: troop budget chose ' + planned.toUpperCase() : bOriginBlocked ? 'Origin blocked: insufficient B troops' : 'B arrival cooldown overlap');
      const originCoord = v.origin?.coord || '';
      const originLink = v.origin?.id
        ? '<a target="_blank" href="' + location.origin + '/game.php?screen=info_village&id=' + v.origin.id + '">' + originCoord + '</a>'
        : originCoord;
      const etaText = arrivalLabel(v.aArrivalAt) + '/' + arrivalLabel(v.bArrivalAt);
      const historyText = (v.result || '❔') + (v.haulStatus ? ' ' + v.haulStatus : '') +
        (v.result && !v.haulKnown ? ' haul?' : '') +
        ' | ' + (v.historySource || 'unknown') +
        ' | ' + (v.historyReportId ? '#' + v.historyReportId : 'unverified') +
        ' | ' + (v.historyAge || 'age ?');
      const historyStyle = v.historyVerified ? '' : ' style="background:#fff0c2"';
      const rowBg = v.redReport ? '#ffd6d6'
        : v.partialLoss ? '#fff0a8'
        : v.scoutedReport ? '#dcecff'
        : v.unknownReport ? '#ececec'
        : (v.bonus ? '#e8f4ff' : '#fff8e8');
      return '<tr style="background:' + rowBg + '"><td>' + (i + 1) + '</td><td title="' + escapeAttr(v.origin?.name || '') + '">' + originLink + '</td><td>' + v.d.toFixed(2) + '</td><td><a target="_blank" href="' + location.origin + '/game.php?screen=info_village&id=' + v.id + '">' + v.coord + '</a></td><td>' + v.points + '</td><td' + historyStyle + '>' + historyText + '</td><td>' + etaText + '</td><td><button data-mg-a-index="' + i + '" ' + (aDisabled ? 'disabled title="' + aTitle + '"' : '') + '>A</button><button data-mg-b-index="' + i + '" ' + (bDisabled ? 'disabled title="' + bTitle + '"' : '') + '>B</button></td></tr>';
    }).join('') + '</table>';

    document.querySelectorAll('[data-mg-a-index]').forEach(b => b.onclick = () => sendFarm(+b.dataset.mgAIndex, 'a'));
    document.querySelectorAll('[data-mg-b-index]').forEach(b => b.onclick = () => sendFarm(+b.dataset.mgBIndex, 'b'));
    const prev = document.getElementById('mgq_page_prev');
    const next = document.getElementById('mgq_page_next');
    if (prev) prev.onclick = () => renderPlan(rows, renderModeLabel, renderPage - 1, false);
    if (next) next.onclick = () => renderPlan(rows, renderModeLabel, renderPage + 1, false);
    status(`${modeLabel}: planned ${rows.filter(v => !v.planningBlockedReason).length}, review ${rows.filter(v => !!v.planningBlockedReason).length}, displaying ${visibleRows.length} (page ${renderPage + 1}/${maxPage + 1})\nA available: ${availabilityLabel('a')}\nB available: ${availabilityLabel('b')}\nFarm yellow: ${document.getElementById('mgq_farm_yellow').checked ? 'ON (B only)' : 'OFF'}\nFarm unknown: ${document.getElementById('mgq_farm_unknown').checked ? 'ON (A only)' : 'OFF'}\nTarget cache age: ${cacheAgeLabel(targetCache)} | Origin cache age: ${cacheAgeLabel(originCache)}\nForce, bonus and barb enabled. Enter=smart send.`);
  }

  async function scan(skipAutoFA = false) {
    try {
      originTemplateBlocks = new Set();
      saveSettings();
      const o = coord(document.getElementById('mgq_origin').value);
      if (!o) throw Error('Bad origin coord');
      const origin = {
        id: document.getElementById('mgq_origin_id').value || window.game_data?.village?.id || '',
        coord: o.x + '|' + o.y,
        x: o.x,
        y: o.y,
        name: window.game_data?.village?.name || o.x + '|' + o.y,
        units: parseAvailableUnits(),
      };
      const max = +document.getElementById('mgq_dist').value || 20;
      const lim = +document.getElementById('mgq_limit').value || 100;
      const cooldownMin = +document.getElementById('mgq_cd').value || 0;
      const hideCd = document.getElementById('mgq_hide_cd').checked;
      const farmYellow = document.getElementById('mgq_farm_yellow').checked;
      const farmUnknown = document.getElementById('mgq_farm_unknown').checked;
      probeFA();
      await loadUnitSpeeds();
      if (!skipAutoFA) await importAllFAHistory();

      const hist = refreshVisibleFAHistory();
      const rows = [];
      const targets = await loadTargets(false);
      const relevantTargets = targets.filter(base => dist(origin, base) <= max);
      const commandSync = await loadLiveAttackCommands(relevantTargets);
      const arrivals = mergeArrivalMaps(prepareActiveArrivalMap(cooldownMin), commandSync.arrivals);
      targets.forEach((base, idx) => {
        if (idx % 500 === 0) setProgress(Math.min(95, (idx / Math.max(1, targets.length)) * 100), `Scanning targets ${idx}/${targets.length}`);
        const v = enrichTarget(base, origin, hist, cooldownMin, { arrivals });
        if (v.redReport) v.planningBlockedReason = 'Red/defeat history: review only';
        else if (v.partialLoss) {
          if (farmYellow) v.forcedTemplate = 'b';
          else v.planningBlockedReason = 'Yellow excluded: enable Farm yellow to send B';
        } else if (v.unknownReport) {
          if (farmUnknown) {
            v.unknownFarm = true;
            v.forcedTemplate = 'a';
          } else {
            v.planningBlockedReason = 'Unknown excluded: enable Farm unknown to send A';
          }
        }
        if (
          v.d <= max &&
          ((v.bonus && INCLUDE_BONUS) || (!v.bonus && INCLUDE_BARB)) &&
          (!hideCd || !v.cooldown || v.partialLoss || v.redReport)
        ) rows.push(v);
      });

      rows.sort((a, b) => a.d - b.d || b.points - a.points);
      const sendRows = rows.filter(v => !v.planningBlockedReason).slice(0, lim);
      const reviewRows = rows.filter(v => v.planningBlockedReason && (v.partialLoss || v.redReport));
      const ignoredUnknown = rows.filter(v => v.planningBlockedReason && v.unknownReport).length;
      last = [...sendRows, ...reviewRows];
      const fa = window.MapGodQuickbar.lastFAImport || {};
      renderPlan(
        last,
        'Single scan commands ' + sendRows.length +
         ' / review ' + reviewRows.length +
         ' / unknown excluded ' + ignoredUnknown +
        ' / bonus ' + sendRows.filter(v => v.bonus).length +
        ' / FA status ' + (fa.withStatus || 0) + '/' + (fa.rows || 0) +
        ' / live commands ' + commandSync.matched + '/' + commandSync.rows
      );
    } catch (e) {
      console.error(e);
      status('ERROR: ' + e.message);
    }
  }

  function plannedConflict(planned, targetId, arrivalAt, cooldownMin) {
    if (!arrivalAt || cooldownMin <= 0) return null;
    const windowMs = cooldownMin * 60000;
    return (planned[targetId] || []).find(x => Math.abs(x.arrivalAt - arrivalAt) < windowMs) || null;
  }

  async function multiScan(forceOrigins) {
    try {
      originTemplateBlocks = new Set();
      saveSettings();
      probeFA();
      await loadUnitSpeeds();

      const max = +document.getElementById('mgq_dist').value || 20;
      const lim = +document.getElementById('mgq_limit').value || 100;
      const cooldownMin = +document.getElementById('mgq_cd').value || 0;
      const hideCd = document.getElementById('mgq_hide_cd').checked;
      const farmYellow = document.getElementById('mgq_farm_yellow').checked;
      const farmUnknown = document.getElementById('mgq_farm_unknown').checked;
      const loadedOrigins = await loadOrigins(!!forceOrigins);
      let origins = loadedOrigins.filter(o => o.id && o.coord && o.units && Object.keys(o.units).length);
      let originMode = originCache?.source || 'overview';
      if (!origins.length) {
        const current = currentVillageOrigin();
        if (current) {
          origins = [current];
          originMode = 'current-village fallback';
          console.warn('[MapGodQuickbar] overview unavailable; Multi limited to current village', current);
        } else {
          const d = window.MapGodQuickbar.lastOriginImport?.diagnostics || {};
          throw Error(
            `Origin overview parsed ${loadedOrigins.length} village(s), but no unit columns ` +
            `(combined rows ${d.desktopRows || 0}, mobile cards ${d.mobileCards || 0}, ` +
            `units tables ${d.unitsTables || 0}, unit rows ${d.unitsTableRows || 0}, ` +
            `unit headers ${d.unitsTableHeaders || 0}, unit elements ${d.unitItems || 0}); ` +
            `current Loot Assistant unit counts were also unavailable.`
          );
        }
      }
      const targets = await loadTargets(false);
      const targetIndex = buildTargetSpatialIndex(targets);
      const candidates = [];
      const candidateCap = Math.min(
        CANDIDATE_POOL_MAX,
        Math.max(5000, lim * 4, lim + origins.length * 20)
      );
      let candidatesInRange = 0;

      setProgress(5, 'Building multi candidates...');
      origins.forEach((origin, oi) => {
        setProgress(5 + (oi / Math.max(1, origins.length)) * 35, `Building candidates ${oi + 1}/${origins.length}`);
        forEachNearbyTargetIndex(origin, max, targetIndex, ti => {
          const base = targets[ti];
          const d = dist(origin, base);
          if (d <= max) {
            candidatesInRange++;
            pushBoundedCandidate(candidates, { oi, ti, d }, candidateCap);
          }
        });
      });
      setProgress(45, `Sorting closest ${candidates.length}/${candidatesInRange} candidates...`);
      candidates.sort((a, b) => a.d - b.d);
      const relevantTargetIds = new Set(candidates.map(c => targets[c.ti].id));
      const relevantTargets = targets.filter(v => relevantTargetIds.has(v.id));
      const reportSync = await syncRecentReports(relevantTargets, origins);
      const hist = refreshVisibleFAHistory();
      const latestReportMap = buildLatestTargetReportMap(hist);
      const commandSync = await loadLiveAttackCommands(relevantTargets);
      const arrivals = mergeArrivalMaps(prepareActiveArrivalMap(cooldownMin), commandSync.arrivals);

      const planned = {};
      const rows = [];
      const awarenessByTarget = new Map();
      const ignoredUnknownTargets = new Set();
      const plannedTargetIds = new Set();
      for (const c of candidates) {
        if (rows.length % 20 === 0) setProgress(45 + (rows.length / Math.max(1, lim)) * 50, `Planning ${rows.length}/${lim}`);
        const origin = origins[c.oi];
        const base = targets[c.ti];
        const rowOrigin = { ...origin, units: { ...origin.units } };
        const v = enrichTarget(base, rowOrigin, hist, cooldownMin, {
          latestReport: true,
          latestReportMap,
          arrivals,
        });
        const targetKey = String(v.id);
        if (v.redReport) {
          if (!awarenessByTarget.has(targetKey)) {
            v.planningBlockedReason = 'Red/defeat history: review only';
            awarenessByTarget.set(targetKey, v);
          }
          continue;
        }
        if (v.partialLoss && !farmYellow) {
          if (!awarenessByTarget.has(targetKey)) {
            v.planningBlockedReason = 'Yellow excluded: enable Farm yellow to send B';
            awarenessByTarget.set(targetKey, v);
          }
          continue;
        }
        if (v.unknownReport) {
          if (!farmUnknown) {
            ignoredUnknownTargets.add(targetKey);
            continue;
          }
          v.unknownFarm = true;
          v.forcedTemplate = 'a';
        }
        if (rows.length >= lim) continue;

        const prefer = v.partialLoss ? 'b' : (v.unknownFarm ? 'a' : (v.fullHaul ? 'b' : 'a'));
        const choices = v.partialLoss ? ['b'] : (v.unknownFarm ? ['a'] : (prefer === 'b' ? ['b', 'a'] : ['a', 'b']));
        if (v.partialLoss) v.forcedTemplate = 'b';
        let chosen = null;

        for (const templateName of choices) {
          if (templateName === 'a' && v.lossBlockA) continue;
          const arrivalAt = templateName === 'a' ? v.aArrivalAt : v.bArrivalAt;
          const existingConflict = templateName === 'a' ? v.aConflict : v.bConflict;
          const localConflict = plannedConflict(planned, v.id, arrivalAt, cooldownMin);
          if (existingConflict || localConflict) continue;
          const nextUnits = deductTemplateUnits(origin.units, templateName);
          if (!nextUnits) continue;
          chosen = { templateName, nextUnits, arrivalAt };
          break;
        }

        if (!chosen) {
          if (v.partialLoss && !plannedTargetIds.has(targetKey) && !awarenessByTarget.has(targetKey)) {
            v.planningBlockedReason = 'Yellow requires B, but B troops/cooldown are unavailable';
            awarenessByTarget.set(targetKey, v);
          } else if (v.unknownFarm && !plannedTargetIds.has(targetKey) && !awarenessByTarget.has(targetKey)) {
            v.planningBlockedReason = 'Unknown requires A, but A troops/cooldown are unavailable';
            awarenessByTarget.set(targetKey, v);
          }
          continue;
        }

        origin.units = chosen.nextUnits;
        plannedTargetIds.add(targetKey);
        awarenessByTarget.delete(targetKey);
        const plannedItem = { arrivalAt: chosen.arrivalAt, template: chosen.templateName, originCoord: origin.coord };
        planned[v.id] = planned[v.id] || [];
        planned[v.id].push(plannedItem);
        v.plannedTemplate = chosen.templateName;
        v.plannedArrivalAt = chosen.arrivalAt;
        if (chosen.templateName === 'a') v.bConflict = plannedItem;
        else v.aConflict = plannedItem;
        rows.push(v);
      }

      const awarenessRows = [...awarenessByTarget.values()];
      last = [...rows.slice(0, lim), ...awarenessRows];
      setProgress(100, `Plan ready (${rows.length} commands, ${awarenessRows.length} review)`, true);
      renderPlan(last, `Multi group ${+document.getElementById('mgq_group').value || 0}: commands ${rows.length}, review ${awarenessRows.length}, unknown excluded ${ignoredUnknownTargets.size}, origins ${origins.length} (${originMode}), candidate pool ${candidates.length}/${candidatesInRange}, reports ${reportSync.matched}/${reportSync.reportRows} from ${reportSync.pages} page(s), live commands ${commandSync.matched}/${commandSync.rows}`);
    } catch (e) {
      console.error(e);
      status('MULTI ERROR: ' + e.message);
    }
  }

  async function refreshCaches() {
    try {
      saveSettings();
      localStorage.removeItem(TARGET_CACHE_KEY);
      localStorage.removeItem(ORIGIN_CACHE_KEY);
      targetCache = null;
      originCache = null;
      await loadTargets(true);
      await loadOrigins(true);
      status(`Refreshed target cache (${targetCache.rows.length}) and origin cache (${originCache.rows.length}).`);
    } catch (e) {
      console.error(e);
      status('REFRESH ERROR: ' + e.message);
    }
  }

  document.getElementById('mgq_scan').onclick = () => scan(false);
  document.getElementById('mgq_multi').onclick = () => multiScan(false);
  document.getElementById('mgq_refresh').onclick = refreshCaches;
  ensureQuickAButton();
  document.getElementById('mgq_quick_a').onclick = quickSendA;
  document.getElementById('mgq_quick_b').onclick = quickSendB;
  document.getElementById('mgq_quick_send').onclick = quickSendSmart;
  document.getElementById('mgq_probe').onclick = probeFA;
  document.getElementById('mgq_import').onclick = async () => { await importAllFAHistory(); scan(true); };
  document.getElementById('mgq_clear').onclick = () => { localStorage.removeItem(HISTORY_KEY); localStorage.removeItem(ARRIVAL_KEY); localStorage.removeItem(REPORT_SYNC_KEY); status('Cleared history, report cursor and arrival plan. The next Multi will bootstrap report history again.'); };
  document.getElementById('mgq_copy').onclick = async () => {
    const t = last.map(v => v.coord).join(' ');
    try { await navigator.clipboard.writeText(t); status('Copied ' + last.length + ' coords'); }
    catch { prompt('Copy:', t); }
  };

  ['mgq_dist','mgq_limit','mgq_cd','mgq_group','mgq_hide_cd','mgq_farm_yellow','mgq_farm_unknown'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', saveSettings);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && document.getElementById(ID)) {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      e.preventDefault();
      quickSendSmart();
    }
  });

    scan();
  };

  return {
    init,
  };
})();

(() => {
  window.MapGodQuickbar.Main.init().catch(e => alert('MapGod error: ' + e.message));
})();
