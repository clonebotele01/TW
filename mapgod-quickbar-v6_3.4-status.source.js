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
      <b>MG6.3 status QA</b><button id="mgq_x">X</button>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
      <label>Org <input id="mgq_origin" value="${window.game_data?.village?.coord || '481|412'}" style="width:80px"></label>
      <label>Org ID <input id="mgq_origin_id" value="${window.game_data?.village?.id || ''}" style="width:70px"></label>
      <label>Dist <input id="mgq_dist" type="number" value="${settings.dist ?? 20}" style="width:50px"></label>
      <label>Lim <input id="mgq_limit" type="number" value="${settings.limit ?? 100}" style="width:55px"></label>
      <label>CD <input id="mgq_cd" type="number" value="${settings.cd ?? 30}" style="width:45px"></label>
      <label><input id="mgq_hide_cd" type="checkbox" ${settings.hideCd !== false ? 'checked' : ''}> hide sent</label>
      <label><input id="mgq_force" type="checkbox" ${settings.force !== false ? 'checked' : ''}> force</label>
      <label><input id="mgq_bonus" type="checkbox" ${settings.bonus !== false ? 'checked' : ''}> bonus</label>
      <label><input id="mgq_barb" type="checkbox" ${settings.barb !== false ? 'checked' : ''}> barb</label>
      <button id="mgq_scan">Scan</button>
      <button id="mgq_quick_a">Quick A</button>
      <button id="mgq_quick_b">Quick B</button>
      <button id="mgq_quick_send">Quick send</button>
      <button id="mgq_copy">Copy</button>
      <button id="mgq_probe">Probe</button>
      <button id="mgq_import">Import FA</button>
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
  let busy = false;
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
  function loadSettings() { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { return {}; } }
  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      dist: +document.getElementById('mgq_dist')?.value || 20,
      limit: +document.getElementById('mgq_limit')?.value || 100,
      cd: +document.getElementById('mgq_cd')?.value || 0,
      hideCd: !!document.getElementById('mgq_hide_cd')?.checked,
      force: !!document.getElementById('mgq_force')?.checked,
      bonus: !!document.getElementById('mgq_bonus')?.checked,
      barb: !!document.getElementById('mgq_barb')?.checked,
    }));
  }
  function markSent(targetId) { const h = loadHistory(); h[targetId] = { ...(typeof h[targetId] === 'object' ? h[targetId] : {}), t: now(), src: 'mapgod' }; saveHistory(h); }
  function minutesAgo(ts) { return Math.floor((now() - ts) / 60000); }


  function histTime(v) { return typeof v === 'number' ? v : (v && v.t) || 0; }
  function histInfo(v) { return typeof v === 'object' && v ? v : {}; }
  function resultLabel(hi){ const r=hi.result||''; const d=hi.dot||''; if(r==='win'||d==='green')return '✅WIN'; if(r==='losses'||d==='yellow')return '⚠️LOSS'; if(r==='defeat'||d==='red')return '❌DEAD'; if(d)return d[0].toUpperCase(); return ''; }
  function haulLabel(hi){ if(hi.full||hi.loot)return '📦FULL'; if(hi.partial)return '📦PART '+(hi.haul||''); if(hi.haul&&hi.haul!=='?')return '📦'+hi.haul; return ''; }
  function importFAHistory() {
    const h = loadHistory();
    let c = 0;
    $('#plunder_list tr[id^="village_"]').each((_, el) => {
      const $r = $(el);
      const id = String($r.attr('id') || '').split('_')[1];
      if (!id) return;
      const coord = ($r.text().match(/\d{1,3}\|\d{1,3}/) || [''])[0];
      const dot = (($r.find('img[src*="graphic/dots/"]').attr('src') || '').match(/dots\/(green|yellow|red|blue|red_blue)/) || [,''])[1];
      const loot = $r.find('img[src*="max_loot/1"]').length > 0;
      const result = dot==='green'?'win':dot==='yellow'?'losses':dot==='red'?'defeat':dot;
      h[id] = { ...(histInfo(h[id])), t: histTime(h[id]) || now(), seen: now(), coord, dot, result, loot, full: loot, src: 'fa' };
      c++;
    });
    saveHistory(h);
    status('Imp ' + c + ' rows.');
    return c;
  }

  function autoImportFAHistory() {
    if (!document.querySelector('#plunder_list tr[id^="village_"]')) return 0;
    return importFAHistory();
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
    const missing = [];
    const unknown = [];
    for (const [unit, need] of Object.entries(tpl.units || {})) {
      const have = availableUnits[unit];
      if (have == null) unknown.push(`${unit} need ${need}`);
      else if (have < need) missing.push(`${unit} ${have}/${need}`);
    }
    if (missing.length) return { ok: false, reason: 'not enough: ' + missing.join(', ') };
    if (unknown.length) return { ok: true, warning: 'unit count unknown: ' + unknown.join(', ') };
    return { ok: true, reason: 'available' };
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
    return document.querySelector('#mgq_results button[data-mg-a]:not([disabled]), #mgq_results button[data-mg-b]:not([disabled])');
  }

  function firstAButton() {
    return document.querySelector('#mgq_results button[data-mg-a]:not([disabled])');
  }

  function firstBButton() {
    return document.querySelector('#mgq_results button[data-mg-b]:not([disabled])');
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
    for (const v of last) {
      if (!v.greenReport || v.lossBlockA) continue;
      const templateName = v.fullHaul ? 'b' : 'a';
      const btn = document.querySelector(`#mgq_results button[data-mg-${templateName}="${v.id}"]:not([disabled])`);
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

  function removeRow(targetId) {
    const btn = document.querySelector(`[data-mg-a="${targetId}"], [data-mg-b="${targetId}"]`);
    const tr = btn && btn.closest('tr');
    if (tr) tr.remove();
  }

  function sendFarm(targetId, templateName) {
    const target = last.find(v => v.id === targetId);
    if (!target) return status('Target missing. Scan again.');
    const { link, templates, originId } = probeFA();
    const tpl = templates[templateName];
    const avail = checkTemplateAvailable(templateName);

    if (typeof link !== 'string') return status('No FA send URL. Open am_farm.');
    if (!tpl?.id) return status(`No tpl ${templateName.toUpperCase()} id.`);
    if (!avail.ok) return status(`Cannot send ${templateName.toUpperCase()}: ${avail.reason}`);
    if (!originId) return status('No origin id.');
    if (busy) return status('Busy.');
    if (now() - lastClickAt < 250) return status('Too fast.');

    const force = document.getElementById('mgq_force')?.checked;
    if (!force) {
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
        removeRow(target.id);
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

  async function scan() {
    try {
      saveSettings();
      const o = coord(document.getElementById('mgq_origin').value);
      if (!o) throw Error('Bad origin coord');
      const max = +document.getElementById('mgq_dist').value || 20;
      const lim = +document.getElementById('mgq_limit').value || 100;
      const cooldownMin = +document.getElementById('mgq_cd').value || 0;
      const hideCd = document.getElementById('mgq_hide_cd').checked;
      const includeBarb = document.getElementById('mgq_barb').checked;
      const includeBonus = document.getElementById('mgq_bonus').checked;
      probeFA();

      status('Fetching ' + location.origin + '/map/village.txt ...');
      const txt = await fetch(location.origin + '/map/village.txt', { credentials: 'same-origin' }).then(r => {
        if (!r.ok) throw Error('HTTP ' + r.status);
        return r.text();
      });

      const hist = loadHistory();
      const rows = [];
      for (const line of txt.trim().split('\n')) {
        const q = line.split(',');
        if (q.length < 7) continue;
        const v = { id: +q[0], name: dec(q[1]), x: +q[2], y: +q[3], player: +q[4], points: +q[5] };
        if (v.player !== 0) continue;
        v.bonus = /bonus/i.test(v.name);
        v.d = dist(o, v);
        v.coord = v.x + '|' + v.y;
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
        v.cooldown = v.sentAt && cooldownMin > 0 && (now() - v.sentAt) < cooldownMin * 60000;
        if (v.d <= max && ((v.bonus && includeBonus) || (!v.bonus && includeBarb)) && (!hideCd || !v.cooldown)) rows.push(v);
      }

      rows.sort((a, b) => a.d - b.d || b.points - a.points);
      last = rows.slice(0, lim);
      status('Found ' + rows.length + ' / show ' + last.length + ' / bonus ' + last.filter(v => v.bonus).length + '\nA available: ' + availabilityLabel('a') + '\nB available: ' + availabilityLabel('b') + '\nForce. Import. Enter=1st.');

      const aAvail = checkTemplateAvailable('a').ok;
      const bAvail = checkTemplateAvailable('b').ok;
      document.getElementById('mgq_results').innerHTML = '<table style="width:100%;border-collapse:collapse;background:#fff8e8"><tr style="background:#d2b06d"><th>#</th><th>D</th><th>Coord</th><th>T</th><th>Pts</th><th>CD</th><th>Go</th></tr>' + last.map((v, i) => '<tr style="background:' + (v.bonus ? '#e8f4ff' : '#fff8e8') + '"><td>' + (i + 1) + '</td><td>' + v.d.toFixed(2) + '</td><td><a target="_blank" href="' + location.origin + '/game.php?screen=info_village&id=' + v.id + '">' + v.coord + '</a></td><td>' + (v.bonus ? 'Bonus' : 'Barb') + '</td><td>' + v.points + '</td><td>' + (v.sentAt ? minutesAgo(v.sentAt) + 'm' : '-') + (v.result ? ' '+v.result : '') + (v.haulStatus ? ' '+v.haulStatus : '') + (v.rem && !v.haulStatus ? ' R'+v.rem : '') + '</td><td><button data-mg-a="' + v.id + '" ' + (!aAvail || v.lossBlockA ? 'disabled title="' + (!aAvail ? 'A unavailable' : 'A blocked: last report losses/defeat') + '"' : '') + '>A</button><button data-mg-b="' + v.id + '" ' + (!bAvail ? 'disabled title="B unavailable"' : '') + '>B</button></td></tr>').join('') + '</table>';

      document.querySelectorAll('[data-mg-a]').forEach(b => b.onclick = () => sendFarm(+b.dataset.mgA, 'a'));
      document.querySelectorAll('[data-mg-b]').forEach(b => b.onclick = () => sendFarm(+b.dataset.mgB, 'b'));
    } catch (e) {
      console.error(e);
      status('ERROR: ' + e.message);
    }
  }

  document.getElementById('mgq_scan').onclick = scan;
  ensureQuickAButton();
  document.getElementById('mgq_quick_a').onclick = quickSendA;
  document.getElementById('mgq_quick_b').onclick = quickSendB;
  document.getElementById('mgq_quick_send').onclick = quickSendSmart;
  document.getElementById('mgq_probe').onclick = probeFA;
  document.getElementById('mgq_import').onclick = () => { importFAHistory(); scan(); };
  document.getElementById('mgq_clear').onclick = () => { localStorage.removeItem(HISTORY_KEY); status('Cleared. Scan.'); };
  document.getElementById('mgq_copy').onclick = async () => {
    const t = last.map(v => v.coord).join(' ');
    try { await navigator.clipboard.writeText(t); status('Copied ' + last.length + ' coords'); }
    catch { prompt('Copy:', t); }
  };

  ['mgq_dist','mgq_limit','mgq_cd','mgq_hide_cd','mgq_force','mgq_bonus','mgq_barb'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', saveSettings);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && document.getElementById(ID)) {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      const btn = firstSendButton();
      if (btn) { e.preventDefault(); btn.click(); }
    }
  });

    autoImportFAHistory();
    scan();
  };

  return {
    init,
  };
})();

(() => {
  window.MapGodQuickbar.Main.init().catch(e => alert('MapGod error: ' + e.message));
})();
