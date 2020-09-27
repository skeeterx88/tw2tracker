const colorPalette = [
    ["#ffffff", "#ffd1d1", "#aee7ff", "#c0ffd0", "#ffe7cf", "#fff9a1", "#ffdaee", "#ffd5b6", "#dfceff", "#cde4ff", "#d8dcff", "#ffcff8", "#f0c800", "#ff4b4b"],
    ["#dfdfdf", "#e21f1f", "#03709d", "#0a8028", "#aa6b2b", "#ffee00", "#b2146b", "#d96a19", "#5c32a9", "#47617f", "#0111af", "#d315b6", "#8888fc", "#ce8856"],
    ["#e0ff4c", "#980e0e", "#014a69", "#04571a", "#7f5122", "#7b730c", "#870d50", "#a44c0b", "#452483", "#2a3e55", "#000b74", "#9d0886", "#00a0f4", "#969696"],
    ["#000000", "#730202", "#00293a", "#02350f", "#572412", "#494500", "#6a043e", "#723305", "#2f1460", "#152232", "#000645", "#6c055b", "#c766c7", "#74c374"]
]

const TW2Map = function (containerSelector, dataLoader, tooltip) {
    const $container = document.querySelector(containerSelector)

    if (!$container || !$container.nodeName || $container.nodeName !== 'DIV') {
        throw new Error('Invalid map element')
    }

    let renderEnabled = false

    let villageSize = 4
    let villageMargin = 1
    let tileSize = villageSize + villageMargin

    const $viewport = document.createElement('canvas')
    const $viewportContext = $viewport.getContext('2d')

    const $cache = document.createElement('canvas')
    const $cacheContext = $cache.getContext('2d')

    const $overlay = document.createElement('canvas')
    const $overlayContext = $overlay.getContext('2d')

    const { x, y, width, height } = $container.getBoundingClientRect()
    let viewportWidth = width ? width : window.innerWidth
    let viewportHeight = height ? height : window.innerHeight
    let viewportOffsetX = x
    let viewportOffsetY = y

    const mapWidth = 1000 * tileSize
    const mapHeight = 1000 * tileSize

    let middleViewportOffsetX = Math.floor(viewportWidth / 2)
    let middleViewportOffsetY = Math.floor(viewportHeight / 2)

    let positionX = 500 * tileSize
    let positionY = 500 * tileSize

    let mouseCoordX = 0
    let mouseCoordY = 0

    let centerCoordX = 0
    let centerCoordY = 0

    let activeVillage = false

    const HIGHLIGHT_CATEGORIES = {
        players: 'players',
        tribes: 'tribes'
    }

    const highlights = {
        [HIGHLIGHT_CATEGORIES.players]: {},
        [HIGHLIGHT_CATEGORIES.tribes]: {}
    }

    let onAddHighlight = noop
    let onRemoveHighlight = noop
    let onUpdateHighlight = noop

    let onActiveVillage = noop
    let onInactiveVillage = noop

    let onCenterCoordsUpdate = noop

    const COLORS = {
        neutral: '#823c0a',
        barbarian: '#4c6f15',
        background: '#436213',
        highlightPlayer: '#ffffff',
        activeVillageBorder: 'rgba(255, 255, 255, 0.5)',
        continentDemarcation: 'rgba(0,0,0,0.15)',
        provinceDemarcation: 'rgba(0,0,0,0.05)'
    }

    const setupElements = function () {
        $container.style.position = 'relative'

        $viewport.width = viewportWidth
        $viewport.height = viewportHeight
        $overlay.width = viewportWidth
        $overlay.height = viewportHeight

        $viewport.classList.add('map')
        $overlay.classList.add('overlay')

        $viewport.style.position = 'absolute'
        $viewport.style.left = 0
        $viewport.style.top = 0

        $overlay.style.position = 'absolute'
        $overlay.style.cursor = 'default'
        $overlay.style.left = 0
        $overlay.style.top = 0

        $cache.width = mapWidth
        $cache.height = mapHeight

        $container.appendChild($viewport)
        $container.appendChild($overlay)
    }

    const mouseEvents = function () {
        let draggable = false
        let dragStartX = 0
        let dragStartY = 0

        $overlay.addEventListener('mousedown', function (event) {
            $overlayContext.clearRect(0, 0, viewportWidth, viewportHeight)
            draggable = true
            dragStartX = positionX + event.pageX
            dragStartY = positionY + event.pageY
            renderEnabled = true
            $overlay.style.cursor = 'move'
        })

        $overlay.addEventListener('mouseup', function () {
            draggable = false
            dragStartX = 0
            dragStartY = 0
            renderEnabled = false
            $overlay.style.cursor = 'default'
        })

        $overlay.addEventListener('mousemove', function (event) {
            if (draggable) {
                positionX = dragStartX - event.pageX
                positionY = dragStartY - event.pageY

                const currentCenterX = Math.floor(positionX / tileSize)
                const currentCenterY = Math.floor(positionY / tileSize)

                if (centerCoordX !== currentCenterX || centerCoordY !== currentCenterY) {
                    centerCoordX = currentCenterX
                    centerCoordY = currentCenterY

                    onCenterCoordsUpdate(centerCoordX, centerCoordY)
                }

                if (tooltip) {
                    tooltip.hide()
                }

                loadVisibleContinents()
            }
        })

        $overlay.addEventListener('mousemove', function (event) {
            if (draggable) {
                return
            }

            let off = Math.floor(event.pageY / tileSize) % 2 ? 0 : 2

            mouseCoordX = Math.floor((positionX - viewportOffsetX - middleViewportOffsetX + event.pageX - off) / tileSize)
            mouseCoordY = Math.floor((positionY - viewportOffsetY - middleViewportOffsetY + event.pageY) / tileSize)

            const villagesX = dataLoader.villages[mouseCoordX]

            if (villagesX) {
                const village = villagesX[mouseCoordY]

                if (village) {
                    return setActiveVillage(village)
                }
            }

            return unsetActiveVillage()
        })

        $overlay.addEventListener('mouseleave', function (event) {
            draggable = false
            dragStartX = 0
            dragStartY = 0
            renderEnabled = false
            $overlay.style.cursor = 'default'
            unsetActiveVillage()
        })
    }

    const setActiveVillage = function (village) {
        if (activeVillage && activeVillage.x === mouseCoordX && activeVillage.y === mouseCoordY) {
            return
        }

        const [id, name, points, character_id] = village

        activeVillage = {
            id,
            name,
            points,
            character_id,
            x: mouseCoordX,
            y: mouseCoordY
        }

        const player = dataLoader.players[character_id]
        const tribe = player ? dataLoader.tribes[player[1]] : false

        renderOverlay()
        onActiveVillage(activeVillage)
    }

    const unsetActiveVillage = function () {
        if (!activeVillage) {
            return
        }

        onInactiveVillage(activeVillage)
        activeVillage = false
        $overlayContext.clearRect(0, 0, viewportWidth, viewportHeight)
    }

    const loadVisibleContinents = function () {
        const visibleContinents = []

        let ax = boundNumber(((positionX - middleViewportOffsetX) / tileSize), 0, 999)
        let ay = boundNumber(((positionY - middleViewportOffsetY) / tileSize), 0, 999)
        let bx = boundNumber(((positionX + middleViewportOffsetX) / tileSize), 0, 999)
        let by = boundNumber(((positionY + middleViewportOffsetY) / tileSize), 0, 999)

        ax = ax < 100 ? 0 : String(ax)[0]
        ay = ay < 100 ? 0 : String(ay)[0]
        bx = bx < 100 ? 0 : String(bx)[0]
        by = by < 100 ? 0 : String(by)[0]

        for (let i = ax; i <= bx; i++) {
            for (let j = ay; j <= by; j++) {
                visibleContinents.push(parseInt('' + j + i, 10))
            }
        }

        visibleContinents.forEach(function (continent) {
            dataLoader.loadContinent(continent).then(villages => renderVillages(villages))
        })
    }

    const renderGrid = function () {
        $cacheContext.clearRect(0, 0, mapWidth, mapHeight)

        $cacheContext.fillStyle = COLORS.continentDemarcation

        $cacheContext.fillRect(0, 0, 1, mapWidth)
        $cacheContext.fillRect(0, 0, mapWidth, 1)

        for (let i = 1; i < 11; i++) {
            $cacheContext.fillRect(i * 100 * tileSize - 1, 0, 1, mapWidth)
            $cacheContext.fillRect(0, i * 100 * tileSize - 1, mapWidth, 1)
        }

        $cacheContext.fillStyle = COLORS.provinceDemarcation

        for (let i = 1; i < 100; i++) {
            $cacheContext.fillRect(i * 10 * tileSize - 1, 0, 1, mapWidth)
            $cacheContext.fillRect(0, i * 10 * tileSize - 1, mapWidth, 1)
        }
    }

    const renderVillages = function (villages) {
        for (let x in villages) {
            for (let y in villages[x]) {
                let [id, name, points, character_id] = villages[x][y]

                let tribeId = character_id ? dataLoader.players[character_id][1] : false

                if (!character_id) {
                    $cacheContext.fillStyle = COLORS.barbarian
                } else if (character_id in highlights.players) {
                    $cacheContext.fillStyle = highlights.players[character_id].color
                } else if (tribeId && tribeId in highlights.tribes) {
                    $cacheContext.fillStyle = highlights.tribes[tribeId].color
                } else {
                    $cacheContext.fillStyle = COLORS.neutral
                }

                let off = y % 2 ? 2 : 0

                $cacheContext.fillRect(x * tileSize + off, y * tileSize, villageSize, villageSize)
            }
        }

        renderViewport()
    }

    const renderViewport = function () {
        $viewportContext.fillStyle = COLORS.background
        $viewportContext.fillRect(0, 0, mapWidth, mapHeight)

        const positionXcenter = Math.floor(positionX - middleViewportOffsetX)
        const positionYcenter = Math.floor(positionY - middleViewportOffsetY)

        $viewportContext.drawImage($cache, -positionXcenter, -positionYcenter)
    }

    const renderOverlay = function () {
        $overlayContext.clearRect(0, 0, viewportWidth, viewportHeight)

        if (!activeVillage) {
            return
        }

        let off = activeVillage.y % 2 ? 2 : 0

        const borderX = Math.abs(positionX - (activeVillage.x * tileSize) - middleViewportOffsetX) - 1 + off
        const borderY = Math.abs(positionY - (activeVillage.y * tileSize) - middleViewportOffsetY) - 1
        const borderSize = villageSize + 2

        $overlayContext.fillStyle = COLORS.activeVillageBorder
        $overlayContext.fillRect(borderX, borderY - 1, borderSize, 1)
        $overlayContext.fillRect(borderX + borderSize, borderY, 1, borderSize)
        $overlayContext.fillRect(borderX, borderY + borderSize, borderSize, 1)
        $overlayContext.fillRect(borderX - 1, borderY, 1, borderSize)

        const characterId = activeVillage.character_id

        if (!characterId) {
            return
        }

        $overlayContext.fillStyle = COLORS.highlightPlayer

        for (let [x, y] of dataLoader.playerVillages[characterId]) {
            let off = y % 2 ? 2 : 0

            x = x * tileSize - positionX + middleViewportOffsetX + off
            y = y * tileSize - positionY + middleViewportOffsetY

            $overlayContext.fillRect(x, y, villageSize, villageSize)
        }
    }

    const continuousRender = function () {
        if (renderEnabled) {
            renderViewport()
        }

        requestAnimationFrame(continuousRender)
    }

    const formatVillagesToDraw = function (villagesId, scope) {
        if (villagesId) {
            for (let [x, y] of villagesId) {
                scope[x] = scope[x] || {}
                scope[x][y] = dataLoader.villages[x][y]
            }
        }
    }

    const highlightGetRealId = function (category, id) {
        const lowerId = id.toLowerCase()

        switch (category) {
            case HIGHLIGHT_CATEGORIES.players: {
                if (dataLoader.playersByName.hasOwnProperty(lowerId)) {
                    return dataLoader.playersByName[lowerId]
                } else {
                    throw new Error('Highlights: Player ' + id + ' not found')
                }

                break
            }
            case HIGHLIGHT_CATEGORIES.tribes: {
                if (dataLoader.tribesByTag.hasOwnProperty(lowerId)) {
                    return dataLoader.tribesByTag[lowerId]
                } else if (dataLoader.tribesByName.hasOwnProperty(lowerId)) {
                    return dataLoader.tribesByName[lowerId]
                } else {
                    throw new Error('Highlights: Tribe ' + id + ' not found')
                }

                break
            }
            default: {
                throw new Error('Highlights: Invalid category')
            }
        }
    }

    const getVillagesToDraw = function (category, realId) {
        let redrawVillages = {
            x: {}
        }

        switch (category) {
            case HIGHLIGHT_CATEGORIES.players: {
                formatVillagesToDraw(dataLoader.playerVillages[realId], redrawVillages)
                break
            }
            case HIGHLIGHT_CATEGORIES.tribes: {
                for (let playerId of dataLoader.tribePlayers[realId]) {
                    formatVillagesToDraw(dataLoader.playerVillages[playerId], redrawVillages)
                }

                break
            }
            default: {
                throw new Error('Highlights: Invalid category')
            }
        }

        return redrawVillages
    }

    this.recalcSize = function () {        
        const { width, height } = $container.getBoundingClientRect()
        viewportWidth = width ? width : window.innerWidth
        viewportHeight = height ? height : window.innerHeight

        middleViewportOffsetX = Math.floor(viewportWidth / 2)
        middleViewportOffsetY = Math.floor(viewportHeight / 2)

        $viewport.width = viewportWidth
        $viewport.height = viewportHeight
        $overlay.width = viewportWidth
        $overlay.height = viewportHeight

        loadVisibleContinents()
        renderViewport()
    }

    this.moveTo = function (x, y) {
        positionX = boundNumber(x, 0, 999) * tileSize
        positionY = boundNumber(y, 0, 999) * tileSize
        loadVisibleContinents()
        renderViewport()
    }

    this.getCoords = function () {
        return {
            x: Math.floor(positionX / tileSize),
            y: Math.floor(positionY / tileSize)
        }
    }

    this.addHighlight = function (category, id, color) {
        if (typeof id !== 'string') {
            throw new Error('Highlights: Invalid id')
        }

        if (!color) {
            color = arrayRandom(colorPalette.flat())
        }

        let realId
        let displayName

        try {
            realId = highlightGetRealId(category, id)
        } catch (error) {
            return console.log(error)
        }

        const redrawVillages = getVillagesToDraw(category, realId)

        switch (category) {
            case HIGHLIGHT_CATEGORIES.tribes: {
                const [name, tag] = dataLoader.tribes[realId]
                displayName = tag + ' (' + name + ')'
                break
            }
            case HIGHLIGHT_CATEGORIES.players: {
                const [name] = dataLoader.players[realId]
                displayName = name
                break
            }
        }

        if (highlights[category].hasOwnProperty(realId)) {
            onUpdateHighlight(category, id, displayName, color)
        } else {
            onAddHighlight(category, id, displayName, color)
        }

        highlights[category][realId] = {
            display: displayName,
            color: color
        }

        renderVillages(redrawVillages)
    }

    this.removeHighlight = function (category, id) {
        if (typeof id !== 'string') {
            throw new Error('Highlights: Invalid id')
        }

        let realId

        try {
            realId = highlightGetRealId(category, id)
        } catch (error) {
            return console.log(error)
        }

        const redrawVillages = getVillagesToDraw(category, realId)

        delete highlights[category][realId]

        onRemoveHighlight(category, id)
        renderVillages(redrawVillages)
    }

    this.onAddHighlight = function (fn) {
        if (typeof fn === 'function') {
            onAddHighlight = fn
        }
    }

    this.onRemoveHighlight = function (fn) {
        if (typeof fn === 'function') {
            onRemoveHighlight = fn
        }
    }

    this.onUpdateHighlight = function (fn) {
        if (typeof fn === 'function') {
            onUpdateHighlight = fn
        }
    }

    this.onActiveVillage = function (fn) {
        if (typeof fn === 'function') {
            onActiveVillage = fn
        }
    }

    this.onInactiveVillage = function (fn) {
        if (typeof fn === 'function') {
            onInactiveVillage = fn
        }
    }

    this.onCenterCoordsUpdate = function (fn) {
        if (typeof fn === 'function') {
            onCenterCoordsUpdate = fn
        }
    }

    setupElements()
    mouseEvents()
    renderGrid()

    Promise.all([
        dataLoader.loadPlayers,
        dataLoader.loadTribes
    ]).then(function () {
        loadVisibleContinents()
        continuousRender()
    })

    if (tooltip) {
        this.onActiveVillage(function (village) {
            const {
                id,
                name: villageName,
                points: villagePoints,
                character_id: villageCharacterId,
                x: villageX,
                y: villageY
            } = village

            let playerName
            let tribeId
            let playerPoints
            let tribe
            let tribeName
            let tribeTag
            let tribePoints

            if (villageCharacterId) {
                ([ playerName, tribeId, playerPoints ] = dataLoader.players[villageCharacterId])

                if (tribeId) {
                    ([ tribeName, tribeTag, tribePoints ] = dataLoader.tribes[tribeId])
                }
            }

            tooltip.set({
                villageName,
                villageX,
                villageY,
                villagePoints,
                playerName,
                playerPoints,
                tribeName,
                tribeTag,
                tribePoints
            })

            tooltip.show()
        })

        this.onInactiveVillage(function (village) {
            tooltip.hide()
        })
    }
}

const DataLoader = function (marketId, worldNumber) {
    const self = this
    let continentPromises = {}

    this.players = {}
    this.playersByName = {}
    this.playerVillages = {}
    this.tribes = {}
    this.tribesByTag = {}
    this.tribesByName = {}
    this.tribePlayers = {}
    this.continents = {}
    this.villages = {}
    this.villages.x = {}

    const mergeVillages = function (villages) {
        for (let x in villages) {
            for (let y in villages[x]) {
                if (x in self.villages) {
                    self.villages[x][y] = villages[x][y]
                } else {
                    self.villages[x] = {}
                    self.villages[x][y] = villages[x][y]
                }

                let village = self.villages[x][y]
                let character_id = village[3]

                if (character_id) {
                    if (character_id in self.playerVillages) {
                        self.playerVillages[character_id].push([x, y])
                    } else {
                        self.playerVillages[character_id] = [[x, y]]
                    }
                }
            }
        }
    }

    this.loadPlayers = new Promise(async function (resolve) {
        const players = await fetch(`/maps/api/${marketId}/${worldNumber}/players`)
        self.players = await players.json()

        for (let id in self.players) {
            let [name, tribeId, points] = self.players[id]
            self.playersByName[name.toLowerCase()] = parseInt(id, 10)

            if (tribeId) {
                self.tribePlayers[tribeId] = self.tribePlayers[tribeId] || []
                self.tribePlayers[tribeId].push(parseInt(id, 10))
            }
        }

        resolve()
    })

    this.loadTribes = new Promise(async function (resolve) {
        const tribes = await fetch(`/maps/api/${marketId}/${worldNumber}/tribes`)
        self.tribes = await tribes.json()

        for (let id in self.tribes) {
            let [name, tag, points] = self.tribes[id]
            self.tribesByName[name.toLowerCase()] = parseInt(id, 10)
            self.tribesByTag[tag.toLowerCase()] = parseInt(id, 10)
        }

        resolve()
    })

    this.loadContinent = function (continent) {
        if (typeof continent !== 'number' || continent < 0 || continent > 99) {
            throw new Error('Invalid continent value')
        }

        if (continentPromises.hasOwnProperty(continent)) {
            return continentPromises[continent]
        }

        continentPromises[continent] = new Promise(async function (resolve) {
            const load = await fetch(`/maps/api/${marketId}/${worldNumber}/continent/${continent}`)
            const villages = await load.json()
            self.continents[continent] = villages
            mergeVillages(villages)
            resolve(villages)
        })

        return continentPromises[continent]
    }
}

const TW2MapTooltip = function (selector) {
    const $tooltip = document.querySelector(selector)

    if (!$tooltip || !$tooltip.nodeName || $tooltip.nodeName !== 'DIV') {
        throw new Error('Invalid tooltip element')
    }

    const mouseDistance = 30

    let $map
    let visible = false

    $tooltip.style.visibility = 'hidden'
    $tooltip.style.opacity = 0

    let $villageName = $tooltip.querySelector('.village-name')
    let $villageX = $tooltip.querySelector('.village-x')
    let $villageY = $tooltip.querySelector('.village-y')
    let $villagePoints = $tooltip.querySelector('.village-points')
    let $playerName = $tooltip.querySelector('.player-name')
    let $playerPoints = $tooltip.querySelector('.player-points')
    let $tribeName = $tooltip.querySelector('.tribe-name')
    let $tribeTag = $tooltip.querySelector('.tribe-tag')
    let $tribePoints = $tooltip.querySelector('.tribe-points')

    const mouseMoveHandler = function (event) {
        let x = event.pageX
        let y = event.pageY

        if (x + 400 > window.innerWidth) {
            x -= 370
            x -= mouseDistance
        } else {
            x += mouseDistance
        }

        if (y + 140 > window.innerHeight) {
            y -= 110
            y -= mouseDistance
        } else {
            y += mouseDistance
        }

        $tooltip.style.transform = 'translate3d(' + x + 'px, ' + y + 'px, 0px)'
    }

    const setEvents = function () {
        window.addEventListener('mousemove', mouseMoveHandler)
    }

    const unsetEvents = function () {
        window.removeEventListener('mousemove', mouseMoveHandler)
    }

    this.set = function ({
        villageName,
        villageX,
        villageY,
        villagePoints,
        playerName,
        playerPoints,
        tribeName,
        tribeTag,
        tribePoints
    }) {
        $villageName.innerHTML = villageName
        $villageX.innerHTML = villageX
        $villageY.innerHTML = villageY
        $villagePoints.innerHTML = villagePoints.toLocaleString('pt-BR')
        $playerName.innerHTML = playerName || '-'
        $playerPoints.innerHTML = playerPoints ? playerPoints.toLocaleString('pt-BR') : 0
        $tribeName.innerHTML = tribeName || '-'
        $tribeTag.innerHTML = tribeTag || '-'
        $tribePoints.innerHTML = tribePoints ? tribePoints.toLocaleString('pt-BR') : 0
    }

    this.show = function () {
        setEvents()
        $tooltip.style.visibility = 'visible'
        $tooltip.style.opacity = 1
        visible = true
    }

    this.hide = function () {
        unsetEvents()
        $tooltip.style.visibility = 'hidden'
        $tooltip.style.opacity = 0
        visible = false
    }
}

const generateColorPicker = function () {
    const $colorPicker = document.querySelector('#color-picker')
    const $colorPickerTable = $colorPicker.querySelector('table')

    for (let colorsRow of colorPalette) {
        const $row = document.createElement('tr')

        for (let color of colorsRow) {
            const $wrapper = document.createElement('td')
            const $color = document.createElement('div')
            $color.className = 'color'
            $color.style.background = color
            $color.dataset.color = color
            $wrapper.appendChild($color)
            $row.appendChild($wrapper)
        }

        $colorPickerTable.appendChild($row)
    }

    return [$colorPicker, $colorPicker.querySelectorAll('div')]
}

{
    const dataLoader = new DataLoader(marketId, worldNumber)
    const tooltip = new TW2MapTooltip('#tooltip')
    const map = new TW2Map('#map', dataLoader, tooltip)

    let resizeTimeout
    window.addEventListener('resize', function () {
        clearTimeout(resizeTimeout)
        resizeTimeout = setTimeout(() => map.recalcSize(), 200)
    })

    const $highlightId = document.getElementById('highlight-id')
    const $highlightItems = document.getElementById('highlight-items')

    const ac = new autoComplete({
        data: {
            src: async function () {
                await dataLoader.loadPlayers
                await dataLoader.loadTribes

                const matches = []

                for (let [name] of Object.values(dataLoader.players)) {
                    matches.push({
                        search: name,
                        id: name,
                        type: 'players'
                    })
                }

                for (let [name, tag] of Object.values(dataLoader.tribes)) {
                    matches.push({
                        search: tag + ' (' + name + ')',
                        id: tag,
                        type: 'tribes'
                    })
                }

                return matches
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
        sort: function (a, b) {
            if (a.match < b.match) return -1
            if (a.match > b.match) return 1
            return 0
        },
        noResults: function () {
            const $item = document.createElement('li')
            $item.innerHTML = 'no results'
            ac.resultsList.view.appendChild($item)
        },
        highlight: true,
        onSelection: function (feedback) {
            const { search, id, type } = feedback.selection.value
            const color = arrayRandom(colorPalette.flat())

            map.addHighlight(type, id, color)
            $highlightId.value = ''
        }
    })

    $highlightId.addEventListener('blur', function () {
        ac.resultsList.view.style.display = 'none'
    })

    $highlightId.addEventListener('focus', function () {
        ac.resultsList.view.style.display = ''
    })

    $highlightId.addEventListener('keydown', async function (event) {
        if (event.key === 'Escape') {
            $highlightId.value = ''
            $highlightId.dispatchEvent(new Event('input'))
        }
    })

    $highlightId.addEventListener('autoComplete', function ({ detail }) {
        if (detail.event.key == 'Enter' && detail.matches > 0) {
            ac.listMatchedResults(ac.dataStream).then(function () {
                const first = ac.resultsList.view.children.item(0)
                first.dispatchEvent(new Event('mousedown'))
            })
        }
    })

    map.onAddHighlight(function (category, id, displayName, color) {
        const $item = document.createElement('li')
        const $name = document.createElement('div')
        const $nameSpan = document.createElement('span')
        const $color = document.createElement('div')
        
        $item.classList.add('highlight-' + normalizeString(id))
        $item.classList.add('item')
        $item.dataset.category = category
        $item.dataset.id = id
        $item.dataset.color = color

        $name.addEventListener('click', function () {
            map.removeHighlight(category, id)
        })

        $name.className = 'name'

        $nameSpan.innerHTML = displayName
        $nameSpan.className = category

        $color.className = 'color open-color-picker'
        $color.style.backgroundColor = color
        $color.dataset.color = color

        $color.addEventListener('click', function () {
            colorPicker($color, $color.dataset.color, function (pickedColor) {
                $color.dataset.color = pickedColor
                map.addHighlight(category, id, pickedColor)
            })
        })

        $name.appendChild($nameSpan)
        $item.appendChild($name)
        $item.appendChild($color)
        $highlightItems.appendChild($item)
    })

    map.onUpdateHighlight(function (category, id, displayName, color) {
        const $item = $highlightItems.querySelector('.highlight-' + normalizeString(id))

        if (!$item) {
            return false
        }

        const $color = $item.querySelector('.color')

        $color.style.background = color
        $item.dataset.color = color
    })

    map.onRemoveHighlight(function (category, id) {
        const $item = $highlightItems.querySelector('.highlight-' + normalizeString(id))

        if ($item) {
            $item.remove()
        }
    })

    const [$colorPicker, $colors] = generateColorPicker()

    let activeColorPicker = false

    const colorPicker = function ($reference, selectedColor, callback) {
        if (!$reference) {
            throw new Error('Color Picker: Invalid reference element')
        }

        if (activeColorPicker) {
            $colorPicker.removeEventListener('click', activeColorPicker)
        }

        for (let $color of $colors) {
            if ($color.classList.contains('active')) {
                $color.classList.remove('active')
                break
            }
        }

        let { x, y, width, height } = $reference.getBoundingClientRect()

        x = Math.floor(x + width + 5)
        y = Math.floor(y + height + 5)

        $colorPicker.style.visibility = 'visible'
        $colorPicker.style.opacity = 1
        $colorPicker.style.transform = 'translate3d(' + x + 'px, ' + y + 'px, 0px)'

        const index = colorPalette.flat().indexOf(selectedColor)

        if (index !== -1) {
            $colors[index].classList.add('active')
        }

        $colorPicker.style.visibility = 'visible'
        $colorPicker.style.opacity = 1

        setTimeout(function () {
            activeColorPicker = function (event) {
                if (event.target.classList.contains('color')) {
                    callback(event.target.dataset.color)
                    closeColorPicker()
                }
            }

            $colorPicker.addEventListener('click', activeColorPicker)
        }, 25)
    }

    const closeColorPicker = function () {
        $colorPicker.removeEventListener('click', activeColorPicker)
        $colorPicker.style.visibility = 'hidden'
        $colorPicker.style.opacity = 0
        activeColorPicker = false
    }

    window.addEventListener('click', function (event) {
        if (!activeColorPicker || event.target.classList.contains('open-color-picker')) {
            return
        }

        if (!event.target.closest('#color-picker')) {
            closeColorPicker()
        }
    })

    const $lastSync = document.querySelector('#last-sync-date')
    const lastSyncDate = lastSync ? new Date(lastSync).toLocaleString('pt-BR') : 'never'

    $lastSync.innerHTML = lastSyncDate

    const $centerCoordsX = document.querySelector('#center-coords-x')
    const $centerCoordsY = document.querySelector('#center-coords-y')

    map.onCenterCoordsUpdate(function (x, y) {
        $centerCoordsX.innerHTML = x
        $centerCoordsY.innerHTML = y
    })

    if (development && marketId === 'br' && worldNumber === 48) {
        Promise.all([dataLoader.loadTribes, dataLoader.loadPlayers]).then(function () {
            map.addHighlight('tribes', 'OUT', '#0111af')
            map.addHighlight('players', 'she-ra', '#e21f1f')
        })
    }
}

