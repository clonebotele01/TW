javascript:
// Add-on for Sophie / Shinko to Kuma massScavenge.js
// Run after the original script. It scans all mass scavenge pages and checks
// only the most common troop type from your preset list.
(function () {
    var mostCommonTroopPreset = ["spear", "sword", "axe"];

    function getMassScavengeUrl() {
        if (game_data.player.sitter > 0) {
            return `game.php?t=${game_data.player.id}&screen=place&mode=scavenge_mass`;
        }
        return "game.php?&screen=place&mode=scavenge_mass";
    }

    function getScavengePageData(data) {
        var script = $(data).find('script:contains("ScavengeMassScreen")').html();
        if (!script) return null;

        var matches = script.match(/\{.*\:\{.*\:.*\}\}/g);
        if (!matches || !matches[2]) return null;

        return JSON.parse(matches[2]);
    }

    function selectedPresetUnits() {
        return mostCommonTroopPreset.filter(function (unit) {
            return $(`#${unit}`).length > 0;
        });
    }

    function applyMostCommonTroop(unit) {
        $("#imgRow :checkbox").prop("checked", false);
        $(`#${unit}`).prop("checked", true);

        if (typeof troopTypeEnabled !== "undefined") {
            Object.keys(troopTypeEnabled).forEach(function (key) {
                troopTypeEnabled[key] = key === unit;
            });
            localStorage.setItem("troopTypeEnabled", JSON.stringify(troopTypeEnabled));
        }

        UI.SuccessMessage(`Most common preset troop selected: ${unit}`);
    }

    function autoPickMostCommonTroop() {
        var preset = selectedPresetUnits();
        if (preset.length === 0) {
            UI.ErrorMessage("None of your preset units exist on this world.");
            return;
        }

        var url = getMassScavengeUrl();
        var troopTotals = {};
        preset.forEach(function (unit) {
            troopTotals[unit] = 0;
        });

        $.get(url, function (data) {
            var amountOfPages = 0;
            var navItems = $(data).find(".paged-nav-item");

            if (navItems.length > 0) {
                amountOfPages = parseInt(navItems[navItems.length - 1].href.match(/page=(\d+)/)[1]);
            }

            var urls = [];
            for (var i = 0; i <= amountOfPages; i++) {
                urls.push(url + "&page=" + i);
            }

            $.getAll(
                urls,
                function (_index, pageHtml) {
                    var villages = getScavengePageData(pageHtml);
                    if (!villages) return;

                    villages.forEach(function (village) {
                        if (!village.has_rally_point || !village.unit_counts_home) return;

                        preset.forEach(function (unit) {
                            var keep = 0;
                            if (typeof keepHome !== "undefined" && keepHome[unit]) {
                                keep = parseInt(keepHome[unit], 10) || 0;
                            }
                            troopTotals[unit] += Math.max(0, (village.unit_counts_home[unit] || 0) - keep);
                        });
                    });
                },
                function () {
                    var winner = preset.reduce(function (best, unit) {
                        return troopTotals[unit] > troopTotals[best] ? unit : best;
                    }, preset[0]);

                    console.table(troopTotals);

                    if (troopTotals[winner] <= 0) {
                        UI.ErrorMessage("No available troops found from preset: " + preset.join(", "));
                        return;
                    }

                    applyMostCommonTroop(winner);
                },
                function (error) {
                    console.error(error);
                    UI.ErrorMessage("Could not scan mass scavenge pages.");
                }
            );
        });
    }

    window.autoPickMostCommonTroop = autoPickMostCommonTroop;

    if ($("#autoMostCommonTroop").length === 0) {
        $("#sendMass")
            .first()
            .before(
                `<center style="margin-bottom:6px">
                    <input type="button"
                        class="btn btnSophie"
                        id="autoMostCommonTroop"
                        onclick="autoPickMostCommonTroop()"
                        value="Auto-pick most common troop">
                </center>`
            );
    }
})();
