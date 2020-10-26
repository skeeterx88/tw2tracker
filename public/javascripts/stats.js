(async () => {
    const colors = ["#0075ff", "#ffee00", "#ff008a"]

    const setupMapPreview = async () => {
        const $colors = document.querySelectorAll('#tribes .color')
        const loader = new TW2DataLoader(marketId, worldNumber)
        const map = new TW2Map('#map', loader, null, {
            allowZoom: false,
            zoomLevel: 1,
            quickHighlight: false
        })

        let index = 0

        map.init()

        await loader.loadInfo

        for (let color of colors) {
            map.addHighlight(TW2Map.highlightTypes.TRIBES, tribes[index].id, colors[index])
            console.log($colors[index], colors[index])
            $colors[index].style.backgroundColor = colors[index]

            index++
        }
    }

    await setupMapPreview()
})();
