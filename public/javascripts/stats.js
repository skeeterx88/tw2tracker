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
    {
        averageCoords,
        hasOwn
    },
    {
        mapHighlights,
        mapHighlightsType,
        marketId,
        worldNumber,
        player,
        tribe
    }
) {
    let map
    let loader
    let tooltip

    const colors = ['#ffee00', '#0000ff', '#ff0000']

    const averagePositionFor = (type, id) => {
        let averageX
        let averageY

        switch (type) {
            case TW2Map.highlightTypes.TRIBES: {
                [averageX, averageY] = averageCoords(loader.tribePlayers[id].map((pid) => loader.playerVillages[pid]).flat())
                break
            }
            case TW2Map.highlightTypes.PLAYERS: {
                [averageX, averageY] = averageCoords(loader.playerVillages[id])
                break
            }
            case TW2Map.highlightTypes.VILLAGES: {
                averageX = loader.villagesById[id].x
                averageY = loader.villagesById[id].y
                break
            }
            default: {
                throw new Error('averagePositionFor: Invalid type.')
            }
        }

        return [averageX, averageY]
    }

    const setupTopRankingColors = () => {
        const $topColors = document.querySelectorAll('.top-colors')

        if (!$topColors.length) {
            return false
        }

        for (let i = 0; i < mapHighlights.length; i++) {
            $topColors[i].style.backgroundColor = colors[i]
        }
    }

    const setupMapPreview = async () => {
        if (!document.querySelector('#map')) {
            return false
        }

        loader = new TW2DataLoader(marketId, worldNumber)
        tooltip = new TW2Tooltip('#map-tooltip')
        map = new TW2Map('#map', loader, tooltip, {
            allowZoom: false,
            zoomLevel: 1,
            inlineHighlight: true,
            quickHighlightColor: '#000000'
        })

        map.init()

        addEventListener('resize', map.recalcSize)

        await loader.loadInfo

        if (typeof mapHighlights !== 'undefined') {
            for (let i = 0; i < mapHighlights.length; i++) {
                map.addHighlight(mapHighlightsType, mapHighlights[i].name, colors[i])
            }
        }
    }

    const setupQuickHighlight = async () => {
        const $highlightRows = document.querySelectorAll('.quick-highlight tbody tr')

        if (!$highlightRows.length) {
            return false
        }

        await loader.loadInfo

        for (let $row of $highlightRows) {
            $row.addEventListener('mouseenter', () => {
                const id = parseInt($row.dataset.id, 10)

                map.quickHighlight($row.dataset.highlightType, id)
                let [averageX, averageY] = averagePositionFor($row.dataset.highlightType, id)
                map.moveTo(averageX, averageY)
            })

            $row.addEventListener('mouseleave', () => {
                map.quickHighlightOff()
            })
        }
    }

    const setupSearch = async () => {
        if (!document.querySelector('#search')) {
            return false
        }

        const SEARCH_CATEGORIES = {
            players: 'players',
            tribes: 'tribes',
            villages: 'villages'
        }

        const $searchCategories = document.querySelectorAll('#search-categories li')
        const $searchInput = document.querySelector('#search-input')
        const $form = document.querySelector('#search form')
        const $hiddenInput = document.querySelector('#search-category')

        const selectCategory = (category) => {
            if (!hasOwn(SEARCH_CATEGORIES, category)) {
                return false
            }

            const $selected = document.querySelector('#search-categories li.selected')

            if ($selected) {
                $selected.classList.remove('selected')
            }

            const $toSelect = document.querySelector(`#search-categories li[data-search-category=${category}]`)
            $toSelect.classList.add('selected')
            $hiddenInput.value = category

            $searchInput.focus()
        }

        for (let $searchCategory of $searchCategories) {
            $searchCategory.addEventListener('click', function () {
                selectCategory(this.dataset.searchCategory)
                return false
            })
        }

        $form.addEventListener('submit', function (event) {
            const length = $searchInput.value.length

            if (!length || length > 20) {
                event.preventDefault()
            }
        })
    }

    const setupMapCenter = async (type, id) => {
        if (typeof id !== 'number') {
            throw new Error('setupMapCenter: Invalid id.')
        }

        await Promise.all([
            loader.loadInfo,
            loader.loadContinent(55),
            loader.loadContinent(54),
            loader.loadContinent(45),
            loader.loadContinent(44)
        ])

        map.moveTo(...averagePositionFor(type, id))
    }

    setupMapPreview()
    setupTopRankingColors()
    setupQuickHighlight()
    setupSearch()

    if (typeof player !== 'undefined') {
        setupMapCenter(TW2Map.highlightTypes.PLAYERS, player.id)
    } else if (typeof tribe !== 'undefined') {
        setupMapCenter(TW2Map.highlightTypes.TRIBES, tribe.id)
    }
})
