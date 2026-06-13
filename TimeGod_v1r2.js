// TimerGod_v1r0
// Tribal Wars confirm-page send timer.
// Works on: game.php?village=...&screen=place&try=confirm
(function () {
    "use strict";

    var SCRIPT_ID = "timergod-v1r0";
    var TIMER_KEY = "TimerGod_v1r0_settings";
    var tickHandle = null;
    var syncHandle = null;
    var targetSendAt = null;
    var hasSent = false;
    var serverClock = {
        displayText: "",
        serverMs: 0,
        perfMs: 0,
        synced: false
    };

    function isConfirmPage() {
        return window.location.href.indexOf("screen=place") >= 0 &&
            window.location.href.indexOf("try=confirm") >= 0;
    }

    function pad(value, size) {
        var text = String(value);
        while (text.length < size) text = "0" + text;
        return text;
    }

    function parseDisplayedServerNow() {
        var dateNode = document.getElementById("serverDate");
        var timeNode = document.getElementById("serverTime");

        if (!dateNode || !timeNode) {
            throw new Error("Could not find Tribal Wars server time.");
        }

        var dateText = dateNode.textContent.trim();
        var timeText = timeNode.textContent.trim();
        var dateMatch = dateText.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);

        if (!dateMatch) {
            throw new Error("Could not parse server date: " + dateText);
        }

        return {
            text: dateText + " " + timeText,
            date: new Date(
            Number(dateMatch[3]),
            Number(dateMatch[2]) - 1,
            Number(dateMatch[1]),
            Number(timeText.split(":")[0]),
            Number(timeText.split(":")[1]),
            Number(timeText.split(":")[2] || 0),
            0
            )
        };
    }

    function syncServerClock(force) {
        var parsed = parseDisplayedServerNow();

        if (force || parsed.text !== serverClock.displayText) {
            serverClock.displayText = parsed.text;
            serverClock.serverMs = parsed.date.getTime();
            serverClock.perfMs = performance.now();
            serverClock.synced = !force;
        }
    }

    function startServerClockSync() {
        if (syncHandle) clearInterval(syncHandle);
        syncServerClock(true);
        syncHandle = setInterval(function () {
            try {
                syncServerClock(false);
            } catch (_error) {
                clearInterval(syncHandle);
                syncHandle = null;
            }
        }, 20);
    }

    function getServerNow() {
        if (!serverClock.serverMs) {
            syncServerClock(true);
        }

        return new Date(serverClock.serverMs + (performance.now() - serverClock.perfMs));
    }

    function parseDurationToMs(value) {
        var match = String(value).trim().match(/(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?/);
        if (!match) return null;

        var hours = Number(match[1] || 0);
        var minutes = Number(match[2] || 0);
        var seconds = Number(match[3] || 0);
        var ms = Number(pad(match[4] || "0", 3).slice(0, 3));

        return (((hours * 60 + minutes) * 60 + seconds) * 1000) + ms;
    }

    function findDurationMs() {
        var rows = Array.from(document.querySelectorAll("tr"));

        for (var i = 0; i < rows.length; i++) {
            var rowText = rows[i].textContent.replace(/\s+/g, " ").trim();
            if (/duration/i.test(rowText)) {
                var duration = parseDurationToMs(rowText);
                if (duration !== null) return duration;
            }
        }

        var fullTextDuration = parseDurationToMs(document.body.textContent);
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
        var sign = ms < 0 ? "-" : "";
        ms = Math.abs(ms);

        var hours = Math.floor(ms / 3600000);
        var minutes = Math.floor((ms % 3600000) / 60000);
        var seconds = Math.floor((ms % 60000) / 1000);
        var milli = ms % 1000;

        return sign + pad(hours, 2) + ":" + pad(minutes, 2) + ":" + pad(seconds, 2) + "." + pad(milli, 3);
    }

    function loadSettings() {
        try {
            return JSON.parse(localStorage.getItem(TIMER_KEY)) || {};
        } catch (_error) {
            return {};
        }
    }

    function getTimerGodParams() {
        var params = new URLSearchParams(window.location.search);
        var arrivalMs = Number(params.get("tgArrivalMs") || 0);

        return {
            arrivalAt: arrivalMs > 0 ? new Date(arrivalMs) : null,
            autoArm: params.get("tgAutoArm") === "1"
        };
    }

    function saveSettings(settings) {
        localStorage.setItem(TIMER_KEY, JSON.stringify(settings));
    }

    function showMessage(message, isError) {
        var node = document.getElementById(SCRIPT_ID + "-message");
        if (!node) return;

        node.textContent = message;
        node.style.color = isError ? "#ffb4a8" : "#d7ffd0";
    }

    function buildUi() {
        var old = document.getElementById(SCRIPT_ID);
        if (old) old.remove();

        var now = getServerNow();
        var durationMs = findDurationMs();
        var settings = loadSettings();
        var timerParams = getTimerGodParams();
        var defaultArrival = timerParams.arrivalAt || new Date(now.getTime() + (durationMs || 0) + 60000);

        var panel = document.createElement("div");
        panel.id = SCRIPT_ID;
        panel.style.cssText = [
            "position:fixed",
            "top:120px",
            "right:24px",
            "z-index:99999",
            "width:310px",
            "background:#2f312d",
            "color:#f6f0df",
            "border:1px solid #8b7448",
            "box-shadow:0 8px 24px rgba(0,0,0,.35)",
            "font:12px Arial,sans-serif",
            "padding:10px"
        ].join(";");

        panel.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                <strong style="font-size:14px;color:#ffd98c">TimerGod_v1r0</strong>
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

        document.getElementById(SCRIPT_ID + "-close").addEventListener("click", function () {
            if (tickHandle) clearInterval(tickHandle);
            if (syncHandle) clearInterval(syncHandle);
            panel.remove();
        });

        document.getElementById(SCRIPT_ID + "-cancel").addEventListener("click", function () {
            if (tickHandle) clearInterval(tickHandle);
            tickHandle = null;
            targetSendAt = null;
            hasSent = false;
            document.getElementById(SCRIPT_ID + "-sendat").textContent = "not armed";
            document.getElementById(SCRIPT_ID + "-countdown").textContent = "not armed";
            showMessage("Timer cancelled.", false);
        });

        document.getElementById(SCRIPT_ID + "-arm").addEventListener("click", function () {
            armTimer(durationMs);
        });

        if (timerParams.autoArm && timerParams.arrivalAt) {
            setTimeout(function () {
                armTimer(durationMs);
            }, 150);
        }
    }

    function parseArrivalInput() {
        var dateValue = document.getElementById(SCRIPT_ID + "-date").value;
        var timeValue = document.getElementById(SCRIPT_ID + "-time").value.trim();
        var match = timeValue.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);

        if (!dateValue || !match) {
            throw new Error("Use arrival time format HH:MM:SS.mmm");
        }

        var dateParts = dateValue.split("-").map(Number);

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

    function armTimer(durationMs) {
        try {
            if (durationMs === null) {
                throw new Error("Could not find command duration on this confirm page.");
            }

            var arrivalAt = parseArrivalInput();
            var offsetMs = Number(document.getElementById(SCRIPT_ID + "-offset").value || 0);
            targetSendAt = new Date(arrivalAt.getTime() - durationMs - offsetMs);
            hasSent = false;

            saveSettings({
                date: document.getElementById(SCRIPT_ID + "-date").value,
                time: document.getElementById(SCRIPT_ID + "-time").value.trim(),
                offset: offsetMs
            });

            document.getElementById(SCRIPT_ID + "-sendat").textContent = formatTimeInput(targetSendAt) + "." + pad(targetSendAt.getMilliseconds(), 3);
            showMessage(serverClock.synced ?
                "Timer armed. Keep this tab active on the confirm page." :
                "Timer armed. Syncing server clock; keep this tab active.",
                false
            );

            if (tickHandle) clearInterval(tickHandle);
            tickHandle = setInterval(tick, 10);
            tick();
        } catch (error) {
            showMessage(error.message, true);
        }
    }

    function tick() {
        try {
            var now = getServerNow();
            var remaining = targetSendAt.getTime() - now.getTime();
            document.getElementById(SCRIPT_ID + "-countdown").textContent = formatMs(remaining);

            if (remaining <= 0 && !hasSent) {
                hasSent = true;
                clearInterval(tickHandle);
                tickHandle = null;

                var button = findSendButton();
                if (!button) {
                    showMessage("Send attack button not found.", true);
                    return;
                }

                showMessage("Sending now.", false);
                button.click();
            }
        } catch (error) {
            clearInterval(tickHandle);
            tickHandle = null;
            showMessage(error.message, true);
        }
    }

    if (!isConfirmPage()) {
        alert("TimerGod_v1r0 only works on game.php?village=...&screen=place&try=confirm");
        return;
    }

    startServerClockSync();
    buildUi();
})();
