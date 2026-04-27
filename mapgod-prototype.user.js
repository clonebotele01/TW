// ==UserScript==
// @name         MapGod Prototype - Tribal Wars map target finder
// @namespace    ruko.farmgod
// @version      0.1.0
// @description  Find nearby barbarian and bonus villages from Tribal Wars /map/village.txt, then prepare a farm target table.
// @author       Ruko
// @match        https://*.tribalwars.net/game.php*
// @grant        none
// ==/UserScript==

/*
MapGod Prototype
----------------
Safe first prototype:
- Fetches /map/village.txt from the current TW world.
- Finds player=0 villages around the current or manually entered coordinate.
- Detects bonus villages by name.
- Shows sortable nearest-first table.
- Tracks local cooldown/history in localStorage.
- Provides guarded integration buttons for Farm Assistant send testing.

Important:
The actual send call depends on Tribal Wars' live Accountmanager API shape.
This script intentionally does NOT auto-spam sends. Test one target manually first.
*/

(function MapGodPrototype() {
  'use strict';

  const APP_ID = 'mapgod-prototype';
  const LS_HISTORY_KEY = 'mapgod_target_history_v1';
  const LS_SETTINGS_KEY = 'mapgod_settings_v1';
  const DEFAULTS = {
    origin: '',
    maxDistance: 20,
    minPoints: 0,
    maxPoints: 99999,
    includeBarbs: true,
    includeBonus: true,
    hideCooldown: true,
    cooldownMinutes: 30,
    limit: 100,
  };

  const css = `
#${APP_ID}-panel {
  position: fixed;
  z-index: 99999;
  top: 80px;
  right: 24px;
  width: 760px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 120px);
  overflow: auto;
  background: #f4e4bc;
  color: #2b1a0f;
  border: 2px solid #7d510f;
  box-shadow: 0 8px 30px rgba(0,0,0,.45);
  font: 12px Verdana, Arial, sans-serif;
}
#${APP_ID}-panel * { box-sizing: border-box; }
#${APP_ID}-panel .mg-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px; background: #7d510f; color: #fff; font-weight: bold;
  position: sticky; top: 0; z-index: 2;
}
#${APP_ID}-panel .mg-body { padding: 10px; }
#${APP_ID}-panel .mg-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 8px; }
#${APP_ID}-panel label { display: block; font-weight: bold; margin-bottom: 2px; }
#${APP_ID}-panel input[type="text"], #${APP_ID}-panel input[type="number"] { width: 100%; padding: 4px; }
#${APP_ID}-panel button { cursor: pointer; padding: 4px 8px; margin: 2px; }
#${APP_ID}-panel .mg-actions { margin: 8px 0; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
#${APP_ID}-panel .mg-status { padding: 6px; background: rgba(255,255,255,.45); border: 1px solid #c9a45c; margin: 6px 0; white-space: pre-wrap; }
#${APP_ID}-panel table { width: 100%; border-collapse: collapse; background: #fff8e8; }
#${APP_ID}-panel th, #${APP_ID}-panel td { border: 1px solid #c9a45c; padding: 4px 5px; text-align: left; }
#${APP_ID}-panel th { background: #d2b06d; position: sticky; top: 29px; z-index: 1; }
#${APP_ID}-panel tr.mg-bonus { background: #e8f4ff; }
#${APP_ID}-panel tr.mg-cooldown { opacity: .45; }
#${APP_ID}-panel .mg-muted { color: #6f6254; }
#${APP_ID}-panel .mg-danger { color: #a30000; font-weight: bold; }
#${APP_ID}-panel .mg-ok { color: #0d6b16; font-weight: bold; }
  `;

  let villagesCache = null;
  let lastResults = [];

  function $(sel, root = document) { return root.querySelector(sel); }
  function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  function decodeName(raw) {
    try { return decodeURIComponent(String(raw).replace(/\+/g, ' ')); }
    catch { return String(raw).replace(/\+/g, ' '); }
  }

  function parseCoord(text) {
    const m = String(text || '').match(/(\d{1,3})\s*[|,;:\s]\s*(\d{1,3})/);
    if (!m) return null;
    return { x: Number(m[1]), y: Number(m[2]) };
  }

  function currentVillageCoord() {
    // TW usually exposes game_data.village.x/y.
    const gd = window.game_data || window.GameData || null;
    if (gd && gd.village && gd.village.x != null && gd.village.y != null) {
      return { x: Number(gd.village.x), y: Number(gd.village.y) };
    }

    // Fallback: try common UI coord text.
    const possible = [
      '#menu_row2 b',
      '#content_value',
      '#ds_body',
      'body',
    ];
    for (const sel of possible) {
      const el = $(sel);
      const coord = el && parseCoord(el.textContent);
      if (coord) return coord;
    }
    return null;
  }

  function getServerBase() {
    return `${location.protocol}//${location.hostname}`;
  }

  async function fetchVillageMap(force = false) {
    if (villagesCache && !force) return villagesCache;
    const url = `${getServerBase()}/map/village.txt`;
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`Failed to fetch village.txt: HTTP ${res.status}`);
    const text = await res.text();
    villagesCache = parseVillageTxt(text);
    return villagesCache;
  }

  function parseVillageTxt(text) {
    const rows = [];
    for (const line of String(text).trim().split('\n')) {
      if (!line.trim()) continue;
      const p = line.split(',');
      if (p.length < 7) continue;
      const row = {
        id: Number(p[0]),
        name: decodeName(p[1]),
        x: Number(p[2]),
        y: Number(p[3]),
        player: Number(p[4]),
        points: Number(p[5]),
        rank: Number(p[6]),
      };
      if (!Number.isFinite(row.id) || !Number.isFinite(row.x) || !Number.isFinite(row.y)) continue;
      row.coord = `${row.x}|${row.y}`;
      row.isBarbarianOwned = row.player === 0;
      row.isBonus = /bonus/i.test(row.name);
      rows.push(row);
    }
    return rows;
  }

  function loadSettings() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(LS_SETTINGS_KEY) || '{}') }; }
    catch { return { ...DEFAULTS }; }
  }

  function saveSettings(settings) {
    localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(settings));
  }

  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(LS_HISTORY_KEY) || '{}'); }
    catch { return {}; }
  }

  function saveHistory(history) {
    localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(history));
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function readSettingsFromForm() {
    const panel = $(`#${APP_ID}-panel`);
    const settings = {
      origin: $('#mg-origin', panel).value.trim(),
      maxDistance: Number($('#mg-max-distance', panel).value || DEFAULTS.maxDistance),
      minPoints: Number($('#mg-min-points', panel).value || DEFAULTS.minPoints),
      maxPoints: Number($('#mg-max-points', panel).value || DEFAULTS.maxPoints),
      includeBarbs: $('#mg-include-barbs', panel).checked,
      includeBonus: $('#mg-include-bonus', panel).checked,
      hideCooldown: $('#mg-hide-cooldown', panel).checked,
      cooldownMinutes: Number($('#mg-cooldown', panel).value || DEFAULTS.cooldownMinutes),
      limit: Number($('#mg-limit', panel).value || DEFAULTS.limit),
    };
    saveSettings(settings);
    return settings;
  }

  function findTargets(villages, settings) {
    const origin = parseCoord(settings.origin);
    if (!origin) throw new Error('Invalid origin coordinate. Use format like 481|412.');
    const history = loadHistory();
    const now = Date.now();
    const cooldownMs = Math.max(0, settings.cooldownMinutes) * 60 * 1000;

    return villages
      .filter(v => v.isBarbarianOwned)
      .map(v => {
        const d = distance(origin, v);
        const h = history[v.id] || null;
        const inCooldown = !!(h && h.lastSentAt && now - h.lastSentAt < cooldownMs);
        return { ...v, distance: d, history: h, inCooldown };
      })
      .filter(v => v.distance <= settings.maxDistance)
      .filter(v => v.points >= settings.minPoints && v.points <= settings.maxPoints)
      .filter(v => (v.isBonus && settings.includeBonus) || (!v.isBonus && settings.includeBarbs))
      .filter(v => !settings.hideCooldown || !v.inCooldown)
      .sort((a, b) => a.distance - b.distance || b.points - a.points)
      .slice(0, Math.max(1, settings.limit));
  }

  function renderPanel() {
    if ($(`#${APP_ID}-panel`)) return;
    const style = document.createElement('style');
    style.id = `${APP_ID}-style`;
    style.textContent = css;
    document.head.appendChild(style);

    const settings = loadSettings();
    const coord = currentVillageCoord();
    if (!settings.origin && coord) settings.origin = `${coord.x}|${coord.y}`;

    const panel = document.createElement('div');
    panel.id = `${APP_ID}-panel`;
    panel.innerHTML = `
      <div class="mg-head">
        <span>MapGod Prototype — map-based farm target finder</span>
        <button id="mg-close" type="button">×</button>
      </div>
      <div class="mg-body">
        <div class="mg-grid">
          <div><label>Origin coord</label><input id="mg-origin" type="text" value="${escapeHtml(settings.origin)}" placeholder="481|412"></div>
          <div><label>Max distance</label><input id="mg-max-distance" type="number" value="${settings.maxDistance}" min="1" step="1"></div>
          <div><label>Min points</label><input id="mg-min-points" type="number" value="${settings.minPoints}" min="0" step="1"></div>
          <div><label>Max points</label><input id="mg-max-points" type="number" value="${settings.maxPoints}" min="0" step="1"></div>
          <div><label>Limit</label><input id="mg-limit" type="number" value="${settings.limit}" min="1" step="1"></div>
          <div><label>Cooldown minutes</label><input id="mg-cooldown" type="number" value="${settings.cooldownMinutes}" min="0" step="1"></div>
          <div><label><input id="mg-include-barbs" type="checkbox" ${settings.includeBarbs ? 'checked' : ''}> regular barbs</label></div>
          <div><label><input id="mg-include-bonus" type="checkbox" ${settings.includeBonus ? 'checked' : ''}> bonus villages</label></div>
          <div><label><input id="mg-hide-cooldown" type="checkbox" ${settings.hideCooldown ? 'checked' : ''}> hide cooldown</label></div>
        </div>
        <div class="mg-actions">
          <button id="mg-scan" type="button">Scan map</button>
          <button id="mg-current" type="button">Use current village</button>
          <button id="mg-copy" type="button">Copy coords</button>
          <button id="mg-clear-history" type="button">Clear local history</button>
        </div>
        <div id="mg-status" class="mg-status">Ready. Click Scan map.</div>
        <div id="mg-results"></div>
      </div>
    `;
    document.body.appendChild(panel);

    $('#mg-close', panel).onclick = () => panel.remove();
    $('#mg-current', panel).onclick = () => {
      const c = currentVillageCoord();
      if (!c) return setStatus('Could not detect current village coordinate.', true);
      $('#mg-origin', panel).value = `${c.x}|${c.y}`;
      setStatus(`Origin set to current village: ${c.x}|${c.y}`);
    };
    $('#mg-scan', panel).onclick = scanAndRender;
    $('#mg-copy', panel).onclick = copyCoords;
    $('#mg-clear-history', panel).onclick = () => {
      if (!confirm('Clear MapGod local target history/cooldowns?')) return;
      localStorage.removeItem(LS_HISTORY_KEY);
      setStatus('Local MapGod history cleared.');
      scanAndRender().catch(err => setStatus(err.message, true));
    };
  }

  async function scanAndRender() {
    const settings = readSettingsFromForm();
    setStatus('Fetching/parsing village.txt...');
    const villages = await fetchVillageMap();
    const targets = findTargets(villages, settings);
    lastResults = targets;

    const totalBarbOwned = villages.filter(v => v.isBarbarianOwned).length;
    const bonus = targets.filter(v => v.isBonus).length;
    setStatus(`Loaded ${villages.length.toLocaleString()} villages from map. Barbarian-owned: ${totalBarbOwned.toLocaleString()}. Showing ${targets.length} targets (${bonus} bonus).`);
    renderResults(targets);
  }

  function renderResults(targets) {
    const root = $('#mg-results');
    if (!targets.length) {
      root.innerHTML = '<div class="mg-status">No targets matched current filters.</div>';
      return;
    }
    root.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>#</th><th>Dist</th><th>Coord</th><th>Type</th><th>Pts</th><th>ID</th><th>History</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${targets.map((v, idx) => resultRow(v, idx)).join('')}
        </tbody>
      </table>
      <div class="mg-status mg-muted">
        Send-test buttons are intentionally guarded. First test only one target and confirm TW accepts the Accountmanager send call for map-discovered IDs.
      </div>
    `;
    $all('[data-mg-mark]', root).forEach(btn => {
      btn.onclick = () => markSent(Number(btn.dataset.mgMark));
    });
    $all('[data-mg-test-send]', root).forEach(btn => {
      btn.onclick = () => guardedTestSend(Number(btn.dataset.mgTestSend), btn.dataset.template || 'a');
    });
  }

  function resultRow(v, idx) {
    const h = v.history;
    const hist = h && h.lastSentAt ? `${minutesAgo(h.lastSentAt)}m ago` : '<span class="mg-muted">never</span>';
    const cls = `${v.isBonus ? 'mg-bonus' : ''} ${v.inCooldown ? 'mg-cooldown' : ''}`.trim();
    return `
      <tr class="${cls}">
        <td>${idx + 1}</td>
        <td>${v.distance.toFixed(2)}</td>
        <td><a href="${getServerBase()}/game.php?village=${getCurrentVillageId()}&screen=info_village&id=${v.id}" target="_blank">${v.coord}</a></td>
        <td>${v.isBonus ? 'Bonus' : 'Barb'}</td>
        <td>${v.points}</td>
        <td>${v.id}</td>
        <td>${hist}</td>
        <td>
          <button type="button" data-mg-mark="${v.id}">mark sent</button>
          <button type="button" data-mg-test-send="${v.id}" data-template="a">test A</button>
          <button type="button" data-mg-test-send="${v.id}" data-template="b">test B</button>
        </td>
      </tr>
    `;
  }

  function getCurrentVillageId() {
    const gd = window.game_data || window.GameData || {};
    return gd.village && gd.village.id ? gd.village.id : '';
  }

  function markSent(targetId, extra = {}) {
    const history = loadHistory();
    history[targetId] = { ...(history[targetId] || {}), ...extra, lastSentAt: Date.now() };
    saveHistory(history);
    setStatus(`Marked target ${targetId} as sent.`);
    scanAndRender().catch(err => setStatus(err.message, true));
  }

  function guardedTestSend(targetId, template) {
    const target = lastResults.find(v => v.id === targetId);
    const label = target ? `${target.coord} (${target.name}, ${target.points} pts)` : String(targetId);
    const ok = confirm(`TEST SEND template ${template.toUpperCase()} to ${label}?\n\nThis is for one target only. Continue?`);
    if (!ok) return;
    testFarmAssistantSend(targetId, template);
  }

  function testFarmAssistantSend(targetId, template) {
    // Known Farm Assistant scripts commonly call Accountmanager.send_units_link(...),
    // but the exact signature can vary. So this function tries to introspect safely.
    const am = window.Accountmanager || window.accountmanager || null;
    if (!am || typeof am.send_units_link !== 'function') {
      setStatus('Accountmanager.send_units_link not found on this page. Open Farm Assistant first, then run MapGod again. No send attempted.', true);
      console.warn('[MapGod] Accountmanager object:', am);
      return;
    }

    setStatus(`Accountmanager.send_units_link exists. Need confirm function signature before calling. No send attempted.\nTarget ID: ${targetId}\nTemplate: ${template.toUpperCase()}\nFunction source logged to console.`);
    console.log('[MapGod] send_units_link function:', am.send_units_link);
    console.log('[MapGod] Suggested next step: inspect existing FA farm icon onclick attributes and wire exact call shape.', { targetId, template });

    // After confirming signature in-game, replace the guarded no-op above with the exact call.
    // Example shapes seen in scripts may look like one of these, but DO NOT assume blindly:
    // am.send_units_link(targetId, template);
    // am.send_units_link($('#farm_icon_a_' + targetId)[0]);
    // am.send_units_link(game_data.village.id, targetId, template);
  }

  async function copyCoords() {
    if (!lastResults.length) return setStatus('No scan results to copy.', true);
    const text = lastResults.map(v => v.coord).join(' ');
    try {
      await navigator.clipboard.writeText(text);
      setStatus(`Copied ${lastResults.length} coords to clipboard.`);
    } catch {
      prompt('Copy coords:', text);
    }
  }

  function minutesAgo(ts) {
    return Math.floor((Date.now() - ts) / 60000);
  }

  function setStatus(message, isError = false) {
    const el = $('#mg-status');
    if (!el) return;
    el.className = `mg-status ${isError ? 'mg-danger' : ''}`;
    el.textContent = message;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function addLauncher() {
    if ($(`#${APP_ID}-launcher`)) return;
    const btn = document.createElement('button');
    btn.id = `${APP_ID}-launcher`;
    btn.textContent = 'MapGod';
    btn.style.cssText = 'position:fixed!important;z-index:2147483647!important;right:24px!important;bottom:24px!important;padding:8px 12px!important;background:#7d510f!important;color:white!important;border:2px solid #fff!important;border-radius:4px!important;box-shadow:0 3px 12px rgba(0,0,0,.45)!important;cursor:pointer!important;font:bold 12px Verdana,Arial,sans-serif!important;';
    btn.onclick = renderPanel;
    (document.body || document.documentElement).appendChild(btn);
  }

  function boot() {
    console.log('[MapGod] booting on', location.href);
    window.MapGodPrototype = {
      open: renderPanel,
      scan: scanAndRender,
      version: '0.1.1-debug',
    };
    addLauncher();
    renderPanel();
    console.log('[MapGod] ready. If panel is hidden, run MapGodPrototype.open() in console.');
  }

  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
      boot();
    }
  } catch (err) {
    console.error('[MapGod] failed to boot:', err);
    alert('MapGod failed to boot: ' + (err && err.message ? err.message : err));
  }
})();
