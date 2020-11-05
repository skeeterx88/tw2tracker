(async () => {
    const colors = ["#ffee00", "#0000ff", "#ff0000"]

    const setupMapPreview = async () => {
        const loader = new TW2DataLoader(marketId, worldNumber)
        const map = new TW2Map('#map', loader, null, {
            allowZoom: false,
            zoomLevel: 1,
            quickHighlight: false
        })

        map.init()

        if (STATS_PAGE === 'home') {
            const $colors = document.querySelectorAll('#tribes .color')

            for (let i = 0; i < mapHighlights.length; i++) {
                $colors[i].style.backgroundColor = colors[i]
            }
        }

        await loader.loadInfo

        const highlightType = STATS_PAGE === 'player'
            ? TW2Map.highlightTypes.PLAYERS
            : TW2Map.highlightTypes.TRIBES

        for (let i = 0; i < mapHighlights.length; i++) {
            map.addHighlight(highlightType, mapHighlights[i].name, colors[i])
        }
    }

    switch (STATS_PAGE) {
        case 'home':
        case 'tribe':
        case 'player': {
            setupMapPreview()
            break;
        }
    }
})();
