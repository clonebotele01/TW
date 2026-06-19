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
  const TARGET_CACHE_KEY = 'mapgod_target_cache_v7r0';
  const ORIGIN_CACHE_KEY = 'mapgod_origin_cache_v7r0';
  const FA_IMPORT_GAP_MS = 450;
  const FA_IMPORT_MAX_PAGES = 100;
  const TARGET_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
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
      <b>MG V7R0 multi-cache</b><button id="mgq_x">X</button>
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
    <div id="mgq_results"></div>
  `;
  document.body.appendChild(panel);
  document.getElementById('mgq_x').onclick = () => panel.remove();

  let last = [];
  let templates = {};
  let availableUnits = {};
  let unitSpeeds = {};
  let targetCache = null;
  let originCache = null;
  let busy = false;
  let faImportBusy = false;
  let lastClickAt = 0;

  const dec = s => { try { return decodeURIComponent(String(s).replace(/\+/g, ' ')); } catch { return String(s).replace(/\+/g, ' '); } };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const coord = s => { const m = String(s).match(/(\d{1,3})\s*[|,;:\s]\s*(\d{1,3})/); return m ? { x: +m[1], y: +m[2] } : null; };
  const status = t => document.getElementById('mgq_status').textContent = t;
  const now = () => Date.now();
  const n = x => parseInt(String(x || '').replace(/[^\d-]/g, ''), 10) || 0;
  const hasNum = x => /\d/.test(String(x ?? ''));

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
  function markSent(targetId) { const h = loadHistory(); h[targetId] = { ...(typeof h[targetId] === 'object' ? h[targetId] : {}), t: now(), src: 'mapgod' }; saveHistory(h); }
  function minutesAgo(ts) { return Math.floor((now() - ts) / 60000); }

  async function loadUnitSpeeds() {
    if (Object.keys(unitSpeeds).length) return unitSpeeds;
    try { unitSpeeds = JSON.parse(localStorage.getItem(UNIT_SPEEDS_KEY) || '{}'); } catch { unitSpeeds = {}; }
    if (Object.keys(unitSpeeds).length) return unitSpeeds;
    const xml = await fetch(location.origin + '/interface.php?func=get_unit_info', { credentials: 'same-origin' }).then(r => {
      if (!r.ok) throw Error('unit info HTTP ' + r.status);
      return r.text();
    });
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    [...doc.querySelectorAll('config > *')].forEach(el => {
      const speed = parseFloat(el.querySelector('speed')?.textContent || '');
      if (Number.isFinite(speed)) unitSpeeds[el.nodeName] = speed;
    });
    localStorage.setItem(UNIT_SPEEDS_KEY, JSON.stringify(unitSpeeds));
    return unitSpeeds;
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
  function resultLabel(hi){ const r=hi.result||''; const d=hi.dot||''; if(r==='win'||d==='green')return '✅WIN'; if(r==='losses'||d==='yellow')return '⚠️LOSS'; if(r==='defeat'||d==='red')return '❌DEAD'; if(d)return d[0].toUpperCase(); return ''; }
  function haulLabel(hi){ if(hi.full||hi.loot)return '📦FULL'; if(hi.partial)return '📦PART '+(hi.haul||''); if(hi.haul&&hi.haul!=='?')return '📦'+hi.haul; return ''; }
  function importFAHistoryFrom(root, h) {
    let c = 0;
    root.querySelectorAll('#plunder_list tr[id^="village_"]').forEach(el => {
      const id = String(el.id || '').split('_')[1];
      if (!id) return;
      const coord = (el.textContent.match(/\d{1,3}\|\d{1,3}/) || [''])[0];
      const dotSrc = el.querySelector('img[src*="graphic/dots/"]')?.getAttribute('src') || '';
      const dot = (dotSrc.match(/dots\/(green|yellow|red|blue|red_blue)/) || [,''])[1];
      const loot = !!el.querySelector('img[src*="max_loot/1"]');
      const result = dot==='green'?'win':dot==='yellow'?'losses':dot==='red'?'defeat':dot;
      h[id] = { ...(histInfo(h[id])), t: histTime(h[id]) || now(), seen: now(), coord, dot, result, loot, full: loot, src: 'fa' };
      c++;
    });
    return c;
  }

  function parseWorldTargets(txt) {
    const rows = [];
    for (const line of String(txt || '').trim().split('\n')) {
      const q = line.split(',');
      if (q.length < 7) continue;
      const v = { id: +q[0], name: dec(q[1]), x: +q[2], y: +q[3], player: +q[4], points: +q[5] };
      if (v.player !== 0) continue;
      v.bonus = /bonus/i.test(v.name);
      v.coord = v.x + '|' + v.y;
      if ((v.bonus && INCLUDE_BONUS) || (!v.bonus && INCLUDE_BARB)) rows.push(v);
    }
    return rows;
  }

  async function loadTargets(force) {
    const cached = !force && (targetCache || (() => {
      try { return JSON.parse(localStorage.getItem(TARGET_CACHE_KEY) || 'null'); } catch { return null; }
    })());
    if (cached?.rows?.length && now() - cached.t < TARGET_CACHE_TTL_MS) {
      targetCache = cached;
      return cached.rows;
    }

    status('Fetching target cache from ' + location.origin + '/map/village.txt ...');
    const txt = await fetch(location.origin + '/map/village.txt', { credentials: 'same-origin' }).then(r => {
      if (!r.ok) throw Error('map/village.txt HTTP ' + r.status);
      return r.text();
    });
    targetCache = { t: now(), rows: parseWorldTargets(txt) };
    try { localStorage.setItem(TARGET_CACHE_KEY, JSON.stringify(targetCache)); }
    catch (e) { console.warn('[MapGodQuickbar] target cache storage skipped', e); }
    return targetCache.rows;
  }

  function cacheAgeLabel(cache) {
    if (!cache?.t) return 'none';
    const mins = Math.floor((now() - cache.t) / 60000);
    return mins < 60 ? mins + 'm' : Math.floor(mins / 60) + 'h';
  }

  function unitObjectFromInputs($row) {
    const units = {};
    const known = window.game_data?.units || [];
    $row.find('.unit-item').each((index, element) => {
      const unit = known[index];
      if (!unit || ['ram', 'catapult', 'knight', 'snob', 'militia'].includes(unit)) return;
      units[unit] = n($(element).text());
    });
    return units;
  }

  function unitObjectFromMobileCard($card) {
    const units = {};
    $card.find('.overview-units-row .unit-row-item, .unit-row-item').each((_, element) => {
      const $el = $(element);
      const src = $el.find('img').attr('src') || '';
      const unitMatch = src.match(/unit_([a-z_]+?)(?:@2x)?\.(?:webp|png|gif)/);
      const unit = unitMatch && unitMatch[1];
      if (!unit || ['ram', 'catapult', 'knight', 'snob', 'militia'].includes(unit)) return;
      const raw = $el.find('.unit-row-name, span').first().text() || $el.text();
      units[unit] = n(raw);
    });
    return units;
  }

  function parseOriginsFromOverview(root, out) {
    const $root = $(root);
    $root.find('#combined_table .row_a, #combined_table .row_b').each((_, el) => {
      const $row = $(el);
      if ($row.find('.bonus_icon_33').length) return;
      const $label = $row.find('.quickedit-label').first();
      const c = coord($label.text());
      const id = n($row.find('.quickedit-vn').first().data('id'));
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

    $root.find('.overview-container > div, .overview-container .village-item').each((_, el) => {
      const $card = $(el);
      const $label = $card.find('.quickedit-label').first();
      const c = coord($label.text());
      const id = n($card.find('.quickedit-vn').first().data('id'));
      if (!c || !id) return;
      const units = unitObjectFromMobileCard($card);
      if (!Object.keys(units).length) return;
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
  }

  function overviewPageLinks(root, baseUrl, group) {
    const links = new Set();
    const base = new URL(baseUrl, location.href);
    root.querySelectorAll('a[href]').forEach(a => {
      try {
        const url = new URL(a.getAttribute('href'), baseUrl);
        if (url.origin !== location.origin || url.searchParams.get('screen') !== 'overview_villages') return;
        if (url.searchParams.get('mode') !== 'combined') return;
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
    if (cached?.group === group && cached?.rows?.length && now() - cached.t < TARGET_CACHE_TTL_MS) {
      originCache = cached;
      return cached.rows;
    }

    const baseUrl = TribalWars.buildURL
      ? TribalWars.buildURL('GET', 'overview_villages', { mode: 'combined', group })
      : `${location.origin}/game.php?screen=overview_villages&mode=combined&group=${group}`;
    const pending = [baseUrl];
    const seen = new Set();
    const found = {};
    let pages = 0;

    while (pending.length && pages < ORIGIN_IMPORT_MAX_PAGES) {
      const url = pending.shift();
      if (seen.has(url)) continue;
      seen.add(url);
      pages++;
      status(`Loading origin group ${group}, page ${pages} ...`);
      if (pages > 1) await new Promise(resolve => setTimeout(resolve, ORIGIN_IMPORT_GAP_MS));
      const html = await fetch(url, { credentials: 'same-origin' }).then(r => {
        if (!r.ok) throw Error('overview_villages HTTP ' + r.status);
        return r.text();
      });
      const doc = new DOMParser().parseFromString(html, 'text/html');
      parseOriginsFromOverview(doc, found);
      overviewPageLinks(doc, url, group).forEach(link => {
        if (!seen.has(link) && !pending.includes(link)) pending.push(link);
      });
    }

    originCache = { t: now(), group, rows: Object.values(found) };
    try { localStorage.setItem(ORIGIN_CACHE_KEY, JSON.stringify(originCache)); }
    catch (e) { console.warn('[MapGodQuickbar] origin cache storage skipped', e); }
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
    let rows = importFAHistoryFrom(document, h);
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
        status(`Importing FA page ${pages + 1} / ${pages + pending.length + 1} ...\nImported ${rows} rows so far.`);
        await new Promise(resolve => setTimeout(resolve, FA_IMPORT_GAP_MS));
        try {
          const html = await fetch(url, { credentials: 'same-origin' }).then(r => {
            if (!r.ok) throw Error('HTTP ' + r.status);
            return r.text();
          });
          const doc = new DOMParser().parseFromString(html, 'text/html');
          rows += importFAHistoryFrom(doc, h);
          queueLinks(faPaginationLinks(doc, url));
          saveHistory(h);
        } catch (e) {
          failed++;
          console.warn('[MapGodQuickbar] FA page import failed', url, e);
        }
        pages++;
      }
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
    const units = window.game_data?.units || ['spear','sword','axe','archer','spy','light','marcher','heavy','ram','catapult','knight','snob'];
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
    const arrivalAt = estimateArrivalAt(target, templateName);
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
        markSent(target.id);
        markArrival(target, templateName, originId, arrivalAt, originCoord);
        removeRow(rowIndex);
        console.log('[MapGod v4] send success', r);
        if (window.UI && UI.SuccessMessage) UI.SuccessMessage(r.success || 'Farm sent');
        status(`OK ${templateName.toUpperCase()} to ${target.coord}\nResponse: ${JSON.stringify(r)}\nCD saved.`);
      },
      function (r) {
        busy = false;
        console.error('[MapGod v4] send error', r);
        if (window.UI && UI.ErrorMessage) UI.ErrorMessage(r || 'Farm send error');
        status(`ERR ${templateName.toUpperCase()} to ${target.coord}\nResponse: ${typeof r === 'string' ? r : JSON.stringify(r)}`);
      }
    );
  }

  function enrichTarget(base, origin, hist, cooldownMin) {
    const v = { ...base };
    v.origin = origin;
    v.d = dist(origin, v);
    const hi = histInfo(hist[v.id]);
    v.sentAt = histTime(hist[v.id]);
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
    v.aConflict = arrivalConflict(v.id, v.aArrivalAt, cooldownMin);
    v.bConflict = arrivalConflict(v.id, v.bArrivalAt, cooldownMin);
    v.cooldown = !!(v.aConflict && v.bConflict);
    return v;
  }

  function renderPlan(rows, modeLabel) {
    const escapeAttr = s => String(s ?? '').replace(/"/g, '&quot;');
    const aAvailGlobal = checkTemplateAvailable('a').ok;
    const bAvailGlobal = checkTemplateAvailable('b').ok;
    document.getElementById('mgq_results').innerHTML = '<table style="width:100%;border-collapse:collapse;background:#fff8e8"><tr style="background:#d2b06d"><th>#</th><th>Origin</th><th>D</th><th>Coord</th><th>T</th><th>Pts</th><th>CD / ETA</th><th>Go</th></tr>' + rows.map((v, i) => {
      const aAvail = v.origin?.units ? checkTemplateAvailableFor('a', v.origin.units).ok : aAvailGlobal;
      const bAvail = v.origin?.units ? checkTemplateAvailableFor('b', v.origin.units).ok : bAvailGlobal;
      const planned = v.plannedTemplate || '';
      const aPlanBlocked = planned && planned !== 'a';
      const bPlanBlocked = planned && planned !== 'b';
      const aDisabled = !aAvail || aPlanBlocked || v.lossBlockA || v.aConflict;
      const bDisabled = !bAvail || bPlanBlocked || v.bConflict;
      const aTitle = !aAvail ? 'A unavailable' : aPlanBlocked ? 'Not planned: troop budget chose ' + planned.toUpperCase() : v.lossBlockA ? 'A blocked: last report losses/defeat' : 'A arrival cooldown overlap';
      const bTitle = !bAvail ? 'B unavailable' : bPlanBlocked ? 'Not planned: troop budget chose ' + planned.toUpperCase() : 'B arrival cooldown overlap';
      return '<tr style="background:' + (v.bonus ? '#e8f4ff' : '#fff8e8') + '"><td>' + (i + 1) + '</td><td title="' + escapeAttr(v.origin?.name || '') + '">' + (v.origin?.coord || '') + '</td><td>' + v.d.toFixed(2) + '</td><td><a target="_blank" href="' + location.origin + '/game.php?screen=info_village&id=' + v.id + '">' + v.coord + '</a></td><td>' + (v.bonus ? 'Bonus' : 'Barb') + '</td><td>' + v.points + '</td><td>' + (v.sentAt ? minutesAgo(v.sentAt) + 'm ' : '') + (v.result ? v.result + ' ' : '') + (v.haulStatus ? v.haulStatus + ' ' : '') + 'A@' + arrivalLabel(v.aArrivalAt) + (v.aConflict ? ' BLOCK' : '') + ' B@' + arrivalLabel(v.bArrivalAt) + (v.bConflict ? ' BLOCK' : '') + '</td><td><button data-mg-a-index="' + i + '" ' + (aDisabled ? 'disabled title="' + aTitle + '"' : '') + '>A</button><button data-mg-b-index="' + i + '" ' + (bDisabled ? 'disabled title="' + bTitle + '"' : '') + '>B</button></td></tr>';
    }).join('') + '</table>';

    document.querySelectorAll('[data-mg-a-index]').forEach(b => b.onclick = () => sendFarm(+b.dataset.mgAIndex, 'a'));
    document.querySelectorAll('[data-mg-b-index]').forEach(b => b.onclick = () => sendFarm(+b.dataset.mgBIndex, 'b'));
    status(`${modeLabel}: show ${rows.length}\nA available: ${availabilityLabel('a')}\nB available: ${availabilityLabel('b')}\nTarget cache age: ${cacheAgeLabel(targetCache)} | Origin cache age: ${cacheAgeLabel(originCache)}\nForce, bonus and barb enabled. Enter=smart send.`);
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

      const hist = loadHistory();
      const rows = [];
      for (const base of await loadTargets(false)) {
        const v = enrichTarget(base, origin, hist, cooldownMin);
        if (v.d <= max && ((v.bonus && INCLUDE_BONUS) || (!v.bonus && INCLUDE_BARB)) && (!hideCd || !v.cooldown)) rows.push(v);
      }

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
      const hist = loadHistory();
      const origins = (await loadOrigins(!!forceOrigins)).filter(o => o.id && o.coord && o.units && Object.keys(o.units).length);
      if (!origins.length) throw Error('No origin villages with units found. Use Refresh cache on the same desktop/mobile view, then try Multi again.');
      const targets = await loadTargets(false);
      const candidates = [];

      origins.forEach((origin, oi) => {
        targets.forEach((base, ti) => {
          const d = dist(origin, base);
          if (d <= max) candidates.push({ oi, ti, d });
        });
      });
      candidates.sort((a, b) => a.d - b.d);

      const planned = {};
      const rows = [];
      for (const c of candidates) {
        if (rows.length >= lim) break;
        const origin = origins[c.oi];
        const base = targets[c.ti];
        const rowOrigin = { ...origin, units: { ...origin.units } };
        const v = enrichTarget(base, rowOrigin, hist, cooldownMin);
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
        if (chosen.templateName === 'a') v.bConflict = plannedItem;
        else v.aConflict = plannedItem;
        rows.push(v);
      }

      last = rows.slice(0, lim);
      renderPlan(last, `Multi group ${+document.getElementById('mgq_group').value || 0}: origins ${origins.length}, candidates ${candidates.length}`);
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
  document.getElementById('mgq_clear').onclick = () => { localStorage.removeItem(HISTORY_KEY); localStorage.removeItem(ARRIVAL_KEY); status('Cleared history and arrival plan. Scan. Use Refresh cache only when targets/origins changed.'); };
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
