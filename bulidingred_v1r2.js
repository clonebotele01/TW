try {
  if (window.ScriptAPI && typeof ScriptAPI.register === 'function') {
    ScriptAPI.register('BuildingRed', true, 'clonebotele01', 'World 155 utility');
  }
} catch (e) {
  console.warn('[BuildingRed] ScriptAPI registration skipped', e);
}

window.BuildingRed = window.BuildingRed || {};
window.BuildingRed.Main = (function () {
  const ID = 'br_panel';
  const SETTINGS_KEY = 'buildingred_settings_v1';

  let rows = [];

  const now = () => Date.now();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = x => parseInt(String(x || '').replace(/[^\d-]/g, ''), 10) || 0;

  function status(text) {
    const el = document.getElementById('br_status');
    if (el) el.textContent = text;
  }

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; }
    catch { return {}; }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      minHours: Math.max(0, +document.getElementById('br_min_hours')?.value || 0),
      minMinutes: Math.max(0, +document.getElementById('br_min_minutes')?.value || 0),
      requireConfirm: document.getElementById('br_confirm')?.checked !== false,
    }));
  }

  function thresholdSeconds() {
    const hours = Math.max(0, +document.getElementById('br_min_hours')?.value || 0);
    const minutes = Math.max(0, +document.getElementById('br_min_minutes')?.value || 0);
    return hours * 3600 + minutes * 60;
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
      completion: headers.findIndex(h => /completion|finish/.test(h)),
    };
  }

  function constructionCell(row) {
    const cells = [...row.querySelectorAll('td')];
    const map = tableHeaderMap(row);
    return cells[map.construction >= 0 ? map.construction : 0] || null;
  }

  function durationCell(row) {
    const cells = [...row.querySelectorAll('td')];
    const map = tableHeaderMap(row);
    if (map.duration >= 0 && cells[map.duration]) return cells[map.duration];
    return null;
  }

  function speedCell(row) {
    const cells = [...row.querySelectorAll('td')];
    const map = tableHeaderMap(row);
    if (map.speed >= 0 && cells[map.speed]) return cells[map.speed];
    return null;
  }

  function readRemainingSeconds(row) {
    const duration = durationCell(row);
    const parsedDuration = parseDurationSeconds(duration?.textContent);
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
    const direct = parseDurationSeconds(timer?.textContent);
    if (direct != null) return direct;

    const cells = [...row.querySelectorAll('td')];
    for (let i = cells.length - 1; i >= 0; i--) {
      const parsed = parseDurationSeconds(cells[i].textContent);
      if (parsed != null) return parsed;
    }
    return null;
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
    const link = clone.querySelector('a');
    const linkText = link?.textContent?.trim();
    if (linkText && !/50\s*%/.test(linkText)) return linkText;
    const text = clone.textContent.replace(/\s+/g, ' ').replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, '').replace(/50\s*%/g, '').trim();
    return text ? text.slice(0, 80) : 'Queue item ' + (index + 1);
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

  function collectRows() {
    const seen = new Set();
    const candidates = [];
    const selectors = [
      '#buildqueue tr',
      '#build_queue tr',
      '#construction_queue tr',
      '#buildqueue_wrap tr',
      'table.vis tr',
    ];
    selectors.forEach(sel => document.querySelectorAll(sel).forEach(row => {
      if (seen.has(row)) return;
      seen.add(row);
      const remaining = readRemainingSeconds(row);
      if (remaining == null) return;
      if (!durationCell(row) && row.querySelector('th')) return;
      if (!findReductionControl(row) && !row.querySelector('.timer, .timer_replace, [class*="timer"], .build_duration, .queue_duration, [data-endtime], [data-end-time], [data-finish], [data-completion]')) return;
      candidates.push(row);
    }));

    rows = candidates.map((row, index) => ({
      index,
      row,
      name: rowLabel(row, index),
      remaining: readRemainingSeconds(row),
      control: findReductionControl(row),
    }));
    return rows;
  }

  function eligibleRows() {
    const threshold = thresholdSeconds();
    return rows.filter(r => r.remaining != null && r.remaining > threshold && r.control);
  }

  function render() {
    saveSettings();
    collectRows();
    const threshold = thresholdSeconds();
    const eligible = eligibleRows();
    const body = rows.map((r, i) => `<tr style="background:${i % 2 ? '#fff8e8' : '#f7ebcd'}">
      <td>${i + 1}</td>
      <td>${esc(r.name)}</td>
      <td>${formatDuration(r.remaining)}</td>
      <td>${r.remaining > threshold ? 'YES' : '-'}</td>
      <td>${r.control ? 'YES' : '-'}</td>
    </tr>`).join('');

    document.getElementById('br_results').innerHTML = `<table style="width:100%;border-collapse:collapse;background:#fff8e8">
      <tr style="background:#d2b06d"><th>#</th><th>Building</th><th>Remaining</th><th>Over min</th><th>50% control</th></tr>
      ${body || '<tr><td colspan="5">No visible building queue found on this page.</td></tr>'}
    </table>`;
    document.getElementById('br_quick').disabled = !eligible.length;
    status(eligible.length
      ? `Ready. Next eligible: ${eligible[0].name} (${formatDuration(eligible[0].remaining)}).`
      : `No visible construction is over ${formatDuration(threshold)} with a detected 50% reduction control.`);
  }

  function quickReduce() {
    collectRows();
    const item = eligibleRows()[0];
    if (!item) {
      render();
      return;
    }

    const requireConfirm = document.getElementById('br_confirm')?.checked !== false;
    if (requireConfirm) {
      const ok = confirm(`Use the visible 50% premium reduction for:\n\n${item.name}\nRemaining: ${formatDuration(item.remaining)}\n\nThis may spend Premium Points.`);
      if (!ok) return;
    }

    item.control.click();
    status(`Clicked 50% reduction for ${item.name}. Refreshing queue check...`);
    setTimeout(render, 900);
  }

  function init() {
    document.getElementById(ID)?.remove();
    const s = loadSettings();
    const panel = document.createElement('div');
    panel.id = ID;
    panel.style.cssText = 'position:fixed;z-index:2147483647;top:70px;right:20px;width:min(96vw,720px);max-height:82vh;overflow:auto;background:#f4e4bc;color:#2b1a0f;border:2px solid #7d510f;box-shadow:0 8px 30px #0008;font:12px Verdana,Arial;padding:6px';
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;background:#7d510f;color:white;padding:6px;margin:-6px -6px 8px -6px">
        <b>BuildingRed v1.0</b><button id="br_x">X</button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <label>Min h <input id="br_min_hours" type="number" value="${s.minHours ?? Math.floor((s.minMinutes ?? 60) / 60)}" min="0" style="width:50px"></label>
        <label>Min m <input id="br_min_minutes" type="number" value="${s.minHours == null ? ((s.minMinutes ?? 60) % 60) : (s.minMinutes ?? 0)}" min="0" max="59" style="width:50px"></label>
        <label><input id="br_confirm" type="checkbox" ${s.requireConfirm === false ? '' : 'checked'}> confirm spend</label>
        <button id="br_refresh">Check queue</button>
        <button id="br_quick">Quick 50%</button>
      </div>
      <pre id="br_status" style="background:#fff8e8;border:1px solid #c9a45c;padding:6px;white-space:pre-wrap">Ready</pre>
      <div id="br_results"></div>
    `;
    document.body.appendChild(panel);
    document.getElementById('br_x').onclick = () => panel.remove();
    document.getElementById('br_refresh').onclick = render;
    document.getElementById('br_quick').onclick = quickReduce;
    ['br_min_hours','br_min_minutes','br_confirm'].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', render);
    });
    render();
  }

  return { init };
})();

(() => window.BuildingRed.Main.init())();
