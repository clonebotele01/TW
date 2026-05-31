try {
  if (window.ScriptAPI && typeof ScriptAPI.register === 'function') {
    ScriptAPI.register('MapGodRadiusPlayerTracker', true, 'clonebotele01', 'World 155 utility');
  }
} catch (e) {
  console.warn('[MapGodTracker] ScriptAPI registration skipped', e);
}

window.MapGodRadiusPlayerTracker = window.MapGodRadiusPlayerTracker || {};
window.MapGodRadiusPlayerTracker.Main = (function () {
  const ID = 'mgpt_panel';
  const SETTINGS_KEY = 'mapgod_radius_player_tracker_settings_v1';
  const SNAPSHOTS_KEY = 'mapgod_radius_player_snapshots_v1';

  let requestChain = Promise.resolve();
  let nextRequestAt = 0;
  let currentRows = [];

  const now = () => Date.now();
  const coord = s => {
    const m = String(s || '').match(/(\d{1,3})\s*[|,;:\s]\s*(\d{1,3})/);
    return m ? { x: +m[1], y: +m[2], coord: `${+m[1]}|${+m[2]}` } : null;
  };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const dec = s => {
    try { return decodeURIComponent(String(s || '').replace(/\+/g, ' ')); }
    catch { return String(s || '').replace(/\+/g, ' '); }
  };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const parseNumber = s => {
    const digits = String(s ?? '').replace(/[^\d-]/g, '');
    return digits ? parseInt(digits, 10) : null;
  };
  const status = t => {
    const el = document.getElementById('mgpt_status');
    if (el) el.textContent = t;
  };

  function loadJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || '') || fallback; }
    catch { return fallback; }
  }

  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function loadSettings() {
    return {
      origin: window.game_data?.village?.coord || '500|500',
      radius: 30,
      maxPlayers: 80,
      requestGap: 350,
      includeSelf: false,
      ...loadJson(SETTINGS_KEY, {}),
    };
  }

  function readSettings() {
    return {
      origin: document.getElementById('mgpt_origin').value.trim(),
      radius: +document.getElementById('mgpt_radius').value || 30,
      maxPlayers: +document.getElementById('mgpt_max_players').value || 80,
      requestGap: Math.max(250, +document.getElementById('mgpt_gap').value || 350),
      includeSelf: document.getElementById('mgpt_include_self').checked,
    };
  }

  function saveSettings() {
    saveJson(SETTINGS_KEY, readSettings());
  }

  function serverDateKey() {
    const raw = document.getElementById('serverDate')?.textContent || '';
    const parts = raw.match(/\d+/g);
    if (parts?.length >= 3) {
      const [day, month, year] = parts.map(Number);
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function queueRequest(work) {
    const gap = readSettings().requestGap;
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

  function parseVillages(txt) {
    return txt.trim().split(/\n+/).map(line => {
      const q = line.split(',');
      return {
        id: +q[0],
        name: dec(q[1]),
        x: +q[2],
        y: +q[3],
        coord: `${+q[2]}|${+q[3]}`,
        playerId: +q[4] || 0,
        points: +q[5] || 0,
      };
    }).filter(v => v.id && Number.isFinite(v.x) && Number.isFinite(v.y));
  }

  function parsePlayers(txt) {
    const out = {};
    txt.trim().split(/\n+/).forEach(line => {
      const q = line.split(',');
      const id = +q[0];
      if (!id) return;
      out[id] = {
        id,
        name: dec(q[1]),
        allyId: +q[2] || 0,
        villages: +q[3] || 0,
        points: +q[4] || 0,
        rank: +q[5] || 0,
      };
    });
    return out;
  }

  function parseAllies(txt) {
    const out = {};
    txt.trim().split(/\n+/).forEach(line => {
      const q = line.split(',');
      const id = +q[0];
      if (!id) return;
      out[id] = { id, name: dec(q[1]), tag: dec(q[2]) };
    });
    return out;
  }

  function rankingUrl(playerName, type) {
    const params = { mode: 'kill_player', name: playerName };
    if (type) params.type = type;
    return window.TribalWars?.buildURL
      ? TribalWars.buildURL('GET', 'ranking', params)
      : `${location.origin}/game.php?screen=ranking&mode=kill_player${type ? `&type=${encodeURIComponent(type)}` : ''}&name=${encodeURIComponent(playerName)}`;
  }

  function parseRankingValue(html, playerId) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const links = [...doc.querySelectorAll('a[href*="screen=info_player"]')];
    const link = links.find(a => new URL(a.href, location.href).searchParams.get('id') === String(playerId));
    const tr = link?.closest('tr');
    if (!tr) return null;
    const cells = [...tr.querySelectorAll('td')];
    for (let i = cells.length - 1; i >= 0; i--) {
      const value = parseNumber(cells[i].textContent);
      if (value !== null) return value;
    }
    return null;
  }

  async function fetchRankingValue(player, type) {
    try {
      const html = await fetchText(rankingUrl(player.name, type));
      return parseRankingValue(html, player.id);
    } catch (e) {
      console.warn('[MapGodTracker] ranking fetch failed', player, type, e);
      return null;
    }
  }

  function discoverNearby(villages, players, allies, settings) {
    const origin = coord(settings.origin);
    if (!origin) throw Error('Bad origin coordinate.');
    const ownId = window.game_data?.player?.id || 0;
    const byPlayer = {};

    villages.forEach(v => {
      if (!v.playerId) return;
      if (!settings.includeSelf && ownId && v.playerId === ownId) return;
      const d = dist(origin, v);
      if (d > settings.radius) return;
      if (!byPlayer[v.playerId]) {
        const p = players[v.playerId];
        if (!p) return;
        const tribe = allies[p.allyId] || null;
        byPlayer[v.playerId] = {
          id: p.id,
          name: p.name,
          tribeId: p.allyId,
          tribe: tribe?.tag || '',
          tribeName: tribe?.name || '',
          points: p.points,
          villages: p.villages,
          rank: p.rank,
          nearbyVillages: 0,
          nearestDistance: Infinity,
          nearestCoord: '',
          od: null,
          oda: null,
          odd: null,
          ods: null,
        };
      }
      const row = byPlayer[v.playerId];
      row.nearbyVillages++;
      if (d < row.nearestDistance) {
        row.nearestDistance = d;
        row.nearestCoord = v.coord;
      }
    });

    return Object.values(byPlayer)
      .sort((a, b) => a.nearestDistance - b.nearestDistance || b.points - a.points)
      .slice(0, settings.maxPlayers);
  }

  function saveToday(rows, settings, completed) {
    const all = loadJson(SNAPSHOTS_KEY, {});
    const date = serverDateKey();
    all[date] = {
      date,
      updatedAt: now(),
      completed,
      origin: settings.origin,
      radius: settings.radius,
      rows,
    };
    saveJson(SNAPSHOTS_KEY, all);
  }

  function fmt(v) {
    return v == null ? '-' : Number(v).toLocaleString();
  }

  function render(rows) {
    currentRows = rows;
    const body = rows.map((r, i) => `<tr style="background:${i % 2 ? '#fff8e8' : '#f7ebcd'}">
      <td>${i + 1}</td>
      <td>${r.nearestDistance.toFixed(1)}</td>
      <td><a target="_blank" href="${location.origin}/game.php?screen=info_player&id=${r.id}">${esc(r.name)}</a></td>
      <td title="${esc(r.tribeName)}">${esc(r.tribe || '-')}</td>
      <td>${fmt(r.points)}</td>
      <td>${fmt(r.villages)}</td>
      <td>${fmt(r.nearbyVillages)}</td>
      <td>${fmt(r.od)}</td>
      <td>${fmt(r.oda)}</td>
      <td>${fmt(r.odd)}</td>
      <td>${fmt(r.ods)}</td>
    </tr>`).join('');

    document.getElementById('mgpt_results').innerHTML = `<table style="width:100%;border-collapse:collapse;background:#fff8e8">
      <tr style="background:#d2b06d"><th>#</th><th>D</th><th>Player</th><th>Tribe</th><th>Points</th><th>Vill</th><th>Near</th><th>OD</th><th>ODA</th><th>ODD</th><th>ODS</th></tr>
      ${body || '<tr><td colspan="11">No nearby players.</td></tr>'}
    </table>`;
  }

  function renderSavedDates() {
    const all = loadJson(SNAPSHOTS_KEY, {});
    const dates = Object.keys(all).sort().reverse();
    document.getElementById('mgpt_dates').innerHTML = dates.length
      ? dates.map(date => {
          const s = all[date];
          return `<button data-mgpt-date="${date}">${date} (${s.rows?.length || 0}${s.completed ? '' : ', partial'})</button>`;
        }).join(' ')
      : 'No saved dates.';
    document.querySelectorAll('[data-mgpt-date]').forEach(b => b.onclick = () => {
      const s = all[b.dataset.mgptDate];
      render(s.rows || []);
      status(`Showing saved snapshot ${s.date}${s.completed ? '' : ' (partial)'}.`);
    });
  }

  async function collect() {
    try {
      saveSettings();
      const settings = readSettings();
      status('Fetching map databases...');
      const [vTxt, pTxt, aTxt] = await Promise.all([
        fetchText(location.origin + '/map/village.txt'),
        fetchText(location.origin + '/map/player.txt'),
        fetchText(location.origin + '/map/ally.txt'),
      ]);

      const rows = discoverNearby(parseVillages(vTxt), parsePlayers(pTxt), parseAllies(aTxt), settings);
      render(rows);
      saveToday(rows, settings, false);
      renderSavedDates();

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        status(`Ranking ${i + 1}/${rows.length}: ${row.name}\nRequests are paced at ${settings.requestGap}ms minimum gap.`);
        row.od = await fetchRankingValue(row, '');
        row.oda = await fetchRankingValue(row, 'att');
        row.odd = await fetchRankingValue(row, 'def');
        row.ods = await fetchRankingValue(row, 'support');
        saveToday(rows, settings, false);
        render(rows);
      }

      saveToday(rows, settings, true);
      renderSavedDates();
      status(`Saved ${rows.length} players for ${serverDateKey()}.\nMissing days remain empty by design.`);
    } catch (e) {
      console.error(e);
      status('ERROR: ' + e.message);
    }
  }

  function showToday() {
    const s = loadJson(SNAPSHOTS_KEY, {})[serverDateKey()];
    if (!s) return status('No snapshot saved for today.');
    render(s.rows || []);
    status(`Showing ${serverDateKey()}${s.completed ? '' : ' (partial)'}.`);
  }

  function exportData() {
    const text = JSON.stringify({ version: 1, snapshots: loadJson(SNAPSHOTS_KEY, {}), settings: loadSettings() });
    navigator.clipboard.writeText(text).then(
      () => status('Export copied.'),
      () => prompt('Copy tracker data:', text)
    );
  }

  function clearToday() {
    const all = loadJson(SNAPSHOTS_KEY, {});
    delete all[serverDateKey()];
    saveJson(SNAPSHOTS_KEY, all);
    render([]);
    renderSavedDates();
    status('Cleared today only.');
  }

  function init() {
    document.getElementById(ID)?.remove();
    const s = loadSettings();
    const panel = document.createElement('div');
    panel.id = ID;
    panel.style.cssText = 'position:fixed;z-index:2147483647;top:70px;right:20px;width:min(96vw,1100px);max-height:84vh;overflow:auto;background:#f4e4bc;color:#2b1a0f;border:2px solid #7d510f;box-shadow:0 8px 30px #0008;font:12px Verdana,Arial;padding:6px';
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;background:#7d510f;color:white;padding:6px;margin:-6px -6px 8px -6px">
        <b>MapGod nearby player tracker v1</b><button id="mgpt_x">X</button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <label>Origin <input id="mgpt_origin" value="${esc(s.origin)}" style="width:80px"></label>
        <label>Radius <input id="mgpt_radius" type="number" value="${s.radius}" style="width:55px"></label>
        <label>Max players <input id="mgpt_max_players" type="number" value="${s.maxPlayers}" style="width:55px"></label>
        <label>Gap ms <input id="mgpt_gap" type="number" value="${s.requestGap}" min="250" style="width:60px"></label>
        <label><input id="mgpt_include_self" type="checkbox" ${s.includeSelf ? 'checked' : ''}> include self</label>
        <button id="mgpt_collect">Collect today</button>
        <button id="mgpt_today">Show today</button>
        <button id="mgpt_export">Export</button>
        <button id="mgpt_clear_today">Clear today</button>
      </div>
      <pre id="mgpt_status" style="background:#fff8e8;border:1px solid #c9a45c;padding:6px;white-space:pre-wrap">Ready. Each run updates today's date only.</pre>
      <div id="mgpt_dates" style="margin-bottom:6px"></div>
      <div id="mgpt_results"></div>
    `;
    document.body.appendChild(panel);
    document.getElementById('mgpt_x').onclick = () => panel.remove();
    document.getElementById('mgpt_collect').onclick = collect;
    document.getElementById('mgpt_today').onclick = showToday;
    document.getElementById('mgpt_export').onclick = exportData;
    document.getElementById('mgpt_clear_today').onclick = clearToday;
    ['mgpt_origin','mgpt_radius','mgpt_max_players','mgpt_gap','mgpt_include_self'].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', saveSettings);
    });
    renderSavedDates();
    showToday();
  }

  return { init };
})();

(() => window.MapGodRadiusPlayerTracker.Main.init())();
