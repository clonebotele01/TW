javascript:(async function () {
    'use strict';

    const APP_ID = 'pp-summary-app';
    if (document.getElementById(APP_ID)) {
        document.getElementById(APP_ID).scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    }

    const $ = window.jQuery;
    if (!$ || !window.game_data) {
        alert('Premium Point Summary: game data is not available. Run this from inside Tribal Wars.');
        return;
    }

    const state = { rows: [], filtered: [], unparsedDates: 0 };
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

    function dateFromText(raw, cell) {
        const timestampNode = cell && cell.querySelector('[data-timestamp], [data-time]');
        const timestamp = timestampNode && (timestampNode.dataset.timestamp || timestampNode.dataset.time);
        if (timestamp && /^\d+$/.test(timestamp)) {
            const numeric = Number(timestamp);
            return new Date(numeric < 100000000000 ? numeric * 1000 : numeric);
        }

        const cleaned = String(raw || '').replace(/\bat\b/gi, ' ').replace(/\s+/g, ' ').trim();
        const iso = cleaned.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?:[^\d]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
        if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3], +(iso[4] || 0), +(iso[5] || 0), +(iso[6] || 0));

        const numeric = cleaned.match(/\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})(?:[^\d]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
        if (numeric) {
            const locale = game_data.locale || '';
            const monthFirst = /^en_US/i.test(locale);
            const day = +(monthFirst ? numeric[2] : numeric[1]);
            const month = +(monthFirst ? numeric[1] : numeric[2]);
            return new Date(+numeric[3], month - 1, day, +(numeric[4] || 0), +(numeric[5] || 0), +(numeric[6] || 0));
        }

        const native = new Date(cleaned);
        return Number.isNaN(native.getTime()) ? null : native;
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
        const candidates = [...doc.querySelectorAll('table.vis tr, table.modern-table tr')];
        const parsed = [];

        candidates.forEach((row, rowIndex) => {
            const cells = [...row.querySelectorAll(':scope > td')];
            if (cells.length < 4) return;
            const values = cells.map(text);
            const amountIndex = values.findIndex((value, index) => index >= 2 && /^[+−–—-]?\s*[\d.,\s]+(?:\s*(?:PP|premium points?))?$/i.test(value));
            if (amountIndex < 2) return;

            const dateText = values[0];
            const date = dateFromText(dateText, cells[0]);
            const world = values[1] || 'Global / account';
            const transaction = values[2] || 'Unknown';
            const amount = signedNumber(values[amountIndex]);
            const balance = cells[amountIndex + 1] ? signedNumber(values[amountIndex + 1]) : null;
            const details = values.slice(amountIndex + 2).join(' · ');
            if (!dateText || (!amount && !/[+-]?0/.test(values[amountIndex]))) return;

            parsed.push({
                id: `${page}-${rowIndex}-${dateText}-${amount}`,
                page, dateText, date, world, transaction, amount, balance, details,
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
        host.prepend(`<section id="${APP_ID}"><h2>Premium Point Log Summary</h2>
            <div id="pps-progress-shell"><div id="pps-progress"></div><div id="pps-progress-text">Opening premium log…</div></div>
            <div id="pps-status">This only reads your Premium Point log.</div><div id="pps-results"></div></section>`);
    }

    function setProgress(done, total, message) {
        $('#pps-progress').css('width', `${total ? done / total * 100 : 0}%`);
        $('#pps-progress-text').text(message || `${done} / ${total} pages`);
    }

    function localDateInput(date, endOfDay) {
        if (!date) return null;
        const parsed = new Date(`${date}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
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
        const from = localDateInput($('#pps-from').val(), false);
        const to = localDateInput($('#pps-to').val(), true);
        const type = $('#pps-type').val() || '*';
        state.unparsedDates = 0;
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
        const warning = state.unparsedDates ? ` ${state.unparsedDates} entries with an unrecognized date were excluded.` : '';
        $('#pps-status').text(`${format(rows.length)} transactions selected.${warning}`);
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
        const header = ['Date', 'World', 'Category', 'Transaction', 'Amount', 'Balance', 'Details'];
        const lines = [header, ...state.filtered.map(row => [row.dateText, row.world, row.category, row.transaction, row.amount, row.balance, row.details])]
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
                <label>Type<select id="pps-type"><option value="*">All types</option>${types.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('')}</select></label>
            </div><div id="pps-summary" class="pps-cards"></div>
            <div class="pps-table-wrap"><table><thead><tr><th>World</th><th>Income</th><th>Spending</th><th>Net</th><th>Entries</th></tr></thead><tbody id="pps-world-body"></tbody></table></div>
            <div id="pps-actions"><button id="pps-export" class="btn">Export selected CSV</button><button id="pps-close" class="btn">Close</button></div>`);
        $('#pps-filters').on('change input', 'select,input', applyFilters);
        $('#pps-export').on('click', exportCsv);
        $('#pps-close').on('click', () => { $(`#${APP_ID}, #pp-summary-style`).remove(); });
        state.filtered = state.rows.slice();
        renderSummary();
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
        state.rows = [...unique.values()].sort((a, b) => {
            if (a.date && b.date) return b.date - a.date;
            return a.page - b.page;
        });
        if (!state.rows.length) throw new Error('No Premium Point log entries were detected. Open Premium → Point log once and verify that your account has entries.');
        $('#pps-progress-shell').remove();
        mountResults();
    } catch (error) {
        $('#pps-progress-shell').remove();
        $('#pps-status').html(`<span class="pps-negative">Could not load the Premium Point log: ${escapeHtml(error.message)}</span>`);
        console.error('Premium Point Summary', error);
    }
})();
