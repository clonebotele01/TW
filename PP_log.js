// log_refined.js
// Snippets to fix reload and progress count issues in shinko-to-kuma's log.js
// Apply the shown replacements at the top of your original script.

/*
Replace the original top redirect check:
if (window.location.href.indexOf('premium&mode=log&page=') < 0) {
  window.location.assign(game_data.link_base_pure + "premium&mode=log&page=0");
}

With the snippet below (more robust URL/param detection and safe fallback):
*/
(function ensurePremiumLogPage(){
  try {
    const params = new URLSearchParams(window.location.search);
    const isScreenPremium = params.get('screen') === 'premium' || /screen=premium/.test(window.location.href);
    const isModeLog = params.get('mode') === 'log' || /mode=log/.test(window.location.href);
    const hasPage = params.has('page') || /[?&]page=\d+/.test(window.location.href);

    if (!isScreenPremium || !isModeLog || !hasPage) {
      // Prefer the game's base link if available, else build a safe fallback URL
      if (window.game_data && game_data.link_base_pure) {
        window.location.assign(game_data.link_base_pure + 'premium&mode=log&page=0');
      } else {
        const url = new URL(window.location.href);
        url.searchParams.set('screen', 'premium');
        url.searchParams.set('mode', 'log');
        url.searchParams.set('page', '0');
        window.location.assign(url.pathname + '?' + url.searchParams.toString());
      }
      return; // stop executing the rest of the script while navigation happens
    }
  } catch (e) {
    console.error('ensurePremiumLogPage error', e);
  }
})();

/*
Fix progress bar / page-count display issues.
The original script computes `amountOfPages` as a number (last page index) but later uses
`amountOfPages.length` in templates (causing "undefined"). Use this helper and replace
progress template occurrences accordingly.
*/
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

// Use this right after computing `amountOfPages` in the original script, and
// when creating the progress bar use `totalPages` instead of `amountOfPages.length`:
// const amountOfPages = safeAmountOfPages();
// const totalPages = (typeof amountOfPages === 'number') ? (amountOfPages + 1) : 0;

/* Example replacement for the progressbar HTML creation (use totalPages):

const amountOfPages = safeAmountOfPages();
const totalPages = amountOfPages + 1; // pages are 0..amountOfPages
const width = (document.getElementById('contentContainer') || document.getElementById('mobileHeader')).clientWidth;
const progressHtml = `\n<div id="progressbar" class="progress-bar progress-bar-alive">\n  <span id="count" class="label">0/${totalPages}</span>\n  <div id="progress"><span id="count2" class="label" style="width: ${width}px;">0/${totalPages}</span></div>\n</div>`;

// then append the progressHtml to the container instead of the old template
*/

/*
Other notes found in the review (recommendations):
- The script relies on fixed row indexes (tempRows[2], children indices). If the page template varies,
  add defensive checks (ensure nodes exist before indexing) to avoid throwing and stopping the loader.
- Consider using parseInt(...,10) consistently when converting strings to numbers.
- When storing/loading from localStorage, guard JSON.parse with try/catch (already present in parts, but ensure everywhere).
- Add a small retry/backoff if amountOfPages === 0 (sometimes the page hasn't rendered the pager yet).
*/

// End of snippets file
