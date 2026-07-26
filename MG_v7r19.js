// MapGod v7r19: structural units-table parsing, bounded Multi planning, Rune exclusion and incremental report sync.
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
  const ORIGIN_CACHE_KEY = 'mapgod_origin_cache_v7r0';
  const REPORT_SYNC_KEY = 'mapgod_report_sync_v1';
  const FA_IMPORT_GAP_MS = 450;
  const FA_IMPORT_MAX_PAGES = 100;
  const REPORT_SYNC_GAP_MS = 400;
  const REPORT_SYNC_MAX_PAGES = 5;
  const REPORT_SYNC_BOOTSTRAP_PAGES = 20;
  const TARGET_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
  const ORIGIN_CACHE_TTL_MS = 10 * 60 * 1000;
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
      <b>MG V7R19 multi-cache</b><button id="mgq_x">X</button>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
      <label>Org <input id="mgq_origin" value="${window.game_data?.village?.coord || '481|412'}" style="width:80px"></label>
      <label>Org ID <input id="mgq_origin_id" value="${window.game_data?.village?.id || ''}" style="width:70px"></label>
      <label>Dist <input id="mgq_dist" type="number" value="${settings.dist ?? 20}" style="width:50px"></label>
      <label>Lim <input id="mgq_limit" type="number" value="${settings.limit ?? 100}" style="width:55px"></label>
      <label>CD <input id="mgq_cd" type="number" value="${settings.cd ?? 30}" style="width:45px"></label>
      <label>Group <input id="mgq_group" type="number" value="${settings.group ?? 0}" style="width:55px"></label>
      <label><input id="mgq_hide_cd" type="checkbox" ${settings.hideCd !== false ? 'checked' : ''}> hide sent</label>
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
      const hiReportId = +hi.reportId || 0;
      const bestReportId = +(best && best.reportId) || 0;
      if (!best || (hiReportId && (!bestReportId || hiReportId > bestReportId)) ||
          (!hiReportId && !bestReportId && histTime(hi) > histTime(best))) best = hi;
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
      const hiReportId = +hi.reportId || 0;
      const bestReportId = +(best && best.reportId) || 0;
      if (!best || (hiReportId && (!bestReportId || hiReportId > bestReportId)) ||
          (!hiReportId && !bestReportId && histTime(hi) > histTime(best))) latest.set(targetId, hi);
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
  function reportIdFromUrl(url) {
    try { return +(new URL(url || '', location.href).searchParams.get('view') || 0); }
    catch { return 0; }
  }
  function mergeHistoryEntry(h, key, entry) {
    const previous = histInfo(h[key]);
    const previousReportId = +previous.reportId || 0;
    const nextReportId = +entry.reportId || 0;
    if (previousReportId && nextReportId && previousReportId > nextReportId) return false;
    h[key] = {
      ...previous,
      ...entry,
      // A report overview does not always contain a haul icon. In that case,
      // retain haul information learned earlier from the Farm Assistant.
      ...(entry.lootKnown ? { loot: entry.loot, full: entry.loot } : {
        loot: previous.loot,
        full: previous.full,
      }),
    };
    return true;
  }
  function resultLabel(hi){ const r=hi.result||''; const d=hi.dot||''; if(r==='win'||d==='green')return '✅'; if(r==='losses'||d==='yellow')return '⚠️'; if(r==='defeat'||d==='red')return '❌'; if(d==='blue')return '🔎'; if(d==='red_blue')return '❌🔎'; return ''; }
  function haulLabel(hi){ if(hi.full||hi.loot)return '📦'; if(hi.partial)return '📦'; if(hi.haul&&hi.haul!=='?')return '📦'; return ''; }
  function farmOriginIdFromUrl(url) {
    try { return new URL(url || location.href, location.href).searchParams.get('village') || String(window.game_data?.village?.id || ''); }
    catch { return String(window.game_data?.village?.id || ''); }
  }

  function importFAHistoryFrom(root, h, originId) {
    let c = 0;
    root.querySelectorAll('#plunder_list tr[id^="village_"]').forEach(el => {
      const id = String(el.id || '').split('_')[1];
      if (!id) return;
      const coord = (el.textContent.match(/\d{1,3}\|\d{1,3}/) || [''])[0];
      const dotSrc = el.querySelector('img[src*="graphic/dots/"]')?.getAttribute('src') || '';
      const dot = (dotSrc.match(/dots\/(green|yellow|red_blue|red|blue)/) || [,''])[1];
      const loot = !!el.querySelector('img[src*="max_loot/1"]');
      const reportLink = el.querySelector('a[href*="screen=report"][href*="view="]');
      const reportId = reportIdFromUrl(reportLink?.getAttribute('href'));
      const result = dot==='green'?'win':dot==='yellow'?'losses':dot==='red'?'defeat':dot;
      const key = historyKey(originId, id);
      mergeHistoryEntry(h, key, { t: now(), seen: now(), coord, dot, result, loot, full: loot, lootKnown: true, reportId, src: 'fa', originId: String(originId || '') });
      c++;
    });
    return c;
  }

  function refreshVisibleFAHistory() {
    const h = loadHistory();
    if (document.querySelector('#plunder_list tr[id^="village_"]')) {
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
    if (cached?.group === group && cached?.rows?.length && cacheHasUnits && now() - cached.t < ORIGIN_CACHE_TTL_MS) {
      originCache = cached;
      setProgress(100, `Origin cache ready (${cached.rows.length})`, true);
      return cached.rows;
    }

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

    await importMode(combinedUrl, 'combined');
    let usable = Object.values(found).filter(o => o.units && Object.keys(o.units).length);

    // Fallback for worlds/layouts where the combined overview omits unit cells.
    if (!usable.length && pages < ORIGIN_IMPORT_MAX_PAGES) {
      const unitsUrl = TribalWars.buildURL
        ? TribalWars.buildURL('GET', 'overview_villages', { mode: 'units', type: 'own_home', group })
        : `${location.origin}/game.php?screen=overview_villages&mode=units&type=own_home&group=${group}`;
      status(`Combined overview yielded no unit sets; trying dedicated unit overview...`);
      await importMode(unitsUrl, 'units');
      usable = Object.values(found).filter(o => o.units && Object.keys(o.units).length);
    }

    originCache = { t: now(), group, rows: Object.values(found) };
    const originImportDebug = {
      world: window.game_data?.world || location.hostname.split('.')[0],
      units: getWorldUnits(),
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
    if (!document.querySelector('#plunder_list tr[id^="village_"]')) return 0;
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
      const dot = (dotSrc.match(/dots\/(green|yellow|red_blue|red|blue)/) || [, ''])[1];
      if (!dot) return;
      const lootFull = !!row.querySelector('img[src*="max_loot/1"]');
      const lootPartial = !!row.querySelector('img[src*="max_loot/0"]');
      const lootKnown = lootFull || lootPartial;
      const result = dot === 'green' ? 'win' : dot === 'yellow' ? 'losses' : dot === 'red' ? 'defeat' : dot;
      const key = historyKey(origin?.id || '', target.id);
      if (mergeHistoryEntry(history, key, {
        t: now(),
        seen: now(),
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

  function quickSendA() {
    const btn = firstAButton();
    if (!btn) return status('No available A target. Scan first or check A template.');
    btn.click();
  }

  function quickSendB() {
    const btn = firstBButton();
    if (!btn) return status('No available B target. Scan first or check B template.');
    btn.click();
  }

  function quickSendSmart() {
    for (let i = 0; i < last.length; i++) {
      const v = last[i];
      if (v.sentByMapGod || v.skippedByMapGod) continue;
      if (!v.greenReport || v.lossBlockA) continue;
      const templateName = v.plannedTemplate || (v.fullHaul ? 'b' : 'a');
      const btn = document.querySelector(`#mgq_results button[data-mg-${templateName}-index="${i}"]:not([disabled])`);
      if (btn) {
        btn.click();
        return;
      }
    }
    status('No smart target. Need green report and available A/B template.');
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

    if (target.plannedTemplate && templateName !== target.plannedTemplate) return status(`Use planned ${target.plannedTemplate.toUpperCase()} for this multi row.`);
    if (typeof link !== 'string') return status('No FA send URL. Open am_farm.');
    if (!tpl?.id) return status(`No tpl ${templateName.toUpperCase()} id.`);
    if (!avail.ok) return status(`Cannot send ${templateName.toUpperCase()}: ${avail.reason}`);
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
    v.lossBlockA = match && (hi.result === 'losses' || hi.dot === 'yellow' || hi.result === 'defeat' || hi.dot === 'red');
    v.fullHaul = match && !!(hi.full || hi.loot);
    v.haulStatus = match ? haulLabel(hi) : '';
    v.loot = match ? !!hi.loot : false;
    v.haul = match ? (hi.haul || '') : '';
    v.rem = match ? (hi.rem || '') : '';
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
    if (resetProgress) setPlanProgress(0, rows.length);
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
    document.getElementById('mgq_results').innerHTML = controls + '<table style="width:100%;border-collapse:collapse;background:#fff8e8"><tr style="background:#d2b06d"><th>#</th><th>Origin</th><th>D</th><th>Coord</th><th>Pts</th><th>CD / ETA</th><th>Go</th></tr>' + visibleRows.map(({ v, i }) => {
      const aAvail = v.origin?.units ? checkTemplateAvailableFor('a', v.origin.units).ok : aAvailGlobal;
      const bAvail = v.origin?.units ? checkTemplateAvailableFor('b', v.origin.units).ok : bAvailGlobal;
      const planned = v.plannedTemplate || '';
      const aPlanBlocked = planned && planned !== 'a';
      const bPlanBlocked = planned && planned !== 'b';
      const aDisabled = !aAvail || aPlanBlocked || v.lossBlockA || v.aConflict;
      const bDisabled = !bAvail || bPlanBlocked || v.bConflict;
      const aTitle = !aAvail ? 'A unavailable' : aPlanBlocked ? 'Not planned: troop budget chose ' + planned.toUpperCase() : v.lossBlockA ? 'A blocked: last report losses/defeat' : 'A arrival cooldown overlap';
      const bTitle = !bAvail ? 'B unavailable' : bPlanBlocked ? 'Not planned: troop budget chose ' + planned.toUpperCase() : 'B arrival cooldown overlap';
      const originCoord = v.origin?.coord || '';
      const originLink = v.origin?.id
        ? '<a target="_blank" href="' + location.origin + '/game.php?screen=info_village&id=' + v.origin.id + '">' + originCoord + '</a>'
        : originCoord;
      const etaText = (v.sentAt ? minutesAgo(v.sentAt) + 'm ' : '') + (v.result ? v.result + ' ' : '') + (v.haulStatus ? v.haulStatus + ' ' : '') + arrivalLabel(v.aArrivalAt) + '/' + arrivalLabel(v.bArrivalAt);
      return '<tr style="background:' + (v.bonus ? '#e8f4ff' : '#fff8e8') + '"><td>' + (i + 1) + '</td><td title="' + escapeAttr(v.origin?.name || '') + '">' + originLink + '</td><td>' + v.d.toFixed(2) + '</td><td><a target="_blank" href="' + location.origin + '/game.php?screen=info_village&id=' + v.id + '">' + v.coord + '</a></td><td>' + v.points + '</td><td>' + etaText + '</td><td><button data-mg-a-index="' + i + '" ' + (aDisabled ? 'disabled title="' + aTitle + '"' : '') + '>A</button><button data-mg-b-index="' + i + '" ' + (bDisabled ? 'disabled title="' + bTitle + '"' : '') + '>B</button></td></tr>';
    }).join('') + '</table>';

    document.querySelectorAll('[data-mg-a-index]').forEach(b => b.onclick = () => sendFarm(+b.dataset.mgAIndex, 'a'));
    document.querySelectorAll('[data-mg-b-index]').forEach(b => b.onclick = () => sendFarm(+b.dataset.mgBIndex, 'b'));
    const prev = document.getElementById('mgq_page_prev');
    const next = document.getElementById('mgq_page_next');
    if (prev) prev.onclick = () => renderPlan(rows, renderModeLabel, renderPage - 1, false);
    if (next) next.onclick = () => renderPlan(rows, renderModeLabel, renderPage + 1, false);
    status(`${modeLabel}: planned ${rows.length}, displaying ${visibleRows.length} (page ${renderPage + 1}/${maxPage + 1})\nA available: ${availabilityLabel('a')}\nB available: ${availabilityLabel('b')}\nTarget cache age: ${cacheAgeLabel(targetCache)} | Origin cache age: ${cacheAgeLabel(originCache)}\nForce, bonus and barb enabled. Enter=smart send.`);
  }

  async function scan() {
    try {
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
      probeFA();
      await loadUnitSpeeds();

      const hist = refreshVisibleFAHistory();
      const rows = [];
      const targets = await loadTargets(false);
      targets.forEach((base, idx) => {
        if (idx % 500 === 0) setProgress(Math.min(95, (idx / Math.max(1, targets.length)) * 100), `Scanning targets ${idx}/${targets.length}`);
        const v = enrichTarget(base, origin, hist, cooldownMin);
        if (v.d <= max && ((v.bonus && INCLUDE_BONUS) || (!v.bonus && INCLUDE_BARB)) && (!hideCd || !v.cooldown)) rows.push(v);
      });

      rows.sort((a, b) => a.d - b.d || b.points - a.points);
      last = rows.slice(0, lim);
      renderPlan(last, 'Single scan found ' + rows.length + ' / bonus ' + last.filter(v => v.bonus).length);
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
      saveSettings();
      probeFA();
      await loadUnitSpeeds();

      const max = +document.getElementById('mgq_dist').value || 20;
      const lim = +document.getElementById('mgq_limit').value || 100;
      const cooldownMin = +document.getElementById('mgq_cd').value || 0;
      const hideCd = document.getElementById('mgq_hide_cd').checked;
      const loadedOrigins = await loadOrigins(!!forceOrigins);
      const origins = loadedOrigins.filter(o => o.id && o.coord && o.units && Object.keys(o.units).length);
      if (!origins.length) {
        const d = window.MapGodQuickbar.lastOriginImport?.diagnostics || {};
        throw Error(
          `Origin overview parsed ${loadedOrigins.length} village(s), but no unit columns ` +
          `(combined rows ${d.desktopRows || 0}, mobile cards ${d.mobileCards || 0}, ` +
          `units tables ${d.unitsTables || 0}, unit rows ${d.unitsTableRows || 0}, ` +
          `unit headers ${d.unitsTableHeaders || 0}, unit elements ${d.unitItems || 0}).`
        );
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
      const arrivals = prepareActiveArrivalMap(cooldownMin);

      const planned = {};
      const rows = [];
      for (const c of candidates) {
        if (rows.length >= lim) break;
        if (rows.length % 20 === 0) setProgress(45 + (rows.length / Math.max(1, lim)) * 50, `Planning ${rows.length}/${lim}`);
        const origin = origins[c.oi];
        const base = targets[c.ti];
        const rowOrigin = { ...origin, units: { ...origin.units } };
        const v = enrichTarget(base, rowOrigin, hist, cooldownMin, {
          latestReport: true,
          latestReportMap,
          arrivals,
        });
        const prefer = v.fullHaul ? 'b' : 'a';
        const choices = prefer === 'b' ? ['b', 'a'] : ['a', 'b'];
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

        if (!chosen) continue;

        origin.units = chosen.nextUnits;
        const plannedItem = { arrivalAt: chosen.arrivalAt, template: chosen.templateName, originCoord: origin.coord };
        planned[v.id] = planned[v.id] || [];
        planned[v.id].push(plannedItem);
        v.plannedTemplate = chosen.templateName;
        v.plannedArrivalAt = chosen.arrivalAt;
        if (chosen.templateName === 'a') v.bConflict = plannedItem;
        else v.aConflict = plannedItem;
        rows.push(v);
      }

      last = rows.slice(0, lim);
      setProgress(100, `Plan ready (${last.length})`, true);
      renderPlan(last, `Multi group ${+document.getElementById('mgq_group').value || 0}: origins ${origins.length}, candidate pool ${candidates.length}/${candidatesInRange}, reports ${reportSync.matched}/${reportSync.reportRows} from ${reportSync.pages} page(s), live origin units`);
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

  document.getElementById('mgq_scan').onclick = scan;
  document.getElementById('mgq_multi').onclick = () => multiScan(false);
  document.getElementById('mgq_refresh').onclick = refreshCaches;
  ensureQuickAButton();
  document.getElementById('mgq_quick_a').onclick = quickSendA;
  document.getElementById('mgq_quick_b').onclick = quickSendB;
  document.getElementById('mgq_quick_send').onclick = quickSendSmart;
  document.getElementById('mgq_probe').onclick = probeFA;
  document.getElementById('mgq_import').onclick = async () => { await importAllFAHistory(); scan(); };
  document.getElementById('mgq_clear').onclick = () => { localStorage.removeItem(HISTORY_KEY); localStorage.removeItem(ARRIVAL_KEY); localStorage.removeItem(REPORT_SYNC_KEY); status('Cleared history, report cursor and arrival plan. The next Multi will bootstrap report history again.'); };
  document.getElementById('mgq_copy').onclick = async () => {
    const t = last.map(v => v.coord).join(' ');
    try { await navigator.clipboard.writeText(t); status('Copied ' + last.length + ' coords'); }
    catch { prompt('Copy:', t); }
  };

  ['mgq_dist','mgq_limit','mgq_cd','mgq_group','mgq_hide_cd'].forEach(id => {
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
