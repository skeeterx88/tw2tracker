require([
    'AutoComplete',
    'TW2Map',
    'TW2DataLoader',
    'TW2Tooltip',
    'utils',
    'backendValues'
], function (
    AutoComplete,
    TW2Map,
    TW2DataLoader,
    TW2Tooltip,
    utils,
    {
        marketId,
        worldNumber,
        mapShare,
        lastDataSyncDate,
        staticMapExpireTime,
        i18n
    }
) {
    let colorPicker;
    let notif;
    const KEEP_COLORPICKER_OPEN = 'keep_colorpicker_open';

    const setupQuickJump = () => {
        const $quickJumpX = document.querySelector('#quick-jump-x');
        const $quickJumpY = document.querySelector('#quick-jump-y');
        const $quickJumpGo = document.querySelector('#quick-jump-go');

        $quickJumpX.addEventListener('keydown', (event) => {
            if (event.code === 'Enter') {
                map.moveTo($quickJumpX.value, $quickJumpY.value);
            }
        });

        const rnondigit = /[^\d]/g;
        const rloosecoords = /(\d{1,3})[^\d](\d{1,3})/;

        const coordsInputFactory = ($input) => {
            return (event) => {
                if (event.inputType === 'insertFromPaste' || event.inputType === 'insertFromDrag') {
                    const coords = $input.value.match(rloosecoords);

                    if (coords !== null) {
                        $quickJumpX.value = coords[1];
                        $quickJumpY.value = coords[2];
                        $quickJumpY.focus();

                        return;
                    }
                }

                $input.value = $input.value.replace(rnondigit, '');

                if ($input.value.length > 3) {
                    $input.value = $quickJumpX.value.slice(0, 3);
                }
            };
        };

        $quickJumpX.addEventListener('input', coordsInputFactory($quickJumpX));
        $quickJumpY.addEventListener('input', coordsInputFactory($quickJumpY));

        $quickJumpY.addEventListener('keydown', (event) => {
            if (event.code === 'Enter') {
                map.moveTo($quickJumpX.value, $quickJumpY.value);
            }
        });

        $quickJumpGo.addEventListener('click', (event) => {
            map.moveTo($quickJumpX.value, $quickJumpY.value);
        });
    };

    const setupCustomHighlights = () => {
        const $highlightId = document.getElementById('highlight-id');
        const $highlightItems = document.getElementById('highlight-items');

        const setupAutoComplete = () => {
            const autoComplete = new AutoComplete({
                data: {
                    src: async () => {
                        await loader.loadInfo;

                        const matches = [];

                        for (const [name] of Object.values(loader.players)) {
                            matches.push({
                                search: name,
                                id: name,
                                highlightType: TW2Map.highlightTypes.PLAYERS
                            });
                        }

                        for (const [name, tag] of Object.values(loader.tribes)) {
                            matches.push({
                                search: `${tag} (${name})`,
                                id: tag,
                                highlightType: TW2Map.highlightTypes.TRIBES
                            });
                        }

                        return matches;
                    },
                    key: ['search'],
                    cache: false
                },
                searchEngine: 'loose',
                selector: '#highlight-id',
                resultsList: {
                    render: true
                },
                threshold: 1,
                trigger: {
                    event: ['input', 'keypress', 'focusin']
                },
                sort: (a, b) => {
                    if (a.match < b.match) return -1;
                    if (a.match > b.match) return 1;
                    return 0;
                },
                noResults: () => {
                    const $item = document.createElement('li');
                    $item.innerHTML = i18n.maps.search_no_results;
                    autoComplete.resultsList.view.appendChild($item);
                },
                highlight: true,
                onSelection: (feedback) => {
                    const {id, highlightType} = feedback.selection.value;
                    const color = utils.arrayRandom(TW2Map.colorPalette.flat());

                    map.addHighlight(highlightType, id, color);
                    $highlightId.value = '';
                }
            });

            $highlightId.addEventListener('blur', () => {
                autoComplete.resultsList.view.style.display = 'none';
            });

            $highlightId.addEventListener('focus', () => {
                autoComplete.resultsList.view.style.display = '';
            });

            $highlightId.addEventListener('keydown', async (event) => {
                if (event.key === 'Escape') {
                    $highlightId.value = '';
                    $highlightId.dispatchEvent(new Event('input'));
                }
            });

            $highlightId.addEventListener('autoComplete', ({detail}) => {
                if (detail.event.key == 'Enter' && detail.matches > 0) {
                    autoComplete.listMatchedResults(autoComplete.dataStream).then(() => {
                        const first = autoComplete.resultsList.view.children.item(0);
                        first.dispatchEvent(new Event('mousedown'));
                    });
                }
            });
        };

        map.on('add highlight', (highlightType, id, displayName, color) => {
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
            $name.innerHTML = displayName;
            
            $icon.classList.add(`icon-${highlightType}`);

            $color.classList.add('color');
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
                villages = loader.players[realId][3];
            } else if (highlightType === TW2Map.highlightTypes.TRIBES) {
                realId = typeof id === 'number' ? id : loader.tribesByName[id.toLowerCase()] || loader.tribesByTag[id.toLowerCase()];
                villages = loader.tribes[realId][3];
            }

            $villages.classList.add('villages');
            $villages.innerHTML = villages > 1 ? `${villages} ${i18n.maps.villages}` : `${villages} ${i18n.maps.village}`;

            $item.appendChild($icon);
            $item.appendChild($name);
            $item.appendChild($color);
            $item.appendChild($villages);
            $highlightItems.appendChild($item);
        });

        map.on('update highlight', (highlightType, id, displayName, color) => {
            const $item = $highlightItems.querySelector(`.highlight-${utils.normalizeString(id)}`);

            if (!$item) {
                return false;
            }

            const $color = $item.querySelector('.color');

            $color.style.background = color;
            $item.dataset.color = color;
        });

        map.on('remove highlight', (highlightType, id) => {
            const $item = $highlightItems.querySelector(`.highlight-${utils.normalizeString(id)}`);

            if ($item) {
                $item.remove();
            }
        });

        setupAutoComplete();
    };

    const setupColorPicker = () => {
        let activeColorPicker = false;

        const $colorPicker = document.querySelector('#color-picker');
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

            $colorPicker.style.visibility = 'visible';
            $colorPicker.style.opacity = 1;
            $colorPicker.style.transform = `translate3d(${x}px, ${y}px, 0px)`;

            const index = TW2Map.colorPalette.flat().indexOf(selectedColor);

            if (index !== -1) {
                $colors[index].classList.add('active');
            }

            $colorPicker.style.visibility = 'visible';
            $colorPicker.style.opacity = 1;

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
            $colorPicker.style.visibility = 'hidden';
            $colorPicker.style.opacity = 0;
            activeColorPicker = false;
        };

        addEventListener('mousedown', (event) => {
            if (activeColorPicker && !event.target.classList.contains('open-color-picker') && !event.target.closest('#color-picker')) {
                closeColorPicker();
            }
        });
    };

    const setupDisplayLastSync = () => {
        if (mapShare && mapShare.type === TW2Map.mapShareTypes.STATIC) {
            return;
        }

        const $lastSync = document.querySelector('#last-sync');
        const $lastSyncDate = document.querySelector('#last-sync-date');

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

        const $shareDate = document.querySelector('#share-date');
        const $shareDateDate = document.querySelector('#share-date-date');

        $shareDateDate.innerHTML = utils.formatSince(mapShare.creation_date);
        $shareDate.classList.remove('hidden');
    };

    const setupDisplayPosition = () => {
        const $displayPositionX = document.querySelector('#display-position-x');
        const $displayPositionY = document.querySelector('#display-position-y');

        map.on('center coords update', (x, y) => {
            $displayPositionX.innerHTML = x;
            $displayPositionY.innerHTML = y;
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

        const $settings = document.querySelector('#settings');
        const $changeSettings = document.querySelector('#change-settings');
        const $colorOptions = document.querySelectorAll('#settings .color-option');

        const closeHandler = function (event) {
            const keep = ['#color-picker', '#settings', '#change-settings'].some((selector) => {
                return event.target.closest(selector);
            });

            if (!keep) {
                $settings.classList.add('hidden');
                removeEventListener('mousedown', closeHandler);
                visible = false;
            }
        };

        $changeSettings.addEventListener('mouseup', () => {
            if (visible) {
                $settings.classList.add('hidden');
                visible = false;
                return;
            }

            $settings.classList.toggle('hidden');
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
            $color.classList.add('color');
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
                    title: i18n.errors.failed_load_map_share,
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
                const result = await map.shareMap(TW2Map.mapShareTypes.DYNAMIC);

                notif({
                    title: i18n.maps.dynamic_map,
                    link: location.origin + result,
                    timeout: 0
                });
            } catch (error) {
                notif({
                    title: i18n.errors.failed_gen_share_map,
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
                const result = await map.shareMap(TW2Map.mapShareTypes.STATIC);

                notif({
                    title: i18n.maps.static_map,
                    content: i18n.maps.notif_static_share_expire,
                    link: location.origin + result,
                    timeout: 0
                });
            } catch (error) {
                notif({
                    title: i18n.errors.failed_gen_share_map,
                    content: error.message
                });
            }

            creatingShare = false;
            $mapSaveLabel.classList.remove('hidden');
            $mapSaveLoading.classList.add('hidden');
        });
    };

    const setupNotif = () => {
        const $notif = document.querySelector('#notif');
        const $notifTitle = $notif.querySelector('#notif-title');
        const $notifContent = $notif.querySelector('#notif-content');
        const $notifLink = $notif.querySelector('#notif-link');
        const $notifClose = $notif.querySelector('#notif-close');

        let activeTimeout;

        $notifClose.addEventListener('click', () => $notif.classList.add('hidden'));

        notif = ({title = '', content = '', timeout = 3000, link = false}) => {
            clearTimeout(activeTimeout);

            title = String(title);

            if (title.length) {
                $notifTitle.innerText = title;
                $notifTitle.classList.remove('hidden');
            } else {
                $notifTitle.classList.add('hidden');
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

        const $allWorlds = document.querySelector('#all-worlds');
        const $allMarkets = document.querySelector('#all-markets');
        const $currentWorld = document.querySelector('#current-world');
        const $allMarketWorlds = document.querySelector('#all-market-worlds');
        const $loading = $allWorlds.querySelector('.loading');

        const loadWorlds = () => {
            if (loadWorldsPromise) {
                return loadWorldsPromise;
            }

            loadWorldsPromise = new Promise(async (resolve) => {
                const responseWorlds = await fetch('/maps/api/get-open-worlds');
                const worlds = await responseWorlds.json();

                allWorlds = worlds;
                allMarkets = new Set(worlds.map((world) => world.market));

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
                $button.classList.add('text-container');
                $flag.innerText = market;
                $flag.classList.add(`flag-${market}`);

                $button.appendChild($flag);

                $button.addEventListener('mouseenter', function () {
                    const $selectedmarket = $allWorlds.querySelector('.market.selected');

                    if ($selectedmarket) {
                        $selectedmarket.classList.remove('selected');
                    }

                    this.classList.add('selected');

                    changeWorldList(this.dataset.market);
                });

                $marketContainer.appendChild($button);
                $allMarkets.appendChild($marketContainer);
            }
        };

        const changeWorldList = function (newMarket) {
            const marketWorlds = allWorlds.filter((world) => world.market === newMarket);

            while ($allMarketWorlds.firstChild) {
                $allMarketWorlds.removeChild($allMarketWorlds.lastChild);
            }

            for (const {market, num, name} of marketWorlds) {
                const $world = document.createElement('li');
                const $archor = document.createElement('a');
                const $button = document.createElement('button');

                $archor.href = location.origin + `/maps/${market}/${num}/`;

                $button.classList.add('world');

                if (worldNumber === num && marketId === market) {
                    $button.classList.add('selected');
                }

                $button.innerText = `${market}${num} ${name}`;

                $archor.appendChild($button);
                $world.appendChild($archor);
                $allMarketWorlds.appendChild($world);
            }
        };

        const closeHandler = function (event) {
            const keep = ['#all-worlds', '#current-world'].some((selector) => {
                return event.target.closest(selector);
            });

            if (!keep) {
                $allWorlds.classList.add('hidden');
                removeEventListener('mousedown', closeHandler);
                visible = false;
            }
        };

        $currentWorld.addEventListener('mouseup', async () => {
            await loadWorlds();

            if (visible) {
                $allWorlds.classList.add('hidden');
                visible = false;
                return;
            }

            $allWorlds.classList.toggle('hidden');
            visible = !visible;

            if (visible) {
                const {x, y} = utils.getElemPosition($currentWorld);
                $allWorlds.style.left = `${x}px`;
                $allWorlds.style.top = `${y}px`;

                addEventListener('mousedown', closeHandler);
            }
        });
    };

    const setupPanelToggle = () => {
        const $panelToggle = document.querySelector('#panel-toggle');
        const $sidePanel = document.querySelector('#side-panel');
        const $map = document.querySelector('#map');

        $panelToggle.addEventListener('click', function (event) {
            $sidePanel.classList.toggle('hidden');
            $map.classList.toggle('full');
            $panelToggle.classList.toggle('hide');
            map.recalcSize();
        });
    };

    // const setupAbout = () => {
    //     const $contact = document.querySelector('#contact')
    //     const $about = document.querySelector('#about')

    //     $contact.addEventListener('click', () => {
    //         notif({
    //             title: 'Contact',
    //             content: 'contact@tw2-tracker.com',
    //             timeout: 0
    //         })
    //     })

    //     $about.addEventListener('click', () => {
    //         notif({
    //             title: 'About',
    //             content: 'This site is an interactive world map for Tribal Wars 2 created in 2020 by <i>anonymous</i>.',
    //             timeout: 0
    //         })
    //     })
    // }

    const loader = new TW2DataLoader(marketId, worldNumber);
    const tooltip = new TW2Tooltip('#map-tooltip');
    const map = new TW2Map('#map', loader, tooltip, {});

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
    // setupAbout()

    map.init();
});
