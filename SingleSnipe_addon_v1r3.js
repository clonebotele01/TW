// Mixed-unit add-on for RedAlert's Single Village Snipe.
// Run after https://twscripts.dev/scripts/singleVillageSnipe.js
(function () {
    "use strict";

    var ADDON_PREFIX = "svsMixedTimerGod";
    var SETTINGS_KEY = ADDON_PREFIX + "_unit_amounts";
    var TIMERGOD_SCRIPT_URL = "";

    function waitForSnipeUi() {
        if (window.__svsMixedAddonLoaded) return;

        if (
            typeof jQuery === "undefined" ||
            typeof unitInfo === "undefined" ||
            typeof villages === "undefined" ||
            typeof troopCounts === "undefined" ||
            !jQuery("#raSingleVillageSnipe").length
        ) {
            setTimeout(waitForSnipeUi, 250);
            return;
        }

        window.__svsMixedAddonLoaded = true;
        addMixedAmountUi();
        replaceCalculateHandler();
        UI.SuccessMessage("Mixed-unit snipe add-on loaded.");
    }

    function getStoredAmounts() {
        try {
            return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
        } catch (_error) {
            return {};
        }
    }

    function saveAmounts(amounts) {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(amounts));
    }

    function getPlayableUnits() {
        return game_data.units.filter(function (unit) {
            return unit !== "spy" && unit !== "militia";
        });
    }

    function addMixedAmountUi() {
        if (jQuery("#svsMixedUnitAmounts").length) return;

        var storedAmounts = getStoredAmounts();
        var rows = getPlayableUnits()
            .map(function (unit) {
                return `
                    <label style="display:flex;align-items:center;gap:4px">
                        <img src="/graphic/unit/unit_${unit}.webp" style="width:18px;height:18px" title="${unit}">
                        <input
                            class="svs-mixed-unit-amount"
                            data-unit="${unit}"
                            type="number"
                            min="0"
                            step="1"
                            value="${storedAmounts[unit] || 0}"
                            style="width:72px"
                        >
                    </label>
                `;
            })
            .join("");

        jQuery(".ra-unit-selector")
            .first()
            .closest(".ra-mb15")
            .after(`
                <div class="ra-mb15" id="svsMixedUnitAmounts">
                    <label>Mixed-unit exact amounts</label>
                    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">
                        ${rows}
                    </div>
                    <small>Checked units with amount above 0 will be sent together in one command. Launch time uses the slowest selected unit.</small>
                </div>
            `);
    }

    function getSelectedMixedAmounts() {
        var amounts = {};
        var selectedUnits = [];

        jQuery(".ra-unit-selector:checked").each(function () {
            selectedUnits.push(this.value);
        });

        jQuery(".svs-mixed-unit-amount").each(function () {
            var unit = jQuery(this).data("unit");
            var amount = parseInt(jQuery(this).val(), 10) || 0;

            if (selectedUnits.includes(unit) && amount > 0) {
                amounts[unit] = amount;
            }
        });

        var allAmounts = {};
        jQuery(".svs-mixed-unit-amount").each(function () {
            allAmounts[jQuery(this).data("unit")] = parseInt(jQuery(this).val(), 10) || 0;
        });
        saveAmounts(allAmounts);

        return amounts;
    }

    function getSlowestUnit(unitAmounts) {
        return Object.keys(unitAmounts).reduce(function (slowest, unit) {
            if (!slowest) return unit;
            return Number(unitInfo.config[unit].speed) > Number(unitInfo.config[slowest].speed)
                ? unit
                : slowest;
        }, null);
    }

    function villageHasTroops(villageTroops, unitAmounts) {
        return Object.keys(unitAmounts).every(function (unit) {
            return (parseInt(villageTroops[unit], 10) || 0) >= unitAmounts[unit];
        });
    }

    function buildMixedCommandUrl(villageId, destinationVillage, unitAmounts, arrivalTimeMs) {
        var toCoords = destinationVillage.split("|");
        var params = [`village=${villageId}`, "screen=place", "try=confirm"];
        var targetVillageId =
            typeof VillageInfo !== "undefined" && VillageInfo.village_id
                ? VillageInfo.village_id
                : new URLSearchParams(window.location.search).get("id");

        if (game_data.player.sitter > 0) {
            params.unshift(`t=${game_data.player.id}`);
        }

        if (game_data.market !== "uk") {
            params.push(`x=${toCoords[0]}`);
            params.push(`y=${toCoords[1]}`);
            if (targetVillageId) {
                params.push(`target=${targetVillageId}`);
            }
            Object.keys(unitAmounts).forEach(function (unit) {
                params.push(`${unit}=${unitAmounts[unit]}`);
            });
        }

        params.push(`tgArrivalMs=${arrivalTimeMs}`);
        params.push("tgAutoArm=1");
        if (TIMERGOD_SCRIPT_URL) {
            params.push(`tgScript=${encodeURIComponent(TIMERGOD_SCRIPT_URL)}`);
        }

        return `/game.php?${params.join("&")}`;
    }

    window.svsMixedOpenWithTimerGod = function (commandUrl) {
        var commandWindow = window.open(commandUrl, "_blank", "noopener=false");

        if (!commandWindow || !TIMERGOD_SCRIPT_URL) {
            return true;
        }

        var attempts = 0;
        var injectHandle = setInterval(function () {
            attempts++;

            try {
                if (
                    commandWindow.closed ||
                    attempts > 100
                ) {
                    clearInterval(injectHandle);
                    return;
                }

                if (
                    commandWindow.document &&
                    commandWindow.document.readyState !== "loading" &&
                    commandWindow.location.href.indexOf("try=confirm") >= 0
                ) {
                    clearInterval(injectHandle);
                    var script = commandWindow.document.createElement("script");
                    script.src = TIMERGOD_SCRIPT_URL + (TIMERGOD_SCRIPT_URL.indexOf("?") >= 0 ? "&" : "?") + "v=" + Date.now();
                    commandWindow.document.body.appendChild(script);
                }
            } catch (_error) {
                clearInterval(injectHandle);
            }
        }, 200);

        return false;
    };

    function formatMixedUnits(unitAmounts) {
        return Object.keys(unitAmounts)
            .map(function (unit) {
                return `<span style="white-space:nowrap"><img src="/graphic/unit/unit_${unit}.webp" style="width:18px;height:18px"> ${formatAsNumber(unitAmounts[unit])}</span>`;
            })
            .join(" ");
    }

    function renderMixedCombinations(snipes, destinationVillage, unitAmounts) {
        var serverTime = getServerTime().getTime();
        var rows = snipes
            .map(function (snipe, index) {
                var continent = getContinentByCoord(snipe.coords);
                var timeTillLaunch = secondsToHms((snipe.launchTime - serverTime) / 1000);
                var commandUrl = buildMixedCommandUrl(snipe.id, destinationVillage, unitAmounts, snipe.arrivalTime);

                var sendAction = TIMERGOD_SCRIPT_URL
                    ? `onclick="return svsMixedOpenWithTimerGod(${JSON.stringify(commandUrl)})"`
                    : "";

                return `
                    <tr>
                        <td>${index + 1}</td>
                        <td class="ra-text-left">
                            <a href="${game_data.link_base_pure}info_village&id=${snipe.id}" target="_blank" rel="noopener noreferrer">
                                ${snipe.name} (${snipe.coords}) K${continent}
                            </a>
                        </td>
                        <td>${formatMixedUnits(unitAmounts)}</td>
                        <td class="ra-hide-on-mobile">${parseFloat(snipe.distance).toFixed(2)}</td>
                        <td>${snipe.formattedLaunchTime}</td>
                        <td><span class="timer" data-endtime>${timeTillLaunch}</span></td>
                        <td>
                            <a href="${commandUrl}" target="_blank" rel="noopener noreferrer" class="btn" ${sendAction}>
                                Send
                            </a>
                        </td>
                    </tr>
                `;
            })
            .join("");

        jQuery("#possibleCombinationsTable").html(`
            <table class="vis" style="width:100%">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>From</th>
                        <th>Command</th>
                        <th class="ra-hide-on-mobile">Distance</th>
                        <th>Launch Time</th>
                        <th>Send in</th>
                        <th>Send</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `);

        jQuery("#possibleCombinationsCount").text(snipes.length);
        jQuery("#raPossibleCombinations").show();
        jQuery("#exportBBCodeBtn").attr("data-snipe", JSON.stringify(snipes));
    }

    function replaceCalculateHandler() {
        jQuery("#calculateLaunchTimes").off("click.svsMixedAddon").off("click");
        jQuery("#calculateLaunchTimes").on("click.svsMixedAddon", function (event) {
            event.preventDefault();

            var landingTimeString = jQuery("#raLandingTime").val().trim();
            var destinationVillage = jQuery("#raDestinationVillage").val().trim();
            var unitAmounts = getSelectedMixedAmounts();
            var selectedUnits = Object.keys(unitAmounts);

            if (!destinationVillage.match(/^\d+\|\d+$/)) {
                UI.ErrorMessage("Destination village must be coordinates like 500|500.");
                return;
            }

            if (!selectedUnits.length) {
                UI.ErrorMessage("Choose at least one unit and set its mixed amount above 0.");
                return;
            }

            if (typeof handleSaveConfig === "function") {
                handleSaveConfig();
            }

            localStorage.setItem(`${LS_PREFIX}_chosen_units`, JSON.stringify(selectedUnits));

            var landingTime = getLandingTime(landingTimeString);
            var landingTimeMs = landingTime.getTime();
            var serverTime = getServerTime();
            var slowestUnit = getSlowestUnit(unitAmounts);
            var mixedSnipes = [];

            villages.forEach(function (village) {
                var matchingTroops = troopCounts.find(function (villageTroops) {
                    return Number(villageTroops.villageId) === Number(village.id);
                });

                if (!matchingTroops || !villageHasTroops(matchingTroops, unitAmounts)) return;

                var distance = calculateDistance(village.coords, destinationVillage);
                var launchTime = getLaunchTime(slowestUnit, landingTime, distance);

                if (distance > 0 && launchTime > serverTime.getTime()) {
                    mixedSnipes.push({
                        id: village.id,
                        name: village.name,
                        unit: slowestUnit,
                        unitAmounts: unitAmounts,
                        coords: village.coords,
                        distance: distance,
                        arrivalTime: landingTimeMs,
                        launchTime: launchTime,
                        formattedLaunchTime: formatDateTime(launchTime)
                    });
                }
            });

            mixedSnipes.sort(function (a, b) {
                return a.launchTime - b.launchTime;
            });

            if (mixedSnipes.length === 0) {
                jQuery("#possibleCombinationsTable").html("");
                jQuery("#possibleCombinationsCount").text("0");
                jQuery("#raPossibleCombinations").show();
                UI.ErrorMessage("No villages have the exact mixed troop amounts available.");
                return;
            }

            renderMixedCombinations(mixedSnipes, destinationVillage, unitAmounts);
            UI.SuccessMessage(`${mixedSnipes.length} mixed-unit snipe options found.`);
        });
    }

    waitForSnipeUi();
})();
