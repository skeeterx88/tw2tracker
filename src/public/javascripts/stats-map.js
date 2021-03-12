require([
    'TW2Map',
    'TW2Tooltip',
    'TW2DataLoader',
    'backendValues'
], function (
    TW2Map,
    TW2Tooltip,
    TW2DataLoader,
    {
        mapHighlights,
        mapHighlightsType,
        marketId,
        worldNumber,
        player,
        tribe
    }
) {
    let map;
    let loader;
    let tooltip;

    const averagePositionFor = (type, id) => {
        let averageX;
        let averageY;

        switch (type) {
            case TW2Map.highlightTypes.TRIBES: {
                [averageX, averageY] = loader.tribes[id][4];
                break;
            }
            case TW2Map.highlightTypes.PLAYERS: {
                [averageX, averageY] = loader.players[id][4];
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
    };

    const setupTopRankingColors = () => {
        const $topColors = document.querySelectorAll('.top-colors');

        if (!$topColors.length) {
            return false;
        }

        for (let i = 0; i < mapHighlights.length; i++) {
            $topColors[i].style.backgroundColor = TW2Map.colorPaletteTopThree[i];
        }
    };

    const setupMapPreview = async () => {
        if (!document.querySelector('#map')) {
            return false;
        }

        loader = new TW2DataLoader(marketId, worldNumber);
        tooltip = new TW2Tooltip('#map-tooltip');
        map = new TW2Map('#map', loader, tooltip, {
            allowZoom: true,
            zoomWithShift: true,
            zoomLevel: 2,
            inlineHighlight: true,
            quickHighlightColor: '#000000'
        });

        map.init();

        addEventListener('resize', map.recalcSize);

        await loader.loadInfo;

        addQuickHighlights();
    };

    const addQuickHighlights = () => {
        if (typeof mapHighlights !== 'undefined') {
            for (let i = 0; i < mapHighlights.length; i++) {
                map.addHighlight(mapHighlightsType, mapHighlights[i].name, TW2Map.colorPaletteTopThree[i]);
            }
        }
    };

    const removeQuickHighlights = () => {
        if (typeof mapHighlights !== 'undefined') {
            for (let i = 0; i < mapHighlights.length; i++) {
                map.removeHighlight(mapHighlightsType, mapHighlights[i].name);
            }
        }
    };

    const setupQuickHighlight = async () => {
        const $highlightRows = document.querySelectorAll('.quick-highlight');

        if (!$highlightRows.length) {
            return false;
        }

        await loader.loadInfo;

        let currentTemporaryHighlightType;

        for (const $row of $highlightRows) {
            $row.addEventListener('mouseenter', () => {
                const id = parseInt($row.dataset.id, 10);

                currentTemporaryHighlightType = $row.dataset.type;

                if ($row.dataset.type === 'conquest') {
                    removeQuickHighlights();

                    const newOwner = parseInt($row.dataset.newOwner, 10);
                    const oldOwner = parseInt($row.dataset.oldOwner, 10);

                    if (oldOwner) {
                        map.quickHighlight('players', oldOwner, TW2Map.colorPaletteTopThree[2]);
                    }

                    map.quickHighlight('players', newOwner, TW2Map.colorPaletteTopThree[1]);
                    map.quickHighlight('villages', id);
                    map.moveTo(...averagePositionFor('villages', id));
                } else {
                    map.quickHighlight($row.dataset.type, id);
                    map.moveTo(...averagePositionFor($row.dataset.type, id));
                }
            });

            $row.addEventListener('mouseleave', () => {
                if (currentTemporaryHighlightType === 'conquest') {
                    addQuickHighlights();
                }

                map.quickHighlightOff();
            });
        }
    };

    const setupMapCenter = async (type, id) => {
        if (typeof id !== 'number') {
            throw new Error('setupMapCenter: Invalid id.');
        }

        await Promise.all([
            loader.loadInfo,
            loader.loadContinent(55),
            loader.loadContinent(54),
            loader.loadContinent(45),
            loader.loadContinent(44)
        ]);

        map.moveTo(...averagePositionFor(type, id));
    };

    setupMapPreview();
    setupTopRankingColors();
    setupQuickHighlight();

    if (typeof player !== 'undefined') {
        setupMapCenter(TW2Map.highlightTypes.PLAYERS, player.id);
    } else if (typeof tribe !== 'undefined') {
        setupMapCenter(TW2Map.highlightTypes.TRIBES, tribe.id);
    }
});
