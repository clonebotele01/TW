try {
  if (window.ScriptAPI && typeof ScriptAPI.register === 'function') {
    ScriptAPI.register('NobleGodTargetFinder', true, 'clonebotele01', 'World 155 utility');
  }
} catch (e) {
  console.warn('[NobleGod] ScriptAPI registration skipped', e);
}

window.NobleGodTargetFinder = window.NobleGodTargetFinder || {};
window.NobleGodTargetFinder.Main = (function () {
  const ID = 'ng_panel';
  const SETTINGS_KEY = 'noblegod_settings_v1';
  const DIPLO_KEY = 'noblegod_diplomacy_v1';
  const NOTES_KEY = 'noblegod_notes_v1';

  let rows = [];
  let players = {};
  let allies = {};
  let villages = [];

  const dec = s => { try { return decodeURIComponent(String(s || '').replace(/\+/g, ' ')); } catch { return String(s || '').replace(/\+/g, ' '); } };
  const num = x => parseInt(String(x || '').replace(/[^\d-]/g, ''), 10) || 0;
  const coord = s => { const m = String(s || '').match(/(\d{1,3})\s*[|,;:\s]\s*(\d{1,3})/); return m ? { x: +m[1], y: +m[2], coord: `${+m[1]}|${+m[2]}` } : null; };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uniq = a => [...new Set(a.filter(Boolean))];
  const status = t => { const el = document.getElementById('ng_status'); if (el) el.textContent = t; };

  function loadJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || '') || fallback; } catch { return fallback; }
  }

  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function loadSettings() {
    return {
      origin: window.game_data?.village?.coord || '500|500',
      dist: 30,
      minPts: 0,
      maxPts: 12000,
      owner: 'player',
      tribe: 'not_ally',
      sort: 'score',
      limit: 100,
      radiusCenters: '',
      radius: 6,
      onlyRadius: false,
      ...loadJson(SETTINGS_KEY, {}),
    };
  }

  function readSettings() {
    return {
      origin: document.getElementById('ng_origin').value.trim(),
      dist: +document.getElementById('ng_dist').value || 30,
      minPts: +document.getElementById('ng_min_pts').value || 0,
      maxPts: +document.getElementById('ng_max_pts').value || 999999,
      owner: document.getElementById('ng_owner').value,
      tribe: document.getElementById('ng_tribe').value,
      sort: document.getElementById('ng_sort').value,
      limit: +document.getElementById('ng_limit').value || 100,
      radiusCenters: document.getElementById('ng_radius_centers').value.trim(),
      radius: +document.getElementById('ng_radius').value || 0,
      onlyRadius: document.getElementById('ng_only_radius').checked,
    };
  }

  function saveSettings() {
    saveJson(SETTINGS_KEY, readSettings());
  }

  function loadDiplo() {
    return {
      ally: [],
      enemy: [],
      avoid: [],
      watch: [],
      ...loadJson(DIPLO_KEY, {}),
    };
  }

  function readDiplo() {
    const split = id => uniq(document.getElementById(id).value.split(/[\s,;]+/).map(s => s.trim().toUpperCase()));
    return {
      ally: split('ng_diplo_ally'),
      enemy: split('ng_diplo_enemy'),
      avoid: split('ng_diplo_avoid'),
      watch: split('ng_diplo_watch'),
    };
  }

  function saveDiplo() {
    saveJson(DIPLO_KEY, readDiplo());
    status('Diplomacy saved.');
    scan();
  }

  function parseCenters(s) {
    return uniq(String(s || '').match(/\d{1,3}\|\d{1,3}/g) || [])
      .map(coord)
      .filter(Boolean);
  }

  async function fetchText(path) {
    const r = await fetch(location.origin + path, { credentials: 'same-origin' });
    if (!r.ok) throw Error(path + ' HTTP ' + r.status);
    return r.text();
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
        playerId: +q[4],
        points: +q[5],
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
      out[id] = {
        id,
        name: dec(q[1]),
        tag: dec(q[2]).toUpperCase(),
        members: +q[3] || 0,
        villages: +q[4] || 0,
        points: +q[5] || 0,
        allPoints: +q[6] || 0,
        rank: +q[7] || 0,
      };
    });
    return out;
  }

  function classify(v, p, a, diplo) {
    const tag = a?.tag || '';
    if (v.playerId === 0) return 'barb';
    if (diplo.ally.includes(tag)) return 'ally';
    if (diplo.enemy.includes(tag)) return 'enemy';
    if (diplo.avoid.includes(tag)) return 'avoid';
    if (diplo.watch.includes(tag)) return 'watch';
    if (!tag) return 'no_tribe';
    return 'neutral';
  }

  function scoreTarget(v, cls, inRadius) {
    let s = 0;
    s += Math.min(v.points / 100, 120);
    s -= v.d * 3;
    if (cls === 'enemy') s += 60;
    if (cls === 'watch') s += 25;
    if (cls === 'no_tribe') s += 20;
    if (cls === 'barb') s -= 40;
    if (cls === 'ally') s -= 500;
    if (cls === 'avoid') s -= 300;
    if (inRadius) s += 10;
    return Math.round(s);
  }

  async function loadMapData() {
    status('Fetching map files...');
    const [vTxt, pTxt, aTxt] = await Promise.all([
      fetchText('/map/village.txt'),
      fetchText('/map/player.txt'),
      fetchText('/map/ally.txt'),
    ]);
    villages = parseVillages(vTxt);
    players = parsePlayers(pTxt);
    allies = parseAllies(aTxt);
  }

  function passesFilters(r, s) {
    if (r.d > s.dist) return false;
    if (r.points < s.minPts || r.points > s.maxPts) return false;
    if (s.owner === 'player' && r.playerId === 0) return false;
    if (s.owner === 'barb' && r.playerId !== 0) return false;
    if (s.owner === 'non_player' && r.playerId !== 0) return false;
    if (s.owner === 'non_barb' && r.playerId === 0) return false;
    if (s.tribe === 'enemy' && r.className !== 'enemy') return false;
    if (s.tribe === 'ally' && r.className !== 'ally') return false;
    if (s.tribe === 'not_ally' && r.className === 'ally') return false;
    if (s.tribe === 'not_enemy' && r.className === 'enemy') return false;
    if (s.tribe === 'no_tribe' && r.className !== 'no_tribe') return false;
    if (s.tribe === 'watch' && r.className !== 'watch') return false;
    if (s.tribe === 'avoid' && r.className !== 'avoid') return false;
    if (s.onlyRadius && !r.inRadius) return false;
    return true;
  }

  function buildRows() {
    const s = readSettings();
    const o = coord(s.origin);
    if (!o) throw Error('Bad origin coordinate.');
    const centers = parseCenters(s.radiusCenters);
    const diplo = loadDiplo();
    const ownPlayerId = window.game_data?.player?.id || 0;

    rows = villages.map(v => {
      const p = players[v.playerId] || null;
      const a = p ? allies[p.allyId] || null : null;
      const className = classify(v, p, a, diplo);
      const centerD = centers.length ? Math.min(...centers.map(c => dist(c, v))) : null;
      const inRadius = centerD !== null && s.radius > 0 && centerD <= s.radius;
      const r = {
        ...v,
        d: dist(o, v),
        player: p?.name || (v.playerId === 0 ? 'Barbarian' : '?'),
        playerVillages: p?.villages || 0,
        playerPoints: p?.points || 0,
        tribeTag: a?.tag || '',
        tribeName: a?.name || '',
        className,
        centerD,
        inRadius,
        isOwn: ownPlayerId && v.playerId === ownPlayerId,
      };
      r.score = scoreTarget(r, className, inRadius);
      return r;
    }).filter(r => !r.isOwn && passesFilters(r, s));

    rows.sort((a, b) => {
      if (s.sort === 'distance') return a.d - b.d || b.points - a.points;
      if (s.sort === 'points') return b.points - a.points || a.d - b.d;
      if (s.sort === 'tribe') return a.className.localeCompare(b.className) || a.d - b.d;
      return b.score - a.score || a.d - b.d;
    });

    rows = rows.slice(0, s.limit);
    saveSettings();
  }

  function rowColor(r) {
    if (r.className === 'enemy') return '#ffe2dc';
    if (r.className === 'ally') return '#e3f2ff';
    if (r.className === 'avoid') return '#eee';
    if (r.className === 'watch') return '#fff3cc';
    if (r.className === 'no_tribe') return '#eaffea';
    return r.inRadius ? '#f6ecff' : '#fff8e8';
  }

  function render() {
    const html = rows.map((r, i) => {
      const info = `${location.origin}/game.php?screen=info_village&id=${r.id}`;
      const map = `${location.origin}/game.php?screen=map&x=${r.x}&y=${r.y}`;
      const rad = r.centerD === null ? '-' : `${r.centerD.toFixed(1)}${r.inRadius ? '*' : ''}`;
      return `<tr style="background:${rowColor(r)}">
        <td>${i + 1}</td>
        <td>${r.score}</td>
        <td>${r.d.toFixed(1)}</td>
        <td><a target="_blank" href="${info}">${r.coord}</a></td>
        <td>${r.points}</td>
        <td>${esc(r.player)}</td>
        <td title="${esc(r.tribeName)}">${esc(r.tribeTag || '-')}</td>
        <td>${esc(r.className)}</td>
        <td>${rad}</td>
        <td><button data-ng-copy="${r.coord}">C</button><button data-ng-map="${map}">Map</button></td>
      </tr>`;
    }).join('');

    document.getElementById('ng_results').innerHTML = `<table style="width:100%;border-collapse:collapse;background:#fff8e8">
      <tr style="background:#d2b06d"><th>#</th><th>Score</th><th>D</th><th>Coord</th><th>Pts</th><th>Player</th><th>Tribe</th><th>Status</th><th>Rad</th><th>Go</th></tr>
      ${html || '<tr><td colspan="10">No targets.</td></tr>'}
    </table>`;

    document.querySelectorAll('[data-ng-copy]').forEach(b => b.onclick = async () => {
      try { await navigator.clipboard.writeText(b.dataset.ngCopy); status('Copied ' + b.dataset.ngCopy); }
      catch { prompt('Copy:', b.dataset.ngCopy); }
    });
    document.querySelectorAll('[data-ng-map]').forEach(b => b.onclick = () => window.open(b.dataset.ngMap, '_blank'));
  }

  async function scan() {
    try {
      if (!villages.length) await loadMapData();
      buildRows();
      render();
      status(`Targets: ${rows.length} | villages: ${villages.length} | players: ${Object.keys(players).length} | tribes: ${Object.keys(allies).length}`);
    } catch (e) {
      console.error(e);
      status('ERROR: ' + e.message);
    }
  }

  function copyCoords() {
    const text = rows.map(r => r.coord).join(' ');
    if (!text) return status('No coords.');
    navigator.clipboard.writeText(text).then(
      () => status('Copied ' + rows.length + ' coords.'),
      () => prompt('Copy coords:', text)
    );
  }

  function exportData() {
    const payload = {
      version: 1,
      settings: readSettings(),
      diplomacy: readDiplo(),
      notes: loadJson(NOTES_KEY, {}),
    };
    const text = JSON.stringify(payload);
    navigator.clipboard.writeText(text).then(
      () => status('Export copied.'),
      () => prompt('Copy NobleGod data:', text)
    );
  }

  function importData() {
    const text = prompt('Paste NobleGod export:');
    if (!text) return;
    try {
      const p = JSON.parse(text);
      if (p.settings) saveJson(SETTINGS_KEY, p.settings);
      if (p.diplomacy) saveJson(DIPLO_KEY, p.diplomacy);
      if (p.notes) saveJson(NOTES_KEY, p.notes);
      status('Imported. Re-run script to refresh fields.');
    } catch (e) {
      status('Import error: ' + e.message);
    }
  }

  function init() {
    document.getElementById(ID)?.remove();
    const s = loadSettings();
    const d = loadDiplo();
    const panel = document.createElement('div');
    panel.id = ID;
    panel.style.cssText = 'position:fixed;z-index:2147483647;top:70px;right:20px;width:min(96vw,980px);max-height:84vh;overflow:auto;background:#f4e4bc;color:#2b1a0f;border:2px solid #7d510f;box-shadow:0 8px 30px #0008;font:12px Verdana,Arial;padding:6px';
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;background:#7d510f;color:white;padding:6px;margin:-6px -6px 8px -6px">
        <b>NobleGod v1 target finder</b><button id="ng_x">X</button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <label>Origin <input id="ng_origin" value="${esc(s.origin)}" style="width:80px"></label>
        <label>D <input id="ng_dist" type="number" value="${s.dist}" style="width:50px"></label>
        <label>Pts <input id="ng_min_pts" type="number" value="${s.minPts}" style="width:65px"> - <input id="ng_max_pts" type="number" value="${s.maxPts}" style="width:75px"></label>
        <label>Owner <select id="ng_owner">
          <option value="any">any</option><option value="player">player</option><option value="barb">barb</option><option value="non_barb">non-barb</option>
        </select></label>
        <label>Tribe <select id="ng_tribe">
          <option value="any">any</option><option value="not_ally">not ally</option><option value="enemy">enemy</option><option value="ally">ally</option><option value="not_enemy">not enemy</option><option value="no_tribe">no tribe</option><option value="watch">watch</option><option value="avoid">avoid</option>
        </select></label>
        <label>Sort <select id="ng_sort"><option value="score">score</option><option value="distance">distance</option><option value="points">points</option><option value="tribe">status</option></select></label>
        <label>Limit <input id="ng_limit" type="number" value="${s.limit}" style="width:55px"></label>
        <button id="ng_scan">Scan</button><button id="ng_copy">Copy coords</button><button id="ng_export">Export</button><button id="ng_import">Import</button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px">
        <label>Church/relic centers <input id="ng_radius_centers" value="${esc(s.radiusCenters)}" placeholder="500|500 505|503" style="width:min(70vw,340px)"></label>
        <label>Radius <input id="ng_radius" type="number" value="${s.radius}" style="width:50px"></label>
        <label><input id="ng_only_radius" type="checkbox" ${s.onlyRadius ? 'checked' : ''}> only inside</label>
      </div>
      <details style="margin-top:6px">
        <summary>Diplomacy lists, tribe tags separated by space/comma</summary>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(180px,1fr));gap:6px;margin-top:6px">
          <label>Allies <textarea id="ng_diplo_ally" style="width:100%;height:38px">${esc(d.ally.join(' '))}</textarea></label>
          <label>Enemies <textarea id="ng_diplo_enemy" style="width:100%;height:38px">${esc(d.enemy.join(' '))}</textarea></label>
          <label>Avoid <textarea id="ng_diplo_avoid" style="width:100%;height:38px">${esc(d.avoid.join(' '))}</textarea></label>
          <label>Watch <textarea id="ng_diplo_watch" style="width:100%;height:38px">${esc(d.watch.join(' '))}</textarea></label>
        </div>
        <button id="ng_save_diplo">Save diplomacy</button>
      </details>
      <pre id="ng_status" style="background:#fff8e8;border:1px solid #c9a45c;padding:6px;white-space:pre-wrap">Ready</pre>
      <div id="ng_results"></div>
    `;
    document.body.appendChild(panel);
    document.getElementById('ng_x').onclick = () => panel.remove();
    ['ng_owner','ng_tribe','ng_sort'].forEach(id => document.getElementById(id).value = s[id.replace('ng_', '')] || document.getElementById(id).value);
    document.getElementById('ng_scan').onclick = scan;
    document.getElementById('ng_copy').onclick = copyCoords;
    document.getElementById('ng_export').onclick = exportData;
    document.getElementById('ng_import').onclick = importData;
    document.getElementById('ng_save_diplo').onclick = saveDiplo;
    ['ng_origin','ng_dist','ng_min_pts','ng_max_pts','ng_owner','ng_tribe','ng_sort','ng_limit','ng_radius_centers','ng_radius','ng_only_radius'].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', saveSettings);
    });
    scan();
  }

  return { init };
})();

(() => window.NobleGodTargetFinder.Main.init())();
