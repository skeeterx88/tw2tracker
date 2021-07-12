// TW2-Tracker
// Copyright (C) 2021 Relaxeaza
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

require([
    'TW2Map',
    'TW2DataLoader',
    'TW2Tooltip',
    'utils',
    'i18n',
    'backendValues'
], function (
    TW2Map,
    TW2DataLoader,
    TW2Tooltip,
    utils,
    i18n,
    {
        marketId,
        worldNumber,
        mapShare,
        lastDataSyncDate,
        staticMapExpireTime,
        mapShareTypes
    }
) {
    let colorPicker;
    let notif;
    const KEEP_COLORPICKER_OPEN = 'keep_colorpicker_open';
    const HIGHLIGHTS_STORE_KEY = 'tw2_tracker_map_highlights_' + marketId + worldNumber;
    const IGNORE_HIGHLIGHT_STORAGE = 'ignore_highlight_storage';

    const dataIndex = {
        players: {
            name: 0,
            tribe: 1,
            points: 2,
            villages: 3,
            avg_coords: 4,
            bash_off: 5,
            bash_def: 6,
            victory_points: 7,
            rank: 8
        },
        tribes: {
            name: 0,
            tag: 1,
            points: 2,
            villages: 3,
            avg_coords: 4,
            bash_off: 5,
            bash_def: 6,
            victory_points: 7,
            rank: 8
        }
    };

    const setupQuickJump = () => {
        const $quickJumpX = document.querySelector('.map-panel .coords-x');
        const $quickJumpY = document.querySelector('.map-panel .coords-y');
        const $quickJumpGo = document.querySelector('.map-panel .coords-go');

        const onInput = function (event) {
            if (event.inputType === 'insertFromPaste' || event.inputType === 'insertFromDrag') {
                const coords = event.target.value.match(/(\d{1,3})[^\d](\d{1,3})/);

                if (coords !== null) {
                    $quickJumpX.value = coords[1];
                    $quickJumpY.value = coords[2];
                    $quickJumpY.focus();
                    return;
                }
            }

            event.target.value = event.target.value.replace(/[^\d]/g, '');

            if (event.target.value.length > 3) {
                event.target.value = $quickJumpX.value.slice(0, 3);
            }
        };

        function onAction (event) {
            if (event.code === 'Escape') {
                $quickJumpX.value = '';
                $quickJumpY.value = '';
            } else if (event.code === 'Enter') {
                move();
            }
        }

        function move () {
            map.moveTo($quickJumpX.value || 500, $quickJumpY.value || 500);
        }

        $quickJumpX.addEventListener('input', onInput);
        $quickJumpY.addEventListener('input', onInput);
        $quickJumpX.addEventListener('keydown', onAction);
        $quickJumpY.addEventListener('keydown', onAction);
        $quickJumpGo.addEventListener('click', move);
    };

    const setupCustomHighlights = async () => {
        const $search = document.querySelector('.search');
        const $input = $search.querySelector('input');
        const $results = $search.querySelector('.results');
        const $noResults = $search.querySelector('.no-results');
        const $highlightItems = document.querySelector('.highlights-items');
        const maxResults = 5;
        let selectedIndex = 0;
        let results = [];

        const data = new Promise(async function (resolve) {
            await loader.loadInfo;

            const matches = [];

            for (const [name] of loader.players.values()) {
                matches.push({
                    search: name,
                    id: name,
                    display: name,
                    highlightType: TW2Map.highlightTypes.PLAYERS
                });
            }

            for (const [name, tag] of loader.tribes.values()) {
                matches.push({
                    search: tag + name,
                    id: tag,
                    display: tag + ' (' + name + ')',
                    highlightType: TW2Map.highlightTypes.TRIBES
                });
            }

            resolve(matches);
        });

        function onResults (newResults) {
            removeResultItems();
            results = newResults;

            for (const item of results) {
                const $item = document.createElement('p');
                const $icon = document.createElement('span');
                $icon.className = 'icon icon-' + item.highlightType;
                $icon.innerText = item.display;
                $item.appendChild($icon);
                $item.classList.add('result');
                $item.addEventListener('click', () => onSelect(item));
                $results.appendChild($item);
            }

            $noResults.classList.add('hidden');
            $results.classList.remove('hidden');

            selectedIndex = 0;
            selectResult(selectedIndex);
        }

        function onNoResults () {
            removeResultItems();
            results = [];
            $noResults.classList.remove('hidden');
            $results.classList.remove('hidden');
        }

        function onSelect (item) {
            resetSearch();
            const color = utils.arrayRandom(TW2Map.colorPalette.flat());
            map.addHighlight(item.highlightType, item.id, color);
        }

        function selectResult (index) {
            const $current = $results.querySelector('.selected');

            if ($current) {
                $current.classList.remove('selected');
            }

            const $item = $results.querySelectorAll('.result')[index];
            $item.classList.add('selected');
        }

        function onMove (dir) {
            if (results.length) {
                selectedIndex = Math.max(0, Math.min(maxResults - 1, selectedIndex + dir));
                selectResult(selectedIndex);
            }
        }

        function resetSearch () {
            $input.value = '';
            results = [];
            $noResults.classList.add('hidden');
            $results.classList.add('hidden');
            removeResultItems();
        }

        function removeResultItems () {
            for (const $oldResult of $results.querySelectorAll('.result')) {
                $oldResult.remove();
            }
        }

        $input.addEventListener('keydown', function (event) {
            if (event.code === 'ArrowDown' || event.code === 'ArrowUp') {
                event.preventDefault();
            }
        });

        $input.addEventListener('keyup', async function (event) {
            if (event.code === 'ArrowDown') {
                return onMove(1);
            } else if (event.code === 'ArrowUp') {
                return onMove(-1);
            } else if (event.code === 'Escape') {
                return resetSearch();
            } else if (event.code === 'Enter') {
                if (results.length) {
                    return onSelect(results[selectedIndex]);
                }
            }

            const value = $input.value;

            if (!value.length) {
                return resetSearch();
            }

            const newResults = (await data)
                .map(target => ({rating: compareTwoStrings(value, target.search), target}))
                .sort((a, b) => b.rating - a.rating)
                .slice(0, 10);

            if (newResults.every(result => !result.rating)) {
                onNoResults();
            } else {
                onResults(newResults.map(result => result.target));
            }
        });

        map.on('add highlight', (highlightType, id, display, color, flag) => {
            const $item = document.createElement('li');
            const $name = document.createElement('div');
            const $color = document.createElement('div');
            const $villages = document.createElement('div');
            const $icon = document.createElement('span');

            $item.classList.add(`highlight-${utils.normalizeString(id)}`);
            $item.classList.add('item');
            $item.classList.add(highlightType);
            $item.dataset.highlightType = highlightType;
            $item.dataset.id = id;
            $item.dataset.color = color;

            $name.addEventListener('click', () => {
                map.removeHighlight(highlightType, id);
            });

            $name.classList.add('name');
            $name.innerHTML = display;
            
            $icon.classList.add(`icon-${highlightType}`);

            $color.classList.add('color-selector');
            $color.classList.add('open-color-picker');
            $color.style.backgroundColor = color;
            $color.dataset.color = color;

            $color.addEventListener('click', () => {
                colorPicker($color, $color.dataset.color, (pickedColor) => {
                    $color.dataset.color = pickedColor;
                    map.addHighlight(highlightType, id, pickedColor);
                    return true;
                }, KEEP_COLORPICKER_OPEN);
            });

            let realId;
            let villages;

            if (highlightType === TW2Map.highlightTypes.PLAYERS) {
                realId = typeof id === 'number' ? id : loader.playersByName[id.toLowerCase()];
                villages = loader.players.get(realId)[dataIndex.players.villages];
            } else if (highlightType === TW2Map.highlightTypes.TRIBES) {
                realId = typeof id === 'number' ? id : loader.tribesByName[id.toLowerCase()] || loader.tribesByTag[id.toLowerCase()];
                villages = loader.tribes.get(realId)[dataIndex.tribes.villages];
            }

            $villages.classList.add('villages');
            $villages.innerHTML = villages > 1 ? `${villages} ${i18n('villages', 'maps')}` : `${villages} ${i18n('village', 'maps')}`;

            $item.appendChild($icon);
            $item.appendChild($name);
            $item.appendChild($color);
            $item.appendChild($villages);
            $highlightItems.appendChild($item);

            if (flag !== IGNORE_HIGHLIGHT_STORAGE) {
                updateStoredHighlights();
            }
        });

        map.on('update highlight', (highlightType, id, display, color) => {
            const $item = $highlightItems.querySelector(`.highlight-${utils.normalizeString(id)}`);

            if (!$item) {
                return false;
            }

            const $color = $item.querySelector('.color-selector');

            $color.style.background = color;
            $item.dataset.color = color;

            updateStoredHighlights();
        });

        map.on('remove highlight', (highlightType, id) => {
            const $item = $highlightItems.querySelector(`.highlight-${utils.normalizeString(id)}`);

            if ($item) {
                $item.remove();
            }

            updateStoredHighlights();
        });
    };

    const setupColorPicker = () => {
        let activeColorPicker = false;

        const $colorPicker = document.querySelector('.color-picker');
        const $colorPickerTable = $colorPicker.querySelector('table');

        for (const colorsRow of TW2Map.colorPalette) {
            const $row = document.createElement('tr');

            for (const color of colorsRow) {
                const $wrapper = document.createElement('td');
                const $color = document.createElement('div');
                $color.className = 'color';
                $color.style.background = color;
                $color.dataset.color = color;
                $wrapper.appendChild($color);
                $row.appendChild($wrapper);
            }

            $colorPickerTable.appendChild($row);
        }

        const $colors = $colorPicker.querySelectorAll('div');

        const clearActiveColor = () => {
            const $active = $colorPicker.querySelector('.active');

            if ($active) {
                $active.classList.remove('active');
            }
        };

        const updateActiveColor = (newColor) => {
            for (const $color of $colors) {
                if ($color.dataset.color === newColor) {
                    $color.classList.add('active');
                }
            }
        };

        colorPicker = ($reference, selectedColor, callback, flag) => {
            if (!$reference) {
                throw new Error('Color Picker: Invalid reference element');
            }

            if (activeColorPicker) {
                $colorPicker.removeEventListener('mouseup', activeColorPicker);
            }

            clearActiveColor();

            const {x, y} = utils.getElemPosition($reference);

            $colorPicker.classList.remove('invisible');
            $colorPicker.style.transform = `translate3d(${x}px, ${y}px, 0px)`;

            const index = TW2Map.colorPalette.flat().indexOf(selectedColor);

            if (index !== -1) {
                $colors[index].classList.add('active');
            }

            activeColorPicker = (event) => {
                if (event.target.classList.contains('color')) {
                    const color = event.target.dataset.color;

                    callback(color);
                    clearActiveColor();
                    updateActiveColor(color);

                    if (flag !== KEEP_COLORPICKER_OPEN) {
                        closeColorPicker();
                    }
                }
            };

            $colorPicker.addEventListener('mouseup', activeColorPicker);
        };

        const closeColorPicker = () => {
            $colorPicker.removeEventListener('mouseup', activeColorPicker);
            $colorPicker.classList.add('invisible');
            activeColorPicker = false;
        };

        addEventListener('mousedown', (event) => {
            if (activeColorPicker && !event.target.classList.contains('open-color-picker') && !event.target.closest('.color-picker')) {
                closeColorPicker();
            }
        });
    };

    const setupDisplayLastSync = () => {
        if (mapShare && mapShare.type === mapShareTypes.STATIC) {
            return;
        }

        const $lastSync = document.querySelector('.map .map-info .last-sync');
        const $lastSyncDate = $lastSync.querySelector('.date');

        if (!lastDataSyncDate) {
            $lastSyncDate.innerHTML = 'never';

            return;
        }

        $lastSyncDate.innerHTML = utils.formatSince(lastDataSyncDate);
        $lastSync.classList.remove('hidden');
    };

    const setupDisplayShareDate = () => {
        if (!mapShare) {
            return;
        }

        const $shareDate = document.querySelector('.map .map-info .share-date');
        const $shareDateDate = $shareDate.querySelector('.date');

        $shareDateDate.innerHTML = utils.formatSince(mapShare.creation_date);
        $shareDate.classList.remove('hidden');
    };

    const setupDisplayPosition = () => {
        const $mapInfo = document.querySelector('.map .map-info');
        const $posX = $mapInfo.querySelector('.position-x');
        const $posY = $mapInfo.querySelector('.position-y');

        map.on('center coords update', (x, y) => {
            $posX.innerText = x;
            $posY.innerText = y;
        });
    };

    const setupCommonEvents = () => {
        addEventListener('resize', map.recalcSize);

        addEventListener('keydown', (event) => {
            if (event.target.nodeName === 'INPUT') {
                return;
            }

            switch (event.code) {
                case 'Space': {
                    map.moveTo(500, 500);
                    break;
                }
                case 'Equal': {
                    map.zoomIn();
                    break;
                }
                case 'Minus': {
                    map.zoomOut();
                    break;
                }
            }
        });
    };

    const setupSettings = () => {
        let visible = false;

        const $settings = document.querySelector('.map-settings');
        const $changeSettings = document.querySelector('.change-settings');
        const $colorOptions = $settings.querySelectorAll('.color-option');

        const closeHandler = function (event) {
            const keep = ['.color-picker', '.map-settings', '.change-settings'].some((selector) => {
                return event.target.closest(selector);
            });

            if (!keep) {
                $settings.classList.add('invisible');
                removeEventListener('mousedown', closeHandler);
                visible = false;
            }
        };

        $changeSettings.addEventListener('mouseup', () => {
            if (visible) {
                $settings.classList.add('invisible');
                visible = false;
                return;
            }

            $settings.classList.toggle('invisible');
            visible = !visible;

            if (visible) {
                const {x, y} = utils.getElemPosition($changeSettings);
                $settings.style.left = `${x}px`;
                $settings.style.top = `${y}px`;

                addEventListener('mousedown', closeHandler);
            }
        });

        for (const $option of $colorOptions) {
            const id = $option.dataset.settingId;
            const color = map.getSetting(id);

            const $color = document.createElement('div');
            $color.classList.add('color-selector');
            $color.classList.add('open-color-picker');
            $color.dataset.color = color;
            $color.style.backgroundColor = color;

            $option.appendChild($color);

            $color.addEventListener('click', () => {
                colorPicker($color, $color.dataset.color, (pickedColor) => {
                    $color.dataset.color = pickedColor;
                    $color.style.backgroundColor = pickedColor;
                    map.changeSetting(id, pickedColor);
                    return true;
                }, KEEP_COLORPICKER_OPEN);
            });
        }

        map.on('change setting', (id, value) => {
            const $color = $settings.querySelector(`div[data-setting-id="${id}"] .color`);

            if ($color) {
                $color.dataset.color = value;
                $color.style.backgroundColor = value;
            }
        });
    };

    const setupMapShare = async () => {
        let creatingShare = false;

        if (mapShare) {
            const response = await fetch('/maps/api/get-share', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    mapShareId: mapShare.share_id,
                    marketId,
                    worldNumber,
                    highlightsOnly: true
                })
            });

            if (response.status === 200) {
                const content = await response.json();
                mapShare.highlights = JSON.parse(content.highlights);
            } else {
                const message = await response.text();
                notif({
                    title: i18n('failed_load_map_share', 'errors'),
                    content: message,
                    timeout: 0
                });
            }

            map.moveTo(mapShare.center_x, mapShare.center_y);

            if (mapShare.settings) {
                for (const [id, value] of Object.entries(mapShare.settings)) {
                    map.changeSetting(id, value, TW2Map.INITIAL_SETUP);
                }
            }

            await loader.loadInfo;

            for (const [highlightType, id, color] of mapShare.highlights) {
                map.addHighlight(highlightType, id, color);
            }
        }

        const $mapShare = document.querySelector('#map-share');
        const $mapSave = document.querySelector('#map-save');
        const $mapShareLoading = $mapShare.querySelector('.loading');
        const $mapSaveLoading = $mapSave.querySelector('.loading');
        const $mapShareLabel = $mapShare.querySelector('span');
        const $mapSaveLabel = $mapSave.querySelector('span');

        $mapShare.addEventListener('click', async () => {
            if (creatingShare) {
                return false;
            }

            creatingShare = true;
            $mapShareLabel.classList.add('hidden');
            $mapShareLoading.classList.remove('hidden');

            try {
                const result = await map.shareMap(mapShareTypes.DYNAMIC);

                notif({
                    title: i18n('dynamic_map', 'maps'),
                    link: location.origin + result,
                    timeout: 0
                });
            } catch (error) {
                notif({
                    title: i18n('failed_gen_share_map', 'errors'),
                    content: error.message
                });
            }

            creatingShare = false;
            $mapShareLabel.classList.remove('hidden');
            $mapShareLoading.classList.add('hidden');
        });

        $mapSave.addEventListener('click', async () => {
            if (creatingShare) {
                return false;
            }

            creatingShare = true;
            $mapSaveLabel.classList.add('hidden');
            $mapSaveLoading.classList.remove('hidden');

            try {
                const result = await map.shareMap(mapShareTypes.STATIC);

                notif({
                    title: i18n('static_map', 'maps'),
                    content: i18n('notif_static_share_expire', 'maps', [staticMapExpireTime]),
                    link: location.origin + result,
                    timeout: 0
                });
            } catch (error) {
                notif({
                    title: i18n('failed_gen_share_map', 'errors'),
                    content: error.message
                });
            }

            creatingShare = false;
            $mapSaveLabel.classList.remove('hidden');
            $mapSaveLoading.classList.add('hidden');
        });
    };

    const setupNotif = () => {
        const $notif = document.querySelector('.notif');
        const $notifTitle = $notif.querySelector('.title');
        const $notifContent = $notif.querySelector('.content');
        const $notifLink = $notif.querySelector('.link');
        const $notifClose = $notif.querySelector('.close');

        let activeTimeout;

        $notifClose.addEventListener('click', () => $notif.classList.add('invisible'));

        notif = ({title = '', content = '', timeout = 3000, link = false}) => {
            clearTimeout(activeTimeout);

            title = String(title);

            if (title.length) {
                $notifTitle.innerText = title;
                $notifTitle.classList.remove('invisible');
            } else {
                $notifTitle.classList.add('invisible');
            }

            if (link) {
                $notifLink.href = link;
                $notifLink.innerText = link;
                $notifLink.classList.remove('hidden');
            } else {
                $notifLink.classList.add('hidden');
            }

            if (content.length) {
                $notifContent.innerHTML = content;
                $notifContent.classList.remove('hidden');
            } else {
                $notifContent.classList.add('hidden');
            }

            $notifContent.innerHTML = content;
            $notif.classList.remove('hidden');

            if (typeof timeout === 'number' && timeout !== 0) {
                activeTimeout = setTimeout(() => {
                    $notif.classList.add('hidden');
                }, timeout);
            }
        };
    };

    const setupWorldList = () => {
        let visible = false;

        let loadWorldsPromise = null;
        let allWorlds = null;
        let allMarkets = null;

        const $worldList = document.querySelector('.map-world-list');
        const $marketList = document.querySelector('.map-market-list');
        const $currentWorld = document.querySelector('#current-world');
        const $marketWorlds = document.querySelector('.map-market-worlds');
        const $loading = $worldList.querySelector('.loading');

        const loadWorlds = () => {
            if (loadWorldsPromise) {
                return loadWorldsPromise;
            }

            loadWorldsPromise = new Promise(async (resolve) => {
                const responseWorlds = await fetch('/maps/api/get-open-worlds');
                allWorlds = await responseWorlds.json();
                allMarkets = new Set(allWorlds.map((world) => world.market_id));

                buildWorldList();
                changeWorldList(marketId);
                $loading.classList.add('hidden');
                resolve();
            });
        };

        const buildWorldList = () => {
            for (const market of allMarkets) {
                const $marketContainer = document.createElement('li');
                const $button = document.createElement('div');
                const $flag = document.createElement('span');

                $button.dataset.market = market;
                $button.appendChild($flag);

                if (market === marketId) {
                    $button.classList.add('selected');
                }

                $button.classList.add('market');
                $button.classList.add('flat-button');
                $flag.innerText = market;
                $flag.classList.add(`flag-${market}`);

                $button.appendChild($flag);

                $button.addEventListener('mouseenter', function () {
                    const $selectedMarket = $worldList.querySelector('.market.selected');

                    if ($selectedMarket) {
                        $selectedMarket.classList.remove('selected');
                    }

                    this.classList.add('selected');

                    changeWorldList(this.dataset.market);
                });

                $marketContainer.appendChild($button);
                $marketList.appendChild($marketContainer);
            }
        };

        const changeWorldList = function (newMarketId) {
            const marketWorlds = allWorlds.filter((world) => world.market_id === newMarketId);

            while ($marketWorlds.firstChild) {
                $marketWorlds.removeChild($marketWorlds.lastChild);
            }

            for (const world of marketWorlds) {
                const $world = document.createElement('li');
                const $archor = document.createElement('a');
                const $button = document.createElement('button');

                $archor.href = location.origin + `/maps/${world.market_id}/${world.world_number}`;

                $button.classList.add('world');
                $button.classList.add('relax-button');

                if (worldNumber === world.world_number && marketId === world.market_id) {
                    $button.classList.add('selected');
                }

                $button.innerText = `${world.world_number} ${world.name}`;

                $archor.appendChild($button);
                $world.appendChild($archor);
                $marketWorlds.appendChild($world);
            }
        };

        const closeHandler = function (event) {
            if (!event.target.closest('.map-world-list')) {
                $worldList.classList.add('invisible');
                removeEventListener('mousedown', closeHandler);
                visible = false;
            }
        };

        $currentWorld.addEventListener('mouseup', async () => {
            await loadWorlds();

            if (visible) {
                $worldList.classList.add('invisible');
                visible = false;
                return;
            }

            $worldList.classList.toggle('invisible');
            visible = !visible;

            if (visible) {
                const {x, y} = utils.getElemPosition($currentWorld);
                $worldList.style.left = `${x}px`;
                $worldList.style.top = `${y}px`;

                addEventListener('mousedown', closeHandler);
            }
        });
    };

    const setupPanelToggle = () => {
        const $mapPanel = document.querySelector('.map-panel');
        const $toggle = $mapPanel.querySelector('.map-panel .toggle');
        const $map = document.querySelector('.map');

        $toggle.addEventListener('click', function (event) {
            $mapPanel.classList.toggle('away');
            $map.classList.toggle('full');
            $toggle.classList.toggle('hide');
            map.recalcSize();
        });
    };

    const setupStoredHighlights = async () => {
        if (mapShare) {
            return;
        }

        await loader.loadInfo;

        const stored = localStorage.getItem(HIGHLIGHTS_STORE_KEY);

        if (stored) {
            const parsed = Object.values(JSON.parse(stored).highlights);

            for (const items of parsed) {
                for (const item of Object.values(items)) {
                    const {highlightType, id, color} = item;
                    map.addHighlight(highlightType, id, color, IGNORE_HIGHLIGHT_STORAGE);
                }
            }
        }
    };

    const setupTopThreeHighlighes = async () => {
        if (mapShare) {
            return;
        }

        await loader.loadInfo;
        const top3 = Array.from(loader.tribes.keys()).slice(0, 3);

        for (let i = 0; i < 3; i++) {
            const color = TW2Map.colorPaletteTopThree[i];
            map.addHighlight(TW2Map.highlightTypes.TRIBES, top3[i], color, IGNORE_HIGHLIGHT_STORAGE);
        }
    };

    function createFloatingModal ({className, items, onClose, position = {}}) {
        const $template = document.querySelector('#floating-modal');
        const $modal = $template.content.cloneNode(true).children[0];
        const $header = $modal.querySelector('header');
        const $modalBody = $modal.querySelector('.floating-modal-body');
        const $close = $header.querySelector('.floating-modal-close');
        const $drag = $header.querySelector('.floating-modal-drag');
        const $menu = $header.querySelector('.floating-modal-menu');

        let $selectedBody;
        let $selectedButton;

        const buttonSelector = {};

        if (className) {
            $modal.classList.add(className);
        }

        position = {
            ...position,
            ...{left: 170, top: 20}
        };

        $modal.style.top = position.top + 'px';
        $modal.style.left = position.left + 'px';

        let firstItem = true;

        for (const {label, $body, click} of items) {
            const buttonId = label.toLowerCase();
            const $button = document.createElement('button');
            const $bodyWrapper = document.createElement('div');

            $button.classList.add('relax-button');
            $bodyWrapper.appendChild($body);

            if (firstItem) {
                $selectedBody = $bodyWrapper;
                $selectedButton = $button;
                $button.classList.add('selected');
                $bodyWrapper.classList.add('selected');
                firstItem = false;
            }

            buttonSelector[buttonId] = function () {
                $selectedButton.classList.remove('selected');
                $selectedBody.classList.remove('selected');
                $selectedBody = $bodyWrapper;
                $selectedButton = $button;
                $selectedBody.classList.add('selected');
                $selectedButton.classList.add('selected');
                click();
            };

            $button.innerText = label;
            $button.addEventListener('click', buttonSelector[buttonId]);

            $modalBody.appendChild($bodyWrapper);
            $menu.appendChild($button);
        }

        function close () {
            $modal.classList.add('invisible');

            if (onClose) {
                onClose();
            }
        }

        function open () {
            $modal.classList.remove('invisible');
        }

        function toggle () {
            if ($modal.classList.contains('invisible')) {
                open();
            } else {
                close();
            }
        }

        function select (buttonId) {
            buttonSelector[buttonId]();
        }

        $close.addEventListener('click', close);

        let dragging = false;
        let startX;
        let startY;

        const dragEvent = function (event) {
            if (dragging) {
                $modal.style.left = startX + event.clientX + 'px';
                $modal.style.top = startY + event.clientY + 'px';
            }
        };

        $drag.addEventListener('mousedown', function (event) {
            document.body.addEventListener('mousemove', dragEvent);

            dragging = true;

            const rect = $modal.getBoundingClientRect();

            startX = rect.x - event.clientX;
            startY = rect.y - event.clientY;
        });

        document.body.addEventListener('mouseup', function () {
            dragging = false;
            document.body.removeEventListener('mousemove', dragEvent);
        });

        document.body.appendChild($modal);

        return {
            close,
            open,
            toggle,
            select,
            $modal
        };
    }

    function extractSubjectData (type, subject) {
        if (type === 'players') {
            const [name, tribe_id, points, villages, , bash_off, bash_def, victory_points, rank] = subject;
            return {name, tribe_id, points, villages, bash_off, bash_def, victory_points, rank};
        } else {
            const [name, tag, points, villages, , bash_off, bash_def, victory_points, rank] = subject;
            return {name, tag, points, villages, bash_off, bash_def, victory_points, rank};
        }
    }

    const setupRanking = async () => {
        const $rankingToggle = document.querySelector('#ranking-toggle');
        const $rankingPlayers = document.querySelector('#ranking-players').content.cloneNode(true).children[0];
        const $rankingTribes = document.querySelector('#ranking-tribes').content.cloneNode(true).children[0];

        await loader.loadInfo;

        if (loader.config.victory_points) {
            $rankingPlayers.querySelector('.victory-points').classList.remove('hidden');
            $rankingTribes.querySelector('.victory-points').classList.remove('hidden');
        }

        const itemsLimit = 15;

        const modal = createFloatingModal({
            items: [{
                label: 'Players',
                $body: $rankingPlayers,
                click: function () {}
            }, {
                label: 'Tribes',
                $body: $rankingTribes,
                click: function () {}
            }]
        });

        const columnsType = {
            players: ['rank', 'name', 'name', 'tribe', 'points', 'villages', 'bash_off', 'bash_def', 'bash_total', 'victory_points', 'actions'],
            tribes: ['rank', 'name', 'tag', 'points', 'villages', 'bash_off', 'bash_def', 'bash_total', 'victory_points', 'actions']
        };

        for (const $ranking of [$rankingPlayers, $rankingTribes]) {
            const type = $ranking.dataset.type;
            const $body = $ranking.querySelector('tbody');
            const $pagination = $ranking.querySelector('.pagination');
            const $sortColumns = $ranking.querySelectorAll('.sort');

            const pagination = {
                pages: $pagination.querySelector('.pages'),
                first: $pagination.querySelector('.first'),
                prev: $pagination.querySelector('.prev'),
                last: $pagination.querySelector('.last'),
                next: $pagination.querySelector('.next')
            };

            let page = 1;

            let fullData = Array.from(loader[type].entries()).filter(([id, subject]) => subject[dataIndex[type].villages]);
            const lastPage = Math.max(1, Math.ceil(fullData.length / itemsLimit));
            const domination = [];

            if (type === 'tribes' && !loader.config.victory_points) {
                let topTenVillages = 0;

                for (let i = 0; i < 10; i++) {
                    topTenVillages += fullData[i][1][dataIndex[type].villages];
                }

                for (let i = 0; i < 10; i++) {
                    domination.push(Math.round((fullData[i][1][dataIndex[type].villages] / topTenVillages * 100)));
                }
            }

            let selectedSort = 'rank';

            const sortingHandlers = {
                rank: function (a, b) {
                    return a[1][dataIndex[type][selectedSort]] - b[1][dataIndex[type][selectedSort]];
                },
                bash_total: function (a, b) {
                    return (b[1][dataIndex[type].bash_off] + b[1][dataIndex[type].bash_def]) - (a[1][dataIndex[type].bash_off] + a[1][dataIndex[type].bash_def]);
                },
                generic: function (a, b) {
                    return b[1][dataIndex[type][selectedSort]] - a[1][dataIndex[type][selectedSort]];
                }
            };

            for (const $column of $sortColumns) {
                $column.addEventListener('click', function () {
                    for (const $column of $sortColumns) {
                        $column.classList.remove('selected');
                    }

                    $column.classList.add('selected');

                    if (selectedSort === $column.dataset.sort) {
                        $column.classList.toggle('reverse');
                        fullData = fullData.reverse();
                    } else {
                        $column.classList.remove('reverse');
                        selectedSort = $column.dataset.sort;
                        fullData = fullData.sort(sortingHandlers[selectedSort] || sortingHandlers.generic);
                    }

                    page = 1;
                    renderRankingPage();
                    updatePagination();
                });
            }

            const renderRankingPage = function () {
                while ($body.firstChild) {
                    $body.removeChild($body.lastChild);
                }

                const offset = (page - 1) * itemsLimit;

                for (const [id, subjectData] of fullData.slice(offset, offset + itemsLimit)) {
                    const data = extractSubjectData(type, subjectData);

                    const $row = document.createElement('tr');
                    $row.classList.add('quick-highlight');
                    $row.dataset.id = id;
                    $row.dataset.type = type;

                    const $columns = Object.fromEntries(columnsType[type].map(function (column) {
                        return [column, document.createElement('td')];
                    }));

                    if (type === 'players') {
                        $columns.name.innerText = data.name;

                        if (loader.tribes.has(data.tribe_id)) {
                            $columns.tribe.innerText = loader.tribes.get(data.tribe_id)[1];
                            $columns.tribe.classList.add('highlight');
                            $columns.tribe.addEventListener('click', () => map.addHighlight('tribes', data.tribe_id));
                        } else {
                            $columns.tribe.innerText = '-';
                        }
                    } else {
                        $columns.name.innerText = data.name;
                        $columns.tag.innerText = data.tag;
                        $columns.tag.classList.add('highlight');
                        $columns.tag.addEventListener('click', () => map.addHighlight(type, id));
                    }

                    $columns.rank.innerText = data.rank;
                    $columns.points.innerText = data.points.toLocaleString('pt-BR');
                    $columns.villages.innerText = (type === 'tribes' && data.rank < 11 && !loader.config.victory_points) ? `${data.villages} (${domination[data.rank - 1]}%)` : data.villages;
                    $columns.bash_off.innerText = data.bash_off.toLocaleString('pt-BR');
                    $columns.bash_def.innerText = data.bash_def.toLocaleString('pt-BR');
                    $columns.bash_total.innerText = (data.bash_off + data.bash_def).toLocaleString('pt-BR');
                    $columns.name.classList.add('highlight');
                    $columns.name.addEventListener('click', () => map.addHighlight(type, id));

                    const $stats = document.createElement('a');
                    $stats.href = `/stats/${marketId}/${worldNumber}/${type}/${id}`;
                    $stats.innerText = i18n('button_open_stats', 'maps');
                    $columns.actions.appendChild($stats);

                    if (loader.config.victory_points) {
                        $columns.victory_points.innerText = data.victory_points;
                    } else {
                        $columns.victory_points.style.display = 'none';
                    }

                    for (const $elem of Object.values($columns)) {
                        $row.appendChild($elem);
                    }

                    $body.appendChild($row);
                }

                updatePagination();
                setTemporaryHighlights();
            };

            const updatePagination = function () {
                const start = Math.max(1, page - 3);
                const end = Math.min(lastPage, page + 3);

                while (pagination.pages.firstChild) {
                    pagination.pages.removeChild(pagination.pages.lastChild);
                }

                for (let i = start; i <= end; i++) {
                    let $page;

                    if (i === page) {
                        $page = document.createElement('span');
                        $page.classList.add('current');
                    } else {
                        $page = document.createElement('a');
                        $page.addEventListener('click', function () {
                            page = i;
                            renderRankingPage();
                        });
                    }

                    $page.innerText = i;
                    $page.classList.add('page');
                    pagination.pages.appendChild($page);
                }
            };

            pagination.first.addEventListener('click', function () {
                page = 1;
                renderRankingPage();
            });

            pagination.last.addEventListener('click', function () {
                page = lastPage;
                renderRankingPage();
            });

            pagination.next.addEventListener('click', function () {
                page = Math.min(lastPage, page + 1);
                renderRankingPage();
            });

            pagination.prev.addEventListener('click', function () {
                page = Math.max(1, page - 1);
                renderRankingPage();
            });

            renderRankingPage();
        }
        
        $rankingToggle.addEventListener('click', async function () {
            modal.toggle();
        });
    };

    function averagePositionFor (type, id) {
        let averageX;
        let averageY;

        switch (type) {
            case TW2Map.highlightTypes.TRIBES: {
                [averageX, averageY] = loader.tribes.get(id)[4];
                break;
            }
            case TW2Map.highlightTypes.PLAYERS: {
                [averageX, averageY] = loader.players.get(id)[4];
                break;
            }
            case TW2Map.highlightTypes.VILLAGES: {
                averageX = loader.villagesById[id].x;
                averageY = loader.villagesById[id].y;
                break;
            }
            default: {
                throw new Error('averagePositionFor: Invalid type.');
            }
        }

        return [averageX, averageY];
    }

    function setTemporaryHighlights () {
        const $elements = document.querySelectorAll('.quick-highlight');

        if (!$elements.length) {
            return false;
        }

        for (const $elem of $elements) {
            $elem.addEventListener('mouseenter', () => {
                const id = parseInt($elem.dataset.id, 10);

                if ($elem.dataset.type === 'conquest') {
                    const newOwner = parseInt($elem.dataset.newOwner, 10);
                    const oldOwner = parseInt($elem.dataset.oldOwner, 10);

                    if (oldOwner) {
                        map.quickHighlight('players', oldOwner, TW2Map.colorPaletteTopThree[2]);
                    }

                    map.quickHighlight('players', newOwner, TW2Map.colorPaletteTopThree[1]);
                    map.quickHighlight('villages', id);
                    map.moveTo(...averagePositionFor('villages', id));
                } else {
                    map.quickHighlight($elem.dataset.type, id);
                    map.moveTo(...averagePositionFor($elem.dataset.type, id));
                }
            });

            $elem.addEventListener('mouseleave', () => {
                map.quickHighlightOff();
            });
        }
    }

    function updateStoredHighlights () {
        if (mapShare) {
            return false;
        }

        localStorage.setItem(HIGHLIGHTS_STORE_KEY, JSON.stringify({highlights: map.getHighlights()}));
    }

    // adapted from https://github.com/aceakash/string-similarity
    function compareTwoStrings (first, second) {
        first = first.replace(/\s+/g, '');
        second = second.replace(/\s+/g, '');

        if (first === second) {
            return 1;
        }
        
        if (first.length < 2 || second.length < 2) {
            return 0;
        }

        const firstBigrams = new Map();
        for (let i = 0; i < first.length - 1; i++) {
            const bigram = first.substring(i, i + 2);
            const count = firstBigrams.has(bigram) ? firstBigrams.get(bigram) + 1 : 1;
            firstBigrams.set(bigram, count);
        }

        let intersectionSize = 0;
        for (let i = 0; i < second.length - 1; i++) {
            const bigram = second.substring(i, i + 2);
            const count = firstBigrams.has(bigram) ? firstBigrams.get(bigram) : 0;

            if (count > 0) {
                firstBigrams.set(bigram, count - 1);
                intersectionSize++;
            }
        }

        return (2.0 * intersectionSize) / (first.length + second.length - 2);
    }

    const loader = new TW2DataLoader(marketId, worldNumber);
    const tooltip = new TW2Tooltip('#map-tooltip');
    const map = new TW2Map('.map', loader, tooltip, {});

    setupQuickJump();
    setupCustomHighlights();
    setupColorPicker();
    setupDisplayShareDate();
    setupDisplayLastSync();
    setupDisplayPosition();
    setupCommonEvents();
    setupNotif();
    setupWorldList();
    setupSettings();
    setupMapShare();
    setupPanelToggle();
    setupStoredHighlights();
    setupRanking();
    setupTopThreeHighlighes();

    map.init();
});
