javascript:(async function () {
    'use strict';

    if (window.__resSenderV3Running) {
        UI.InfoMessage('Resource Sender is already open.');
        return;
    }
    window.__resSenderV3Running = true;

    const $ = window.jQuery;
    const RES_RATIO = { wood: 28000 / 83000, stone: 30000 / 83000, iron: 25000 / 83000 };
    const state = {
        villages: [],
        target: null,
        sent: { wood: 0, stone: 0, iron: 0 },
        keepPercent: Number(sessionStorage.getItem('resSender.keepPercent') || 0)
    };

    const number = value => {
        const match = String(value == null ? '' : value).match(/-?\d[\d.,]*/);
        return match ? (Number(match[0].replace(/[.,]/g, '')) || 0) : 0;
    };
    const coordFrom = value => (String(value || '').match(/\b\d{1,3}\|\d{1,3}\b/) || [])[0] || '';
    const format = value => Math.floor(value || 0).toLocaleString(game_data.locale.replace('_', '-'));
    const escapeHtml = value => $('<div>').text(value == null ? '' : value).html();
    const gameUrl = params => {
        const query = new URLSearchParams(params);
        if (game_data.player.sitter > 0) query.set('t', game_data.player.id);
        return `/game.php?${query.toString()}`;
    };

    function removeUi() {
        $('#rs3-root, #rs3-style').remove();
        window.__resSenderV3Running = false;
    }

    function request(url) {
        return new Promise((resolve, reject) => {
            $.get(url).done(resolve).fail((xhr, status, error) => reject(new Error(error || status)));
        });
    }

    function parseVillageBlock(villageNode, index, doc) {
        const $village = $(villageNode);
        let $block = $village.closest('tr');
        if (!$block.length) $block = $village.closest('.mobile_village, .village, li');
        if (!$block.length) $block = $village.parent();

        const mobile = !!doc.querySelector('#mobileHeader') || $block.find('.mwood, .mstone, .miron').length > 0;
        const resource = kind => {
            const desktopClass = kind === 'wood' ? 'wood' : kind === 'stone' ? 'stone' : 'iron';
            const mobileClass = kind === 'wood' ? 'mwood' : kind === 'stone' ? 'mstone' : 'miron';
            const localValue = number($block.find(`.${mobile ? mobileClass : desktopClass}`).first().text());
            // Some mobile layouts render village data as sibling blocks, so it is not
            // necessarily contained by the element holding .quickedit-vn.
            return localValue || (mobile ? number($(doc).find(`.${mobileClass}`).eq(index).text()) : 0);
        };

        let warehouse = number($block.find('.warehouse, .storage').first().text());
        let merchantsText = $block.find('.trader, .market, .trader_img').first().parent().text();
        let merchantsMatch = merchantsText.match(/(\d[\d.,]*)\s*\/\s*(\d[\d.,]*)/);
        let populationText = $block.find('.population, .farm').first().parent().text();
        let populationMatch = populationText.match(/(\d[\d.,]*)\s*\/\s*(\d[\d.,]*)/);

        // Fall back to the original overview column order on desktop.
        const $ironCell = $block.find('.iron, .miron').first().closest('td');
        if (!warehouse && $ironCell.length) warehouse = number($ironCell.next().text());
        if (!merchantsMatch && $ironCell.length) merchantsMatch = $ironCell.next().next().text().match(/(\d[\d.,]*)\s*\/\s*(\d[\d.,]*)/);
        if (!populationMatch && $ironCell.length) populationMatch = $ironCell.next().next().next().text().match(/(\d[\d.,]*)\s*\/\s*(\d[\d.,]*)/);

        // Mobile production overview exposes these as parallel elements rather than table cells.
        if (!warehouse) warehouse = number($(doc).find('.mheader.ressources').eq(index).parent().text());
        if (!merchantsMatch) {
            // The first trader image on mobile is often the column heading. Select
            // only parents which actually contain a number to avoid that offset.
            const merchantNodes = [...doc.querySelectorAll('.trader_img')]
                .map(node => node.parentElement)
                .filter((node, pos, list) => node && list.indexOf(node) === pos && /\d/.test(node.textContent));
            merchantsText = merchantNodes[index] ? merchantNodes[index].textContent : '';
            merchantsMatch = merchantsText.match(/(\d[\d.,]*)\s*\/\s*(\d[\d.,]*)/) || merchantsText.match(/\d[\d.,]*/);
        }
        if (!populationMatch) {
            populationText = $(doc).find('.header.population').eq(index).parent().text();
            populationMatch = populationText.match(/(\d[\d.,]*)\s*\/\s*(\d[\d.,]*)/);
        }

        const name = $village.text().trim();
        const coord = coordFrom(name);
        const link = $village.find('a').first().prop('href') || '';
        const id = number($village.attr('data-id')) || number((link.match(/[?&]village=(\d+)/) || [])[1]);
        if (!id || !coord) return null;

        return {
            id, coord, name, url: link,
            wood: resource('wood'), stone: resource('stone'), iron: resource('iron'),
            warehouse,
            availableMerchants: merchantsMatch ? number(merchantsMatch[1] || merchantsMatch[0]) : 0,
            totalMerchants: merchantsMatch && merchantsMatch[2] ? number(merchantsMatch[2]) : 0,
            farmUsed: populationMatch ? number(populationMatch[1]) : 0,
            farmTotal: populationMatch ? number(populationMatch[2]) : 0
        };
    }

    async function loadVillages() {
        const html = await request(gameUrl({ screen: 'overview_villages', mode: 'prod', page: '-1' }));
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const nodes = [...doc.querySelectorAll('.quickedit-vn')];
        const villages = nodes.map((node, index) => parseVillageBlock(node, index, doc)).filter(Boolean);
        if (!villages.length) throw new Error('No villages were found in the production overview.');
        return villages;
    }

    async function loadTarget(coord) {
        const json = await request(gameUrl({ screen: 'api', ajax: 'target_selection', input: coord, type: 'coord' }));
        const village = json && json.villages && json.villages[0];
        if (!village) throw new Error(`No village exists at ${coord}.`);
        return {
            id: number(village.id), name: village.name, image: village.image,
            player: village.player_name || '-', points: village.points,
            x: number(village.x), y: number(village.y), coord
        };
    }

    function calculate(village) {
        const carry = village.availableMerchants * 1000;
        const leave = Math.floor(village.warehouse * state.keepPercent / 100);
        const available = {
            wood: Math.max(0, village.wood - leave),
            stone: Math.max(0, village.stone - leave),
            iron: Math.max(0, village.iron - leave)
        };
        let scale = 1;
        for (const type of ['wood', 'stone', 'iron']) {
            const planned = carry * RES_RATIO[type];
            if (planned > 0) scale = Math.min(scale, available[type] / planned);
        }
        return {
            wood: Math.floor(carry * RES_RATIO.wood * scale),
            stone: Math.floor(carry * RES_RATIO.stone * scale),
            iron: Math.floor(carry * RES_RATIO.iron * scale)
        };
    }

    function distance(from, target) {
        const [x, y] = from.split('|').map(Number);
        return Math.round(Math.hypot(target.x - x, target.y - y));
    }

    function renderRows() {
        const target = state.target;
        const rows = state.villages.map(village => ({ village, res: calculate(village) }))
            .filter(item => item.village.id !== target.id && item.res.wood + item.res.stone + item.res.iron > 0)
            .sort((a, b) => distance(a.village.coord, target) - distance(b.village.coord, target));

        $('#rs3-target-info').html(`
            <div><strong>${escapeHtml(target.name)}</strong> (${escapeHtml(target.coord)})</div>
            <div>${escapeHtml(target.player)} · ${format(target.points)} points</div>
            <div class="rs3-sent">Sent: <span class="icon header wood"></span><b id="rs3-sent-wood">${format(state.sent.wood)}</b>
            <span class="icon header stone"></span><b id="rs3-sent-stone">${format(state.sent.stone)}</b>
            <span class="icon header iron"></span><b id="rs3-sent-iron">${format(state.sent.iron)}</b></div>`);

        $('#rs3-body').html(rows.map(({ village, res }) => `
            <tr data-source-id="${village.id}">
                <td><a href="${escapeHtml(village.url)}">${escapeHtml(village.name)}</a></td>
                <td>${distance(village.coord, target)}</td>
                <td>${format(res.wood)}</td><td>${format(res.stone)}</td><td>${format(res.iron)}</td>
                <td><button class="btn btn-confirm-yes rs3-send" data-source="${village.id}"
                    data-wood="${res.wood}" data-stone="${res.stone}" data-iron="${res.iron}">Send</button></td>
            </tr>`).join('') || '<tr><td colspan="6">No village currently has resources and merchants available.</td></tr>');
    }

    async function chooseTarget(coord) {
        if (!coordFrom(coord)) {
            UI.ErrorMessage('Please select a village or enter a coordinate such as 500|500.');
            return;
        }
        const $button = $('#rs3-apply').prop('disabled', true);
        try {
            state.keepPercent = Math.max(0, Math.min(100, number($('#rs3-keep').val())));
            state.target = await loadTarget(coordFrom(coord));
            sessionStorage.setItem('resSender.target', state.target.coord);
            sessionStorage.setItem('resSender.keepPercent', state.keepPercent);
            $('#rs3-coordinate').val(state.target.coord);
            renderRows();
        } catch (error) {
            UI.ErrorMessage(error.message);
        } finally {
            $button.prop('disabled', false);
        }
    }

    function mount() {
        $('head').append(`<style id="rs3-style">
            #rs3-root{box-sizing:border-box;max-width:100%;margin:8px 0;padding:8px;background:#36393f;color:#fff}
            #rs3-root *{box-sizing:border-box} #rs3-controls{display:flex;flex-wrap:wrap;gap:8px;align-items:end}
            #rs3-controls label{display:flex;flex-direction:column;gap:3px;min-width:120px}
            #rs3-controls select,#rs3-controls input{height:34px;max-width:100%;font-size:16px}
            #rs3-village-select{width:min(420px,90vw)} #rs3-coordinate{width:110px} #rs3-keep{width:75px}
            #rs3-target-info{margin:10px 0;padding:8px;background:#202225;line-height:1.6}
            #rs3-table-wrap{width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}
            #rs3-table{width:100%;min-width:620px;border-collapse:collapse}
            #rs3-table th,#rs3-table td{padding:7px;text-align:center} #rs3-table th{background:#202225}
            #rs3-table tbody tr:nth-child(odd){background:#32353b} #rs3-table tbody tr:nth-child(even){background:#3e4147}
            #rs3-table td:first-child{text-align:left} .rs3-sent{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
            @media(max-width:600px){#rs3-root{margin:0;padding:6px}#rs3-controls>*{flex:1 1 135px}.rs3-send{min-height:38px}}
        </style>`);

        const options = state.villages.map(v => `<option value="${v.coord}">${escapeHtml(v.name)}</option>`).join('');
        const root = `<div id="rs3-root">
            <div id="rs3-controls">
                <label>My target village<select id="rs3-village-select"><option value="">Choose a village…</option>${options}</select></label>
                <label>Or coordinate<input id="rs3-coordinate" inputmode="numeric" placeholder="500|500" maxlength="7"></label>
                <label>Keep warehouse %<input id="rs3-keep" type="number" min="0" max="100" value="${state.keepPercent}"></label>
                <button id="rs3-apply" class="btn btn-confirm-yes">Calculate</button>
                <button id="rs3-close" class="btn">Close</button>
            </div>
            <div id="rs3-target-info">Choose one of your villages above, or enter any coordinate.</div>
            <div id="rs3-table-wrap"><table id="rs3-table"><thead><tr>
                <th>Source village</th><th>Distance</th><th>Wood</th><th>Clay</th><th>Iron</th><th></th>
            </tr></thead><tbody id="rs3-body"></tbody></table></div>
        </div>`;
        const $host = $('#contentContainer').first().length ? $('#contentContainer').first() : ($('#mobileHeader').first().length ? $('#mobileHeader').first() : $('#content_value').first());
        $host.prepend(root);

        $('#rs3-village-select').on('change', function () {
            if (this.value) $('#rs3-coordinate').val(this.value);
        });
        $('#rs3-apply').on('click', () => chooseTarget($('#rs3-coordinate').val()));
        $('#rs3-close').on('click', removeUi);
        $('#rs3-coordinate').on('keydown', event => { if (event.key === 'Enter') chooseTarget(event.currentTarget.value); });
        $('#rs3-body').on('click', '.rs3-send', send);

        const saved = coordFrom(sessionStorage.getItem('resSender.target'));
        const initial = saved || (state.villages.find(v => v.id === number(game_data.village && game_data.village.id)) || {}).coord;
        if (initial) {
            $('#rs3-coordinate, #rs3-village-select').val(initial);
            chooseTarget(initial);
        }
    }

    function send(event) {
        const $button = $(event.currentTarget);
        const source = number($button.data('source'));
        const payload = { wood: number($button.data('wood')), stone: number($button.data('stone')), iron: number($button.data('iron')) };
        $button.prop('disabled', true);
        const pending = TribalWars.post('market', { ajaxaction: 'map_send', village: source }, {
            target_id: state.target.id, wood: payload.wood, stone: payload.stone, iron: payload.iron
        }, response => {
            state.sent.wood += payload.wood; state.sent.stone += payload.stone; state.sent.iron += payload.iron;
            $('#rs3-sent-wood').text(format(state.sent.wood));
            $('#rs3-sent-stone').text(format(state.sent.stone));
            $('#rs3-sent-iron').text(format(state.sent.iron));
            $button.closest('tr').remove();
            UI.SuccessMessage(response.message);
        }, false);
        if (pending && typeof pending.fail === 'function') pending.fail(() => $button.prop('disabled', false));
    }

    try {
        state.villages = await loadVillages();
        mount();
    } catch (error) {
        window.__resSenderV3Running = false;
        UI.ErrorMessage(`Resource Sender: ${error.message}`);
        console.error('Resource Sender V3', error);
    }
})();
