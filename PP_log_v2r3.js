javascript:(async function () {
    'use strict';

    const VERSION = '1.3.0';
    const APP_ID = 'pp-summary-app';
    const existingApp = document.getElementById(APP_ID);
    if (existingApp && existingApp.dataset.version === VERSION) {
        existingApp.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    }
    if (existingApp) existingApp.remove();

    const $ = window.jQuery;
    if (!$ || !window.game_data) {
        alert('Premium Point Summary: game data is not available. Run this from inside Tribal Wars.');
        return;
    }

    const state = { rows: [], filtered: [], unparsedDates: 0, referenceDate: null, referenceSource: '' };
    const text = node => (node ? node.textContent.replace(/\s+/g, ' ').trim() : '');
    const escapeHtml = value => $('<div>').text(value == null ? '' : String(value)).html();
    const signedNumber = value => {
        const normalized = String(value || '').replace(/[−–—]/g, '-');
        const match = normalized.match(/[+-]?\s*\d[\d.,\s]*/);
        return match ? Number(match[0].replace(/[.,\s]/g, '')) || 0 : 0;
    };
    const format = value => Number(value || 0).toLocaleString((game_data.locale || 'en_DK').replace('_', '-'));
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const request = url => new Promise((resolve, reject) => {
        $.get(url).done(resolve).fail((xhr, status, error) => reject(new Error(error || status || `HTTP ${xhr.status}`)));
    });

    function gameUrl(page) {
        const params = new URLSearchParams({ screen: 'premium', mode: 'log', page: String(page) });
        if (game_data.player && game_data.player.sitter > 0) params.set('t', game_data.player.id);
        return `/game.php?${params.toString()}`;
    }

    // Calendar keys preserve the date displayed by the game, regardless of device timezone.
    function dateKey(year, month, day) {
        year = Number(year); month = Number(month); day = Number(day);
        if (year < 100) year += 2000;
        const check = new Date(Date.UTC(year, month - 1, day));
        if (year < 2000 || year > 2199 || check.getUTCFullYear() !== year ||
            check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    const normalizeDateText = value => String(value || '').normalize('NFD')
        .replace(/[\u0300-\u036f\u200e\u200f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const monthNames = new Map();
    for (const locale of new Set(['en', (game_data.locale || 'en_DK').replace('_', '-')])) {
        for (let month = 1; month <= 12; month++) {
            for (const width of ['short', 'long']) {
                try {
                    const parts = new Intl.DateTimeFormat(locale, { month: width, day: 'numeric', timeZone: 'UTC' })
                        .formatToParts(new Date(Date.UTC(2026, month - 1, 15)));
                    const name = normalizeDateText(parts.find(part => part.type === 'month').value).replace(/\.$/, '');
                    monthNames.set(name, month);
                } catch (_) { /* English names remain available for unsupported locales. */ }
            }
        }
    }
    monthNames.set('sept', 9);

    function dateFromText(raw, order = 'auto', serverDay = null, latestDay = serverDay) {
        const cleaned = normalizeDateText(raw);
        const iso = cleaned.match(/\b(20\d{2}|21\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/);
        if (iso) return dateKey(iso[1], iso[2], iso[3]);

        const numeric = cleaned.match(/\b(\d{1,2})([./-])(\d{1,2})\2(\d{4}|\d{2})\b/);
        if (numeric) {
            const first = Number(numeric[1]), second = Number(numeric[3]);
            const monthFirst = order === 'mdy' || (order === 'auto' &&
                (second > 12 && first <= 12 || first <= 12 && second <= 12 && /^en_US/i.test(game_data.locale || '')));
            return dateKey(numeric[4], monthFirst ? first : second, monthFirst ? second : first);
        }

        // Month names are parsed explicitly; Date.parse differs between Safari and desktop browsers.
        const words = cleaned.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ')
            .replace(/[,.]/g, ' ').split(/\s+/).filter(Boolean);
        for (let i = 0; i < words.length; i++) {
            const month = monthNames.get(words[i]);
            if (!month) continue;
            if (/^\d{1,2}$/.test(words[i - 1] || '') && /^(?:\d{4}|\d{2})$/.test(words[i + 1] || '')) {
                return dateKey(words[i + 1], month, words[i - 1]);
            }
            if (/^\d{1,2}$/.test(words[i + 1] || '') && /^(?:\d{4}|\d{2})$/.test(words[i + 2] || '')) {
                return dateKey(words[i + 2], month, words[i + 1]);
            }
            // The log also renders "Sept 27, 03:42" (no year). Infer the latest
            // possible occurrence using the game date and preceding log entries.
            const day = /^\d{1,2}$/.test(words[i + 1] || '') ? words[i + 1]
                : /^\d{1,2}$/.test(words[i - 1] || '') ? words[i - 1] : null;
            if (day && latestDay) {
                const year = Number(latestDay.slice(0, 4));
                // Four years covers a Feb 29 entry without accepting invalid dates.
                for (let candidateYear = year; candidateYear >= year - 4; candidateYear--) {
                    const candidate = dateKey(candidateYear, month, day);
                    if (candidate && candidate <= latestDay) return candidate;
                }
            }
        }

        if (serverDay && /\b(today|yesterday)\b/.test(cleaned)) {
            const date = new Date(`${serverDay}T00:00:00Z`);
            if (/\byesterday\b/.test(cleaned)) date.setUTCDate(date.getUTCDate() - 1);
            return date.toISOString().slice(0, 10);
        }
        return null;
    }

    function referenceDateFromPage(doc, liveDoc = document, now = new Date()) {
        for (const page of [doc, liveDoc]) {
            const node = page.querySelector('#serverDate');
            if (!node) continue;
            for (const raw of [node.textContent, node.getAttribute('datetime'), node.getAttribute('title')]) {
                const day = dateFromText(raw);
                if (day) return { day, source: 'game date' };
            }
        }
        // Some layouts omit the server date or display it without a year too.
        // Use a visible, editable fallback instead of rejecting every yearless entry.
        return {
            day: dateKey(now.getFullYear(), now.getMonth() + 1, now.getDate()),
            source: 'device date (game date unavailable; adjust Reference date if needed)'
        };
    }

    function resolveDates(rows, order = 'auto', referenceDate = null) {
        let latestDay = null;
        // Keep the fetched newest-first order, across pages and across worlds.
        // Resolve before filtering so changing the selected world cannot change years.
        for (const row of rows) {
            const day = referenceDate || row.serverDay;
            row.date = dateFromText(row.dateText, order, day, latestDay || day);
            row.inferredDate = !!row.date && !dateFromText(row.dateText, order);
            if (row.date) latestDay = row.date;
        }
    }

    function transactionCategory(transaction, details, amount) {
        const value = `${transaction} ${details}`.toLowerCase();
        if (/purchase|kauf|aankoop|compra|acquisto|αγορ/.test(value)) return 'Purchased';
        if (/gift|geschenk|cadeau|presente|regalo|δώρο/.test(value)) return amount >= 0 ? 'Gift received' : 'Gift sent';
        if (/exchange|market|sold|verkauf|börse|mercado|vend|scambio|ανταλλαγ/.test(value)) return amount >= 0 ? 'Exchange income' : 'Exchange spending';
        if (/reward|belohn|recompensa|premio|ricompensa|ανταμοιβ/.test(value)) return 'Reward';
        if (/refund|withdraw|erstatt|terug|reembolso|rimborso|επιστροφ/.test(value)) return 'Refund';
        return amount >= 0 ? 'Other income' : 'Other spending';
    }

    function parsePage(html, page) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        if (!state.referenceDate) {
            const reference = referenceDateFromPage(doc);
            state.referenceDate = reference.day;
            state.referenceSource = reference.source;
        }
        const serverDay = state.referenceDate;
        const candidates = [...doc.querySelectorAll('table.vis tr, table.modern-table tr')];
        const parsed = [];

        candidates.forEach((row, rowIndex) => {
            const cells = [...row.querySelectorAll(':scope > td')];
            if (cells.length < 4) return;
            const values = cells.map(text);
            const amountIndex = values.findIndex((value, index) => index >= 2 && /^[+−–—-]?\s*[\d.,\s]+(?:\s*(?:PP|premium points?))?$/i.test(value));
            if (amountIndex < 2) return;

            const dateText = values[0];
            const date = dateFromText(dateText, 'auto', serverDay);
            const world = values[1] || 'Global / account';
            const transaction = values[2] || 'Unknown';
            const amount = signedNumber(values[amountIndex]);
            const balance = cells[amountIndex + 1] ? signedNumber(values[amountIndex + 1]) : null;
            const details = values.slice(amountIndex + 2).join(' · ');
            if (!dateText || (!amount && !/[+-]?0/.test(values[amountIndex]))) return;

            parsed.push({
                id: `${page}-${rowIndex}-${dateText}-${amount}`,
                page, dateText, date, serverDay, world, transaction, amount, balance, details,
                category: transactionCategory(transaction, details, amount)
            });
        });
        return { doc, rows: parsed };
    }

    function lastPage(doc) {
        let max = 0;
        doc.querySelectorAll('a[href*="page="], option[value*="page="]').forEach(node => {
            const source = node.getAttribute('href') || node.getAttribute('value') || '';
            const match = source.match(/[?&]page=(\d+)/);
            if (match) max = Math.max(max, Number(match[1]));
        });
        return max;
    }

    function mountLoading() {
        $('#pp-summary-style').remove();
        $('head').append(`<style id="pp-summary-style">
            #${APP_ID}{max-width:100%;margin:8px 0;padding:10px;background:#36393f;color:#fff;box-sizing:border-box}
            #${APP_ID} *{box-sizing:border-box}#${APP_ID} h2{margin:0 0 8px;color:#fff}
            #pps-progress-shell{height:24px;background:#202225;border:1px solid #666;position:relative;overflow:hidden}
            #pps-progress{height:100%;width:0;background:#2d9b37;transition:width .2s}
            #pps-progress-text{position:absolute;inset:0;text-align:center;line-height:22px;font-weight:bold}
            #pps-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin:10px 0}
            #pps-filters label{display:flex;flex-direction:column;gap:3px}#pps-filters select,#pps-filters input{height:34px;font-size:16px}
            .pps-cards{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:7px;margin:9px 0}
            .pps-card{background:#202225;padding:9px;border-left:4px solid #888}.pps-card span{display:block;color:#bbb;font-size:12px}.pps-card b{font-size:20px}
            .pps-positive{color:#76d879}.pps-negative{color:#ff8c82}.pps-table-wrap{max-width:100%;overflow:auto;-webkit-overflow-scrolling:touch}
            #${APP_ID} table{width:100%;border-collapse:collapse;min-width:620px}#${APP_ID} th,#${APP_ID} td{padding:6px;border:1px solid #555;text-align:right}
            #${APP_ID} th{background:#202225}#${APP_ID} th:first-child,#${APP_ID} td:first-child{text-align:left}
            #pps-status{margin:7px 0;color:#ddd}#pps-actions{display:flex;gap:7px;flex-wrap:wrap}
            @media(max-width:600px){#${APP_ID}{margin:0;padding:7px}.pps-cards{grid-template-columns:1fr 1fr}.pps-card b{font-size:17px}
            #pps-filters{display:grid;grid-template-columns:1fr 1fr}#pps-filters label,#pps-filters button{min-width:0;width:100%}
            #pps-world{max-width:100%}#pps-actions .btn{flex:1 1 120px}}
        </style>`);
        const host = $('#contentContainer').first().length ? $('#contentContainer').first() : ($('#mobileHeader').first().length ? $('#mobileHeader').first() : $('#content_value').first());
        host.prepend(`<section id="${APP_ID}" data-version="${VERSION}"><h2>Premium Point Log Summary <small>v${VERSION}</small></h2>
            <div id="pps-progress-shell"><div id="pps-progress"></div><div id="pps-progress-text">Opening premium log…</div></div>
            <div id="pps-status">This only reads your Premium Point log.</div><div id="pps-results"></div></section>`);
    }

    function setProgress(done, total, message) {
        $('#pps-progress').css('width', `${total ? done / total * 100 : 0}%`);
        $('#pps-progress-text').text(message || `${done} / ${total} pages`);
    }

    function summarize(rows) {
        const map = new Map();
        rows.forEach(row => {
            if (!map.has(row.world)) map.set(row.world, { world: row.world, income: 0, spending: 0, net: 0, count: 0 });
            const item = map.get(row.world);
            if (row.amount >= 0) item.income += row.amount;
            else item.spending += Math.abs(row.amount);
            item.net += row.amount;
            item.count++;
        });
        return [...map.values()].sort((a, b) => b.net - a.net || a.world.localeCompare(b.world));
    }

    function applyFilters() {
        const world = $('#pps-world').val() || '*';
        const from = $('#pps-from').val();
        const to = $('#pps-to').val();
        const order = $('#pps-date-order').val() || 'auto';
        const referenceDate = $('#pps-reference-date').val() || state.referenceDate;
        if (from && to && from > to) {
            $('#pps-status').text('From date must be on or before To date. Results below are from the last valid filter.');
            $('#pps-export').prop('disabled', true);
            return;
        }
        $('#pps-export').prop('disabled', false);
        const type = $('#pps-type').val() || '*';
        state.unparsedDates = 0;
        resolveDates(state.rows, order, referenceDate);
        state.filtered = state.rows.filter(row => {
            if (world !== '*' && row.world !== world) return false;
            if (type !== '*' && row.category !== type) return false;
            if ((from || to) && !row.date) { state.unparsedDates++; return false; }
            if (from && row.date < from) return false;
            if (to && row.date > to) return false;
            return true;
        });
        renderSummary();
    }

    function renderSummary() {
        const rows = state.filtered;
        const income = rows.reduce((sum, row) => sum + Math.max(0, row.amount), 0);
        const spending = rows.reduce((sum, row) => sum + Math.abs(Math.min(0, row.amount)), 0);
        const net = income - spending;
        const worlds = summarize(rows);
        const unknown = state.rows.filter(row => !row.date);
        const warning = unknown.length ? ` ${unknown.length} log dates could not be read${state.unparsedDates ? `; ${state.unparsedDates} matching entries excluded by the date filter` : ''}. Example: "${unknown[0].dateText}".` : '';
        const range = $('#pps-from').val() || $('#pps-to').val()
            ? ` Date range: ${$('#pps-from').val() || 'earliest'} to ${$('#pps-to').val() || 'latest'} (inclusive, as shown in the game).` : '';
        const inferred = state.rows.some(row => row.inferredDate)
            ? ` Dates without a year use reference date ${$('#pps-reference-date').val() || state.referenceDate} and newest-first log order.` : '';
        $('#pps-status').text(`${format(rows.length)} of ${format(state.rows.length)} transactions selected.${range}${warning}${inferred}`);
        $('#pps-summary').html(`
            <div class="pps-card"><span>Income</span><b class="pps-positive">+${format(income)} PP</b></div>
            <div class="pps-card"><span>Spending</span><b class="pps-negative">-${format(spending)} PP</b></div>
            <div class="pps-card"><span>Net change</span><b class="${net >= 0 ? 'pps-positive' : 'pps-negative'}">${net > 0 ? '+' : ''}${format(net)} PP</b></div>
            <div class="pps-card"><span>Transactions</span><b>${format(rows.length)}</b></div>`);
        $('#pps-world-body').html(worlds.map(item => `<tr>
            <td>${escapeHtml(item.world)}</td><td class="pps-positive">+${format(item.income)}</td>
            <td class="pps-negative">-${format(item.spending)}</td><td class="${item.net >= 0 ? 'pps-positive' : 'pps-negative'}">${item.net > 0 ? '+' : ''}${format(item.net)}</td><td>${format(item.count)}</td>
        </tr>`).join('') || '<tr><td colspan="5">No matching transactions.</td></tr>');
    }

    function csvCell(value) {
        return `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
    }

    function exportCsv() {
        const header = ['Date', 'Resolved date', 'World', 'Category', 'Transaction', 'Amount', 'Balance', 'Details'];
        const lines = [header, ...state.filtered.map(row => [row.dateText, row.date, row.world, row.category, row.transaction, row.amount, row.balance, row.details])]
            .map(values => values.map(csvCell).join(','));
        const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = `premium-point-log-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function mountResults() {
        const worlds = [...new Set(state.rows.map(row => row.world))].sort((a, b) => a.localeCompare(b));
        const types = [...new Set(state.rows.map(row => row.category))].sort();
        $('#pps-results').html(`
            <div id="pps-filters">
                <label>World<select id="pps-world"><option value="*">All worlds</option>${worlds.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('')}</select></label>
                <label>From date<input id="pps-from" type="date"></label><label>To date<input id="pps-to" type="date"></label>
                <label>Log date order<select id="pps-date-order"><option value="auto">Auto</option><option value="dmy">Day / Month / Year</option><option value="mdy">Month / Day / Year</option></select></label>
                <label>Reference date<input id="pps-reference-date" type="date" value="${state.referenceDate}" title="Date the log was loaded, used to infer missing years. Separate from the date range filter."></label>
                <label>Type<select id="pps-type"><option value="*">All types</option>${types.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('')}</select></label>
                <button id="pps-apply" type="button" class="btn">Apply filters</button>
            </div><div id="pps-reference-info">Reference date initially taken from: ${escapeHtml(state.referenceSource)}.</div>
            <div id="pps-summary" class="pps-cards"></div>
            <div class="pps-table-wrap"><table><thead><tr><th>World</th><th>Income</th><th>Spending</th><th>Net</th><th>Entries</th></tr></thead><tbody id="pps-world-body"></tbody></table></div>
            <div id="pps-actions"><button id="pps-export" class="btn">Export selected CSV</button><button id="pps-close" class="btn">Close</button></div>`);
        $('#pps-filters').on('change input', 'select,input', applyFilters);
        $('#pps-apply').on('click', applyFilters);
        $('#pps-export').on('click', exportCsv);
        $('#pps-close').on('click', () => { $(`#${APP_ID}, #pp-summary-style`).remove(); });
        applyFilters();
    }

    mountLoading();
    try {
        const firstHtml = await request(gameUrl(0));
        const first = parsePage(firstHtml, 0);
        const finalPage = lastPage(first.doc);
        const total = finalPage + 1;
        state.rows.push(...first.rows);
        setProgress(1, total, `1 / ${total} pages`);

        for (let page = 1; page <= finalPage; page++) {
            await sleep(150);
            const result = parsePage(await request(gameUrl(page)), page);
            state.rows.push(...result.rows);
            setProgress(page + 1, total, `${page + 1} / ${total} pages`);
        }

        const unique = new Map(state.rows.map(row => [row.id, row]));
        state.rows = [...unique.values()];
        if (!state.rows.length) throw new Error('No Premium Point log entries were detected. Open Premium → Point log once and verify that your account has entries.');
        $('#pps-progress-shell').remove();
        mountResults();
    } catch (error) {
        $('#pps-progress-shell').remove();
        $('#pps-status').html(`<span class="pps-negative">Could not load the Premium Point log: ${escapeHtml(error.message)}</span>`);
        console.error('Premium Point Summary', error);
    }
})();
