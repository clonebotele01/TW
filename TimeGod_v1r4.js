// TimerGod_v1r1
// Drop-in replacement for the confirm-page troop timer.
// Key change: it uses a single-shot timeout for the bulk of the wait and
// requestAnimationFrame in the final 150ms to reduce visible delay.
(function () {
    "use strict";

    const SCRIPT_ID = "timergod-v1r1";
    const TIMER_KEY = "TimerGod_v1r1_settings";
    let frameHandle = null;
    let timeoutHandle = null;
    let targetSendAt = null;
    let hasSent = false;
    let serverClock = {
        displayText: "",
        serverMs: 0,
        perfMs: 0,
        synced: false
    };

    function isConfirmPage() {
        return window.location.href.indexOf("screen=place") >= 0 && window.location.href.indexOf("try=confirm") >= 0;
    }

    function pad(value, size) {
        let text = String(value);
        while (text.length < size) text = "0" + text;
        return text;
    }

    function parseDisplayedServerNow() {
        const dateNode = document.getElementById("serverDate");
        const timeNode = document.getElementById("serverTime");
        if (!dateNode || !timeNode) throw new Error("Could not find Tribal Wars server time.");

        const dateText = dateNode.textContent.trim();
        const timeText = timeNode.textContent.trim();
        const dateMatch = dateText.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
        if (!dateMatch) throw new Error("Could not parse server date: " + dateText);

        const [_, day, month, year] = dateMatch;
        const [hours, minutes, seconds] = timeText.split(":").map(Number);
        return {
            text: dateText + " " + timeText,
            date: new Date(Number(year), Number(month) - 1, Number(day), hours, minutes, seconds || 0, 0)
        };
    }

    function syncServerClock(force) {
        const parsed = parseDisplayedServerNow();
        if (force || parsed.text !== serverClock.displayText) {
            serverClock.displayText = parsed.text;
            serverClock.serverMs = parsed.date.getTime();
            serverClock.perfMs = performance.now();
            serverClock.synced = !force;
        }
    }

    function startServerClockSync() {
        syncServerClock(true);
        window.setInterval(() => {
            try {
                syncServerClock(false);
            } catch (error) {
                console.error(error);
            }
        }, 1000);
    }

    function getServerNow() {
        if (!serverClock.serverMs) syncServerClock(true);
        return new Date(serverClock.serverMs + (performance.now() - serverClock.perfMs));
    }

    function parseDurationToMs(value) {
        const match = String(value).trim().match(/(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?/);
        if (!match) return null;

        const hours = Number(match[1] || 0);
        const minutes = Number(match[2] || 0);
        const seconds = Number(match[3] || 0);
        const ms = Number(pad(match[4] || "0", 3).slice(0, 3));
        return (((hours * 60 + minutes) * 60 + seconds) * 1000) + ms;
    }

    function findDurationMs() {
        const rows = Array.from(document.querySelectorAll("tr"));
        for (const row of rows) {
            const rowText = row.textContent.replace(/\s+/g, " ").trim();
            if (/duration/i.test(rowText)) {
                const duration = parseDurationToMs(rowText);
                if (duration !== null) return duration;
            }
        }

        const fullTextDuration = parseDurationToMs(document.body.textContent);
        if (fullTextDuration !== null) return fullTextDuration;
        return null;
    }

    function findSendButton() {
        return document.getElementById("troop_confirm_go") ||
            document.querySelector("input[type='submit'][value*='Send attack']") ||
            document.querySelector("button[type='submit']") ||
            document.querySelector("input[type='submit']");
    }

    function formatDateInput(date) {
        return date.getFullYear() + "-" + pad(date.getMonth() + 1, 2) + "-" + pad(date.getDate(), 2);
    }

    function formatTimeInput(date) {
        return pad(date.getHours(), 2) + ":" + pad(date.getMinutes(), 2) + ":" + pad(date.getSeconds(), 2);
    }

    function formatMs(ms) {
        const sign = ms < 0 ? "-" : "";
        ms = Math.abs(ms);
        const hours = Math.floor(ms / 3600000);
        const minutes = Math.floor((ms % 3600000) / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        const milli = ms % 1000;
        return sign + pad(hours, 2) + ":" + pad(minutes, 2) + ":" + pad(seconds, 2) + "." + pad(milli, 3);
    }

    function loadSettings() {
        try { return JSON.parse(localStorage.getItem(TIMER_KEY)) || {}; } catch (_) { return {}; }
    }

    function saveSettings(settings) {
        localStorage.setItem(TIMER_KEY, JSON.stringify(settings));
    }

    function showMessage(message, isError) {
        const node = document.getElementById(SCRIPT_ID + "-message");
        if (!node) return;
        node.textContent = message;
        node.style.color = isError ? "#ffb4a8" : "#d7ffd0";
    }

    function buildUi() {
        const old = document.getElementById(SCRIPT_ID);
        if (old) old.remove();

        const now = getServerNow();
        const durationMs = findDurationMs();
        const settings = loadSettings();
        const defaultArrival = new Date(now.getTime() + (durationMs || 0) + 60000);

        const panel = document.createElement("div");
        panel.id = SCRIPT_ID;
        panel.style.cssText = [
            "position:fixed", "top:120px", "right:24px", "z-index:99999",
            "width:310px", "background:#2f312d", "color:#f6f0df",
            "border:1px solid #8b7448", "box-shadow:0 8px 24px rgba(0,0,0,.35)",
            "font:12px Arial,sans-serif", "padding:10px"
        ].join(";");

        panel.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                <strong style="font-size:14px;color:#ffd98c">TimerGod_v1r1</strong>
                <button id="${SCRIPT_ID}-close" type="button" style="cursor:pointer">X</button>
            </div>
            <div style="display:grid;grid-template-columns:95px 1fr;gap:6px;align-items:center">
                <label>Arrival date</label>
                <input id="${SCRIPT_ID}-date" type="date" value="${settings.date || formatDateInput(defaultArrival)}">
                <label>Arrival time</label>
                <input id="${SCRIPT_ID}-time" type="text" value="${settings.time || formatTimeInput(defaultArrival) + ".000"}" placeholder="HH:MM:SS.mmm">
                <label>Send offset</label>
                <input id="${SCRIPT_ID}-offset" type="number" value="${settings.offset || 0}" step="10">
            </div>
            <div style="margin-top:8px;line-height:1.45">
                <div>Duration: <strong id="${SCRIPT_ID}-duration">${durationMs === null ? "not found" : formatMs(durationMs)}</strong></div>
                <div>Send at: <strong id="${SCRIPT_ID}-sendat">not armed</strong></div>
                <div>Countdown: <strong id="${SCRIPT_ID}-countdown">not armed</strong></div>
            </div>
            <div style="display:flex;gap:6px;margin-top:10px">
                <button id="${SCRIPT_ID}-arm" type="button" class="btn" style="flex:1">Arm timer</button>
                <button id="${SCRIPT_ID}-cancel" type="button" class="btn" style="flex:1">Cancel</button>
            </div>
            <div id="${SCRIPT_ID}-message" style="margin-top:8px;min-height:16px"></div>
        `;

        document.body.appendChild(panel);

        document.getElementById(SCRIPT_ID + "-close").addEventListener("click", () => {
            clearTimers();
            panel.remove();
        });

        document.getElementById(SCRIPT_ID + "-cancel").addEventListener("click", () => {
            clearTimers();
            targetSendAt = null;
            hasSent = false;
            document.getElementById(SCRIPT_ID + "-sendat").textContent = "not armed";
            document.getElementById(SCRIPT_ID + "-countdown").textContent = "not armed";
            showMessage("Timer cancelled.", false);
        });

        document.getElementById(SCRIPT_ID + "-arm").addEventListener("click", () => {
            armTimer(durationMs);
        });
    }

    function parseArrivalInput() {
        const dateValue = document.getElementById(SCRIPT_ID + "-date").value;
        const timeValue = document.getElementById(SCRIPT_ID + "-time").value.trim();
        const match = timeValue.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
        if (!dateValue || !match) throw new Error("Use arrival time format HH:MM:SS.mmm");

        const dateParts = dateValue.split("-").map(Number);
        return new Date(
            dateParts[0],
            dateParts[1] - 1,
            dateParts[2],
            Number(match[1]),
            Number(match[2]),
            Number(match[3]),
            Number(pad(match[4] || "0", 3).slice(0, 3))
        );
    }

    function clearTimers() {
        if (frameHandle) {
            cancelAnimationFrame(frameHandle);
            frameHandle = null;
        }
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
        }
    }

    function armTimer(durationMs) {
        try {
            if (durationMs === null) throw new Error("Could not find command duration on this confirm page.");

            const arrivalAt = parseArrivalInput();
            const offsetMs = Number(document.getElementById(SCRIPT_ID + "-offset").value || 0);
            targetSendAt = new Date(arrivalAt.getTime() - durationMs - offsetMs);
            hasSent = false;

            saveSettings({
                date: document.getElementById(SCRIPT_ID + "-date").value,
                time: document.getElementById(SCRIPT_ID + "-time").value.trim(),
                offset: offsetMs
            });

            document.getElementById(SCRIPT_ID + "-sendat").textContent = formatTimeInput(targetSendAt) + "." + pad(targetSendAt.getMilliseconds(), 3);
            showMessage(serverClock.synced ? "Timer armed. Keep this tab active on the confirm page." : "Timer armed. Syncing server clock; keep this tab active.", false);

            clearTimers();
            scheduleSend();
        } catch (error) {
            showMessage(error.message, true);
        }
    }

    function sendNow() {
        if (hasSent) return;
        hasSent = true;
        clearTimers();

        const button = findSendButton();
        if (!button) {
            showMessage("Send attack button not found.", true);
            return;
        }

        showMessage("Sending now.", false);
        button.click();
    }

    function scheduleSend() {
        if (!targetSendAt) return;

        const tick = () => {
            const now = getServerNow().getTime();
            const remaining = targetSendAt.getTime() - now;
            document.getElementById(SCRIPT_ID + "-countdown").textContent = formatMs(remaining);

            if (remaining <= 0) {
                sendNow();
                return;
            }

            if (remaining <= 150) {
                frameHandle = requestAnimationFrame(tick);
                return;
            }

            const waitFor = Math.min(100, Math.max(20, remaining - 100));
            timeoutHandle = setTimeout(() => {
                timeoutHandle = null;
                tick();
            }, waitFor);
        };

        tick();
    }

    if (!isConfirmPage()) {
        alert("TimerGod_v1r1 only works on game.php?village=...&screen=place&try=confirm");
        return;
    }

    startServerClockSync();
    buildUi();
})();
