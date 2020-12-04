(async () => {
    let map
    let loader

    const colors = ["#ffee00", "#0000ff", "#ff0000"]

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

    const setupMapPreview = async () => {
        loader = new TW2DataLoader(marketId, worldNumber)
        map = new TW2Map('#map', loader, null, {
            allowZoom: false,
            zoomLevel: 1,
            inlineHighlight: false,
            quickHighlightColor: '#000000'
        })

        map.init()

        if (STATS_PAGE === 'home') {
            const $colors = document.querySelectorAll('#tribes .color')

            for (let i = 0; i < mapHighlights.length; i++) {
                $colors[i].style.backgroundColor = colors[i]
            }
        }

        await loader.loadInfo

        const highlightType = STATS_PAGE === 'player' || STATS_PAGE === 'player-villages'
            ? TW2Map.highlightTypes.PLAYERS
            : TW2Map.highlightTypes.TRIBES

        for (let i = 0; i < mapHighlights.length; i++) {
            map.addHighlight(highlightType, mapHighlights[i].name, colors[i])
        }
    }

    const setupQuickHighlight = async () => {
        await loader.loadInfo

        const $highlightRows = document.querySelectorAll('.quick-highlight tbody tr')

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
            if (!hasOwn.call(SEARCH_CATEGORIES, category)) {
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

        for ($searchCategory of $searchCategories) {
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

    if (STATS_PAGE === 'home') {
        setupMapPreview()
        setupQuickHighlight()
        setupSearch()
    } else if (STATS_PAGE === 'tribe-members') {
        setupMapPreview()
        setupQuickHighlight()
        setupMapCenter(TW2Map.highlightTypes.TRIBES, tribe.id)
    } else if (STATS_PAGE === 'tribe-villages') {
        setupMapPreview()
        setupQuickHighlight()
        setupMapCenter(TW2Map.highlightTypes.TRIBES, tribe.id)
    } else if (STATS_PAGE === 'tribe') {
        setupMapPreview()
        setupMapCenter(TW2Map.highlightTypes.TRIBES, tribe.id)
    } else if (STATS_PAGE === 'player') {
        setupMapPreview()
        setupMapCenter(TW2Map.highlightTypes.PLAYERS, player.id)
    } else if (STATS_PAGE === 'player-villages', tribe.id) {
        setupMapPreview()
        setupQuickHighlight()
        setupMapCenter(TW2Map.highlightTypes.PLAYERS, player.id)
    }
})();
