require([
    'TW2Map',
    'TW2Tooltip',
    'TW2DataLoader',
    'utils',
    'backendValues'
], function (
    TW2Map,
    TW2Tooltip,
    TW2DataLoader,
    utils,
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
                [averageX, averageY] = utils.averageCoords(loader.tribePlayers[id].map((pid) => loader.playerVillages[pid]).flat());
                break;
            }
            case TW2Map.highlightTypes.PLAYERS: {
                [averageX, averageY] = utils.averageCoords(loader.playerVillages[id]);
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

        if (typeof mapHighlights !== 'undefined') {
            for (let i = 0; i < mapHighlights.length; i++) {
                map.addHighlight(mapHighlightsType, mapHighlights[i].name, TW2Map.colorPaletteTopThree[i]);
            }
        }
    };

    const setupQuickHighlight = async () => {
        const $highlightRows = document.querySelectorAll('.quick-highlight tbody tr');

        if (!$highlightRows.length) {
            return false;
        }

        await loader.loadInfo;

        for (const $row of $highlightRows) {
            $row.addEventListener('mouseenter', () => {
                const id = parseInt($row.dataset.id, 10);

                map.quickHighlight($row.dataset.highlightType, id);
                const [averageX, averageY] = averagePositionFor($row.dataset.highlightType, id);
                map.moveTo(averageX, averageY);
            });

            $row.addEventListener('mouseleave', () => {
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
