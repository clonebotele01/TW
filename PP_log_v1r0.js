// ==UserScript==
// @name        PP_v1r0
// @description Premium Points activity log - refined and more robust
// @version     1.0
// @match       *game.php*screen=premium*&mode=log*
// @grant       none
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'PPLogShinko';

    // Ensure we are on the premium log page; if not, navigate there safely.
    (function ensurePremiumLogPage(){
      try {
        const params = new URLSearchParams(window.location.search);
        const isScreenPremium = params.get('screen') === 'premium' || /screen=premium/.test(window.location.href);
        const isModeLog = params.get('mode') === 'log' || /mode=log/.test(window.location.href);
        const hasPage = params.has('page') || /[?&]page=\d+/.test(window.location.href);

        if (!isScreenPremium || !isModeLog || !hasPage) {
          if (window.game_data && game_data.link_base_pure) {
            window.location.assign(game_data.link_base_pure + 'premium&mode=log&page=0');
          } else {
            const url = new URL(window.location.href);
            url.searchParams.set('screen', 'premium');
            url.searchParams.set('mode', 'log');
            url.searchParams.set('page', '0');
            window.location.assign(url.pathname + '?' + url.searchParams.toString());
          }
          return; // navigation in progress
        }
      } catch (e) {
        console.error('ensurePremiumLogPage error', e);
      }
    })();

    // Small helper to parse integers from text safely
    function safeInt(text) {
      if (!text && text !== 0) return 0;
      try {
        const cleaned = String(text).replace(/[^0-9\-]/g, '');
        return parseInt(cleaned || '0', 10);
      } catch (e) {
        return 0;
      }
    }

    // Determine the last page index from pager elements
    function safeAmountOfPages() {
      try {
        const items = Array.from(document.querySelectorAll('.paged-nav-item'));
        if (!items || items.length === 0) return 0;
        const last = items[items.length - 1];
        const m = (last && last.href) ? last.href.match(/page=(\d+)/) : null;
        return m ? parseInt(m[1], 10) : 0;
      } catch (e) {
        console.error('safeAmountOfPages error', e);
        return 0;
      }
    }

    // Load previous data from localStorage
    function loadStored() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch (e) {
        console.warn('Could not parse stored PP log', e);
        return null;
      }
    }

    // Save collected data
    function saveStored(data) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch (e) {
        console.error('Failed to save PP log', e);
      }
    }

    // Minimal localization map; falls back to English keys
    const langShinko = {
      default: {
        'Purchase': 'Purchase',
        'Premium Exchange': 'Premium Exchange',
        'Points redeemed': 'Points redeemed',
        'Transfer': 'Transfer',
        'Sold': 'sold',
        'giftTo': 'to: ',
        'giftFrom': 'from: ',
        'Free premium points': 'Free premium points',
        'Endgame reward': 'Endgame reward',
        'Manually': 'Manually',
        'Withdrawn': 'Withdrawn'
      }
    };

    function t(key) {
      try {
        const locale = (window.game_data && game_data.locale) ? game_data.locale : 'default';
        return (langShinko[locale] && langShinko[locale][key]) || (langShinko.default[key]) || key;
      } catch (e) {
        return key;
      }
    }

    // Main parsing routine
    (function main() {
      const stored = loadStored();
      let stopDate = 0, stopChange = 0;
      let purchases = [], spending = [], farmed = [], worldReward = [], yearlyReward = [], refunds = [];
      let totalRefunds = 0, totalYearlyReward = 0, totalBought = 0, totalSpent = 0, totalFarmed = 0, totalGiftsReceived = 0, totalWorldReward = 0, totalGiftsSent = 0;
      let giftTo = [], giftFrom = [], worldDataBase = {};

      if (stored) {
        stopDate = stored.lastDate || 0;
        stopChange = stored.lastChange || 0;
        purchases = stored.purchases || [];
        spending = stored.spending || [];
        farmed = stored.farmed || [];
        worldReward = stored.worldReward || [];
        yearlyReward = stored.yearlyReward || [];
        refunds = stored.refunds || [];
        totalRefunds = stored.totalRefunds || 0;
        totalYearlyReward = stored.totalYearlyReward || 0;
        totalBought = stored.totalBought || 0;
        totalSpent = stored.totalSpent || 0;
        totalFarmed = stored.totalFarmed || 0;
        totalGiftsReceived = stored.totalGiftsReceived || 0;
        totalWorldReward = stored.totalWorldReward || 0;
        totalGiftsSent = stored.totalGiftsSent || 0;
        giftTo = stored.giftTo || [];
        giftFrom = stored.giftFrom || [];
        worldDataBase = stored.worldDataBase || {};
      }

      const baseURL = (window.game_data && game_data.player && game_data.player.sitter > 0)
        ? `/game.php?t=${game_data.player.id}&screen=premium&mode=log&page=`
        : '/game.php?&screen=premium&mode=log&page=';

      const amountOfPages = safeAmountOfPages();
      const totalPages = amountOfPages + 1;

      // Build URL list
      const URLs = [];
      for (let i = 0; i <= amountOfPages; i++) URLs.push(baseURL + i);

      // Simple progress UI (non-intrusive)
      (function injectProgress(){
        try {
          const container = document.getElementById('contentContainer') || document.getElementById('mobileHeader');
          const width = container ? container.clientWidth : 300;
          const progressHtml = `\n<div id="progressbar" class="progress-bar progress-bar-alive">\n  <span id="count" class="label">0/${totalPages}</span>\n  <div id="progress"><span id="count2" class="label" style="width: ${width}px;">0/${totalPages}</span></div>\n</div>`;
          if (container) container.prepend($(progressHtml));
        } catch (e) { /* ignore */ }
      })();

      // Sequential loader similar to original, with throttling
      $.getAll = function (urls, onLoad, onDone, onError) {
        let numDone = 0;
        let lastRequestTime = 0;
        const minWaitTime = 200; // ms between requests

        function loadNext() {
          if (numDone === urls.length) { onDone(); return; }

          const now = Date.now();
          const elapsed = now - lastRequestTime;
          if (elapsed < minWaitTime) {
            setTimeout(loadNext, minWaitTime - elapsed);
            return;
          }

          $('#progress').css('width', `${(numDone + 1) / urls.length * 100}%`);
          $('#count').text(`${(numDone + 1)} / ${urls.length}`);
          $('#count2').text(`${(numDone + 1)} / ${urls.length}`);
          lastRequestTime = now;

          $.get(urls[numDone]).done((data) => {
            try {
              onLoad(numDone, data);
              ++numDone;
              loadNext();
            } catch (e) { onError(e); }
          }).fail((xhr) => { onError(xhr); });
        }

        loadNext();
      };

      $.getAll(URLs,
        (i, data) => {
          console.log('Grabbing page ' + i);
          const tempRows = $(data).find('table.vis > tbody > tr');

          if (i === 0 && tempRows.length >= 3) {
            const firstRow = tempRows.eq(2);
            stopDate = firstRow.children().eq(0).text().trim();
            stopChange = firstRow.children().eq(3).text().trim();
          }

          let thisPageAmount = 0;

          // iterate rows starting from index 2 (original page format had headers/footers)
          for (let r = 2; r < tempRows.length; r++) {
            try {
              const row = tempRows[r];
              if (!row || !row.children) continue;
              const getCell = (idx) => (row.children[idx] && row.children[idx].innerText) ? row.children[idx].innerText.trim() : '';
              const dateCell = getCell(0);
              const worldCell = getCell(1);
              const transactionCell = getCell(2);
              const amountCell = getCell(3);
              const newTotalCell = getCell(4);
              const moreInfoCell = getCell(5);

              if (dateCell === stopDate && transactionCell === stopChange) {
                console.log('REACHED PREVIOUS LAST ENTRY');
                return; // stop entire load by returning early from onLoad; getAll will continue but will quickly finish since we don't push more
              }

              // Purchase
              if (transactionCell.indexOf(t('Purchase')) > -1) {
                purchases.push({ Date: dateCell, World: worldCell, Transaction: transactionCell, Amount: amountCell, newTotal: newTotalCell, moreInformation: moreInfoCell });
                worldDataBase[worldCell] = worldDataBase[worldCell] || { Purchases: 0, Spending: 0, Farming: 0 };
                const amt = safeInt(amountCell);
                worldDataBase[worldCell].Purchases += amt;
                totalBought += amt;
                thisPageAmount++;
              }

              // Spending
              if (transactionCell.indexOf(t('Premium Exchange')) > -1 || transactionCell.indexOf(t('Points redeemed')) > -1) {
                spending.push({ Date: dateCell, World: worldCell, Transaction: transactionCell, Amount: amountCell, newTotal: newTotalCell, moreInformation: moreInfoCell });
                worldDataBase[worldCell] = worldDataBase[worldCell] || { Purchases: 0, Spending: 0, Farming: 0 };
                const amt = safeInt(amountCell);
                worldDataBase[worldCell].Spending += -amt;
                totalSpent += -amt;
                thisPageAmount++;
              }

              // PP farm (Transfer + Sold/Premium Exchange info)
              if (transactionCell.indexOf(t('Transfer')) > -1 && (moreInfoCell.indexOf(t('Sold')) > -1 || moreInfoCell.indexOf(t('Premium Exchange')) > -1)) {
                farmed.push({ Date: dateCell, World: worldCell, Transaction: transactionCell, Amount: amountCell, newTotal: newTotalCell, moreInformation: moreInfoCell });
                worldDataBase[worldCell] = worldDataBase[worldCell] || { Purchases: 0, Spending: 0, Farming: 0 };
                const amt = safeInt(amountCell);
                worldDataBase[worldCell].Farming += amt;
                totalFarmed += amt;
                thisPageAmount++;
              }

              // gifted to others
              if (moreInfoCell.indexOf(t('giftTo')) === 0) {
                giftTo.push({ Date: dateCell, World: worldCell, Transaction: transactionCell, Amount: amountCell, newTotal: newTotalCell, moreInformation: moreInfoCell });
                totalGiftsSent += -safeInt(amountCell);
                thisPageAmount++;
              }

              // gifts received
              if (moreInfoCell.indexOf(t('giftFrom')) > -1) {
                giftFrom.push({ Date: dateCell, World: worldCell, Transaction: transactionCell, Amount: amountCell, newTotal: newTotalCell, moreInformation: moreInfoCell });
                totalGiftsReceived += safeInt(amountCell);
                thisPageAmount++;
              }

              // yearly reward
              if (transactionCell.indexOf(t('Free premium points')) > -1) {
                yearlyReward.push({ Date: dateCell, World: worldCell, Transaction: transactionCell, Amount: amountCell, newTotal: newTotalCell, moreInformation: moreInfoCell });
                totalYearlyReward += safeInt(amountCell);
                thisPageAmount++;
              }

              // endgame reward
              if (transactionCell.indexOf(t('Endgame reward')) > -1) {
                worldReward.push({ Date: dateCell, World: worldCell, Transaction: transactionCell, Amount: amountCell, newTotal: newTotalCell, moreInformation: moreInfoCell });
                totalWorldReward += safeInt(amountCell);
                thisPageAmount++;
              }

              // refunds
              if (transactionCell.indexOf(t('Withdrawn')) > -1 || transactionCell.indexOf(t('Manually')) > -1) {
                refunds.push({ Date: dateCell, World: worldCell, Transaction: transactionCell, Amount: amountCell, newTotal: newTotalCell, moreInformation: moreInfoCell });
                totalRefunds += safeInt(amountCell);
                thisPageAmount++;
              }

            } catch (e) {
              console.warn('row parse error', e);
            }
          }

          if (thisPageAmount < tempRows.length - 2) console.log('MISSING ENTRIES ON PAGE ' + (i + 1) + ': ' + (tempRows.length - 2 - thisPageAmount));
          if (thisPageAmount > tempRows.length - 2) console.log('EXTRA ENTRIES ON PAGE ' + (i + 1) + ': ' + (thisPageAmount - tempRows.length - 2));
        },
        () => {
          // done handler
          const storeData = {
            lastDate: stopDate,
            lastChange: stopChange,
            purchases: purchases,
            spending: spending,
            farmed: farmed,
            worldReward: worldReward,
            yearlyReward: yearlyReward,
            refunds: refunds,
            totalRefunds: totalRefunds,
            totalYearlyReward: totalYearlyReward,
            totalBought: totalBought,
            totalSpent: totalSpent,
            totalFarmed: totalFarmed,
            totalGiftsReceived: totalGiftsReceived,
            totalWorldReward: totalWorldReward,
            totalGiftsSent: totalGiftsSent,
            giftTo: giftTo,
            giftFrom: giftFrom,
            worldDataBase: worldDataBase
          };

          saveStored(storeData);

          // Build HTML summary (concise)
          let html = `\n<tr><th colspan=7><center>PP Purchase log</center></th></tr>`;
          html += `\n<tr><th colspan=7><center><h2>Total pp spent: ${-totalSpent} pp</h2></center></th></tr>`;
          html += `\n<tr><th colspan=7><center><h2>Total pp farmed: ${totalFarmed} pp</h2></center></th></tr>`;
          html += `\n<tr><th colspan=7><center><h2>Total pp bought: ${totalBought} pp</h2></center></th></tr>`;
          html += `\n<tr><th colspan=7><center><h2>Total gifts received: ${totalGiftsReceived} pp</h2></center></th></tr>`;
          html += `\n<tr><th colspan=7><center><h2>Total gifts sent: ${totalGiftsSent} pp</h2></center></th></tr>`;
          html += `\n<tr><th colspan=7><center><h2>Total yearly gifts: ${totalYearlyReward} pp</h2></center></th></tr>`;
          html += `\n<tr><th colspan=7><center><h2>Total world reward: ${totalWorldReward} pp</h2></center></th></tr>`;
          html += `\n<tr><th colspan=7><center><h2>Total refunds: ${totalRefunds} pp</h2></center></th></tr>`;

          // Buttons and tables (overview + purchaseHistory); simplified insertion
          html += `\n<tr>\n<td><input type="button" class="btn" id="overviewButton" value="Overview"/></td>\n<td><input type="button" class="btn" id="purchaseHistoryButton" value="Purchase History"/></td>\n<td><input type="button" class="btn" id="giftReceivedButton" value="Gifts received"/></td>\n<td><input type="button" class="btn" id="giftSentButton" value="Gifts sent"/></td>\n<td><input type="button" class="btn" id="yearlyRewardButton" value="Yearly rewards"/></td>\n<td><input type="button" class="btn" id="worldRewardButton" value="Win rewards"/></td>\n<td><input type="button" class="btn" id="refundButton" value="Refunds"/></td>\n</tr>`;

          // Purchase history table
          html += `\n<table id="purchaseHistory" class="vis" width="100%">\n<tr><th>Date</th><th>World</th><th>Transaction</th><th>Amount</th><th>New total</th><th>More information</th></tr>`;
          for (let i = 0; i < purchases.length; i++) {
            html += `<tr><td>${purchases[i].Date}</td><td>${purchases[i].World}</td><td>${purchases[i].Transaction}</td><td>${purchases[i].Amount}</td><td>${purchases[i].newTotal}</td><td>${purchases[i].moreInformation}</td></tr>`;
          }
          html += `</table>`;

          // Overview table
          html += `\n<table id="overview" class="vis" width="100%">\n<tr><th colspan=2>World</th><th>Purchases</th><th>Spending</th><th>Farmed</th><th>Difference</th></tr>`;
          const keys = Object.keys(worldDataBase);
          for (let k = 0; k < keys.length; k++) {
            const key = keys[k];
            const item = worldDataBase[key];
            const diff = (item.Farming || 0) - (item.Spending || 0) + (item.Purchases || 0);
            html += `<tr><td colspan=2>${key}</td><td>${item.Purchases || 0}</td><td>${item.Spending || 0}</td><td>${item.Farming || 0}</td><td>${diff}</td></tr>`;
          }
          html += `</table>`;

          $('#progressbar').remove();
          if (window.Dialog && typeof Dialog.show === 'function') {
            Dialog.show('Log:', `<div width="100%"><table class="vis" width="100%">${html}</table></div>`);
          } else {
            // fallback: open new window with HTML
            const win = window.open('', '_blank');
            win.document.write(`<html><head><title>PP Log</title></head><body><table class="vis" width="100%">${html}</table></body></html>`);
            win.document.close();
          }

        },
        (error) => { console.error(error); }
      );
    })();

})();
