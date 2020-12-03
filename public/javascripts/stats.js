(async () => {
    let map

    const colors = ["#ffee00", "#0000ff", "#ff0000"]

    const setupMapPreview = async () => {
        const loader = new TW2DataLoader(marketId, worldNumber)

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
        const $highlightRows = document.querySelectorAll('.quick-highlight tbody tr')

        for (let $row of $highlightRows) {
            $row.addEventListener('mouseenter', () => {
                map.quickHighlight($row.dataset.highlightType, parseInt($row.dataset.id, 10))
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

        selectCategory(SEARCH_CATEGORIES.players)

        $form.addEventListener('submit', function (event) {
            const length = $searchInput.value.length

            if (!length || length > 20) {
                event.preventDefault()
            }
        })
    }

    if (STATS_PAGE === 'home') {
        setupMapPreview()
        setupQuickHighlight()
        setupSearch()
    } else if (STATS_PAGE === 'tribe-members') {
        setupMapPreview()
        setupQuickHighlight()
    } else if (STATS_PAGE === 'tribe') {
        setupMapPreview()
    } else if (STATS_PAGE === 'player') {
        setupMapPreview()
    } else if (STATS_PAGE === 'player-villages') {
        setupMapPreview()
        setupQuickHighlight()
    }
})();
