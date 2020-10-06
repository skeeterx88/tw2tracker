const colorPalette = [
    ["#ffffff", "#FF0000", "#97FF00", "#00FF41", "#FF8000", "#fff9a1", "#FF008A", "#ffd5b6", "#5800FF", "#0075FF", "#00FFE1", "#A400FF", "#f0c800", "#ff4b4b"],
    ["#dfdfdf", "#D83333", "#03709d", "#0a8028", "#aa6b2b", "#ffee00", "#b2146b", "#d96a19", "#5c32a9", "#47617f", "#0111af", "#d315b6", "#8888fc", "#ce8856"],
    ["#e0ff4c", "#980e0e", "#014a69", "#04571a", "#7f5122", "#7b730c", "#870d50", "#a44c0b", "#452483", "#2a3e55", "#000b74", "#9d0886", "#00a0f4", "#969696"],
    ["#000000", "#730202", "#00293a", "#02350f", "#572412", "#494500", "#6a043e", "#723305", "#2f1460", "#152232", "#000645", "#6c055b", "#c766c7", "#00FF83"]
]

const TW2Map = function (containerSelector, loader, tooltip, settings) {
    const $container = document.querySelector(containerSelector)

    if (!$container || !$container.nodeName || $container.nodeName !== 'DIV') {
        throw new Error('Invalid map element')
    }

    settings = {
        ...{
            hexagonVillages: false,
            zoomLevel: 2
        },
        ...settings
    }

    const MAP_SIZE = 1000
    const TILE_COUNT = Math.pow(MAP_SIZE, 2)
    const BITS_IN_TILE = 5
    const BITS_IN_TILE_PER_BYTE = BITS_IN_TILE / 8

    let renderEnabled = false

    const $viewport = document.createElement('canvas')
    const $viewportContext = $viewport.getContext('2d')

    let $cache
    let $cacheContext

    let $grid
    let $gridContext

    const $overlay = document.createElement('canvas')
    const $overlayContext = $overlay.getContext('2d')

    const { x, y, width, height } = $container.getBoundingClientRect()
    let viewportWidth = width ? width : window.innerWidth
    let viewportHeight = height ? height : window.innerHeight
    let viewportOffsetX = x
    let viewportOffsetY = y

    let middleViewportOffsetX = Math.floor(viewportWidth / 2)
    let middleViewportOffsetY = Math.floor(viewportHeight / 2)

    let zoomSettings
    const zoomCache = {}

    const zoomLevels = [{
        villageSize: 1,
        drawProvinces: false,
        drawContinents: true,
        villageMargin: 0,
        villageOffset: 0,
        hexagonShape: false,
        activeVillageBorder: false,
        continentOpacity: '20'
    }, {
        villageSize: 2,
        drawProvinces: false,
        drawContinents: true,
        villageMargin: 1,
        villageOffset: 0,
        hexagonShape: false,
        activeVillageBorder: false,
        continentOpacity: '40'
    }, {
        villageSize: 3,
        drawProvinces: true,
        drawContinents: true,
        villageMargin: 1,
        villageOffset: 2,
        hexagonShape: false,
        activeVillageBorder: true,
        continentOpacity: '80',
        provinceOpacity: '45'
    }, {
        villageSize: 5,
        drawProvinces: true,
        drawContinents: true,
        villageMargin: 1,
        villageOffset: 3,
        hexagonShape: true,
        activeVillageBorder: true,
        continentOpacity: '95',
        provinceOpacity: '60'
    }]

    let positionX
    let positionY

    let mouseCoordX = 0
    let mouseCoordY = 0

    let centerCoordX = 0
    let centerCoordY = 0

    let activeVillage = false

    const borderOffsets = [
        {x: -1, y: 0},
        {x: -1, y: -1},
        {x: +1, y: -1},
        {x: +1, y: 0},
        {x: +1, y: +1},
        {x: -1, y: +1}
    ]

    const events = {}

    const renderedZoomContinents = []
    const renderedZoomGrid = []

    for (let i = 0; i < zoomLevels.length; i++) {
        renderedZoomContinents.push({})
        renderedZoomGrid.push({})
    }

    const HIGHLIGHT_CATEGORIES = {
        players: 'players',
        tribes: 'tribes'
    }

    const highlights = {
        [HIGHLIGHT_CATEGORIES.players]: {},
        [HIGHLIGHT_CATEGORIES.tribes]: {}
    }

    const COLORS = {
        neutral: '#823C0A',
        barbarian: '#4C6F15',
        background: '#436213',
        highlightPlayer: '#FFFFFF',
        activeVillageBorder: '#FFFFFF80',
        demarcations: '#000000'
    }

    const setupZoom = function () {
        zoomSettings = zoomLevels[settings.zoomLevel]

        zoomSettings.tileSize = zoomSettings.villageSize + zoomSettings.villageMargin
        zoomSettings.mapWidth = 1000 * zoomSettings.tileSize
        zoomSettings.mapHeight = 1000 * zoomSettings.tileSize

        if (!zoomCache.hasOwnProperty(settings.zoomLevel)) {
            $cache = document.createElement('canvas')
            $cacheContext = $cache.getContext('2d')

            $grid = document.createElement('canvas')
            $gridContext = $grid.getContext('2d')

            $cache.width = zoomSettings.mapWidth
            $cache.height = zoomSettings.mapHeight

            $grid.width = zoomSettings.mapWidth
            $grid.height = zoomSettings.mapHeight

            zoomCache[settings.zoomLevel] = {
                $cache,
                $cacheContext,
                $grid,
                $gridContext
            }
        } else {
            ({
                $cache,
                $cacheContext,
                $grid,
                $gridContext
            } = zoomCache[settings.zoomLevel])
        }
    }

    const setupElements = () => {
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

        $container.appendChild($viewport)
        $container.appendChild($overlay)
    }

    const mouseEvents = () => {
        let draggable = false
        let dragging = false
        let dragStartX = 0
        let dragStartY = 0

        $overlay.addEventListener('mousedown', (event) => {
            draggable = true
            dragStartX = positionX + event.pageX
            dragStartY = positionY + event.pageY
        })

        $overlay.addEventListener('mouseup', () => {
            draggable = false

            if (!dragging) {
                this.trigger('click', [activeVillage])
            }

            dragging = false
            dragStartX = 0
            dragStartY = 0
            renderEnabled = false
            $overlay.style.cursor = 'default'

            renderViewport()
        })

        $overlay.addEventListener('mousemove', (event) => {
            if (draggable) {
                if (!dragging) {
                    clearOverlay()
                    renderEnabled = true
                    $overlay.style.cursor = 'move'
                }

                dragging = true

                positionX = boundNumber(dragStartX - event.pageX, 0, zoomSettings.mapWidth)
                positionY = boundNumber(dragStartY - event.pageY, 0, zoomSettings.mapHeight)

                updateCenter()

                if (tooltip) {
                    tooltip.hide()
                }

                renderVisibleDemarcations()
                renderVisibleContinents()
            }
        })

        $overlay.addEventListener('mousemove', (event) => {
            if (draggable) {
                return
            }

            mouseCoordY = Math.floor((positionY - viewportOffsetY - middleViewportOffsetY + event.pageY) / zoomSettings.tileSize)
            let off = mouseCoordY % 2 ? zoomSettings.villageOffset : 0
            mouseCoordX = Math.floor((positionX - viewportOffsetX - middleViewportOffsetX + event.pageX - off) / zoomSettings.tileSize)

            const villagesX = loader.villages[mouseCoordX]

            if (villagesX) {
                const village = villagesX[mouseCoordY]

                if (village) {
                    return setActiveVillage(village)
                }
            }

            return unsetActiveVillage()
        })

        $overlay.addEventListener('mouseleave', (event) => {
            draggable = false
            dragStartX = 0
            dragStartY = 0
            renderEnabled = false
            $overlay.style.cursor = 'default'
            unsetActiveVillage()
        })

        $overlay.addEventListener('wheel', (event) => {
            let newZoom = false

            if (event.deltaY < 0 && zoomLevels[settings.zoomLevel + 1]) {
                newZoom = settings.zoomLevel + 1
            } else if (event.deltaY > 0 && zoomLevels[settings.zoomLevel - 1]) {
                newZoom = settings.zoomLevel - 1
            }

            if (newZoom !== false) {
                settings.zoomLevel = newZoom

                const currentCenterX = Math.floor(positionX / zoomSettings.tileSize)
                const currentCenterY = Math.floor(positionY / zoomSettings.tileSize)

                setupZoom()
                renderVisibleDemarcations()
                renderVisibleContinents()
                renderViewport()

                this.moveTo(currentCenterX, currentCenterY)
            }
        })
    }

    const setActiveVillage = (village) => {
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

        const player = loader.players[character_id]
        const tribe = player ? loader.tribes[player[1]] : false

        renderOverlay()
        this.trigger('active village', [activeVillage])
    }

    const unsetActiveVillage = () => {
        if (!activeVillage) {
            return
        }

        this.trigger('inactive village', [activeVillage])
        activeVillage = false
        clearOverlay()
    }

    const getVisibleContinents = () => {
        const visibleContinents = []

        let ax = boundNumber(((positionX - middleViewportOffsetX) / zoomSettings.tileSize), 0, 999)
        let ay = boundNumber(((positionY - middleViewportOffsetY) / zoomSettings.tileSize), 0, 999)
        let bx = boundNumber(((positionX + middleViewportOffsetX) / zoomSettings.tileSize), 0, 999)
        let by = boundNumber(((positionY + middleViewportOffsetY) / zoomSettings.tileSize), 0, 999)

        ax = ax < 100 ? 0 : String(ax)[0]
        ay = ay < 100 ? 0 : String(ay)[0]
        bx = bx < 100 ? 0 : String(bx)[0]
        by = by < 100 ? 0 : String(by)[0]

        for (let i = ax; i <= bx; i++) {
            for (let j = ay; j <= by; j++) {
                visibleContinents.push(parseInt('' + j + i, 10))
            }
        }

        return visibleContinents
    }

    const renderVisibleContinents = () => {
        getVisibleContinents()
        .filter((continent) => !renderedZoomContinents[settings.zoomLevel].hasOwnProperty(continent))
        .forEach((continent) => {
            loader.loadContinent(continent).then(villages => {
                renderedZoomContinents[settings.zoomLevel][continent] = true
                renderVillages(villages)
                renderViewport()
            })
        })
    }

    const updateCenter = () => {
        const currentCenterX = Math.floor(positionX / zoomSettings.tileSize)
        const currentCenterY = Math.floor(positionY / zoomSettings.tileSize)

        if (centerCoordX !== currentCenterX || centerCoordY !== currentCenterY) {
            centerCoordX = currentCenterX
            centerCoordY = currentCenterY

            this.trigger('center coords update', [centerCoordX, centerCoordY])
        }
    }

    const renderVisibleDemarcations = () => {
        if (!zoomSettings.drawContinents && !zoomSettings.drawProvinces) {
            return
        }

        const visibleContinents = getVisibleContinents()
        const nonRenderedContinents = visibleContinents.filter((k) => !renderedZoomGrid[settings.zoomLevel].hasOwnProperty(k))

        for (let k of nonRenderedContinents) {
            k = String(k)
            const startX = k < 10 ? k * 100 : k[1] * 100
            const startY = k < 10 ? 0 : k[0] * 100
            const endX = startX + 100
            const endY = startY + 100

            for (let x = startX; x < endX; x++) {
                for (let y = startY; y < endY; y++) {
                    
                    const tilePos = y + MAP_SIZE * x
                    const fiveBits = readBitsAt(loader.struct, tilePos)

                    // has border
                    if (fiveBits >>> 4) {
                        const isContinentBorder = (fiveBits >> 3) & 1

                        if (isContinentBorder) {
                            if (zoomSettings.drawContinents) {
                                $gridContext.fillStyle = COLORS.demarcations + (zoomSettings.continentOpacity ? zoomSettings.continentOpacity : '')
                            } else {
                                $gridContext.fillStyle = COLORS.demarcations + (zoomSettings.provinceOpacity ? zoomSettings.provinceOpacity : '')
                            }
                        } else {
                            if (zoomSettings.drawProvinces) {
                                $gridContext.fillStyle = COLORS.demarcations + (zoomSettings.provinceOpacity ? zoomSettings.provinceOpacity : '')
                            } else {
                                continue
                            }
                        }

                        const borders = getRowNeighbourTilePosition(x, y)

                        for (let i = 0; i < 6; i++) {
                            const neighbourTile = readBitsAt(loader.struct, borders[i])

                            if (neighbourTile >>> 4) {
                                $gridContext.fillRect(x * zoomSettings.tileSize + borderOffsets[i].x, y * zoomSettings.tileSize + borderOffsets[i].y, 1, 1)
                            }
                        }

                        $gridContext.fillRect(x * zoomSettings.tileSize, y * zoomSettings.tileSize, 1, 1)
                    }
                }
            }

            renderedZoomGrid[settings.zoomLevel][k] = true
        }
    }

    const readBitsAt = (view, tilePos) => {
        if (tilePos < 0 || tilePos >= TILE_COUNT) {
            return;
        }

        var bytePosInSegment    = tilePos % 8,
            byteOffset          = (tilePos - bytePosInSegment) * BITS_IN_TILE_PER_BYTE,
            result;

        switch (bytePosInSegment) {

        case 0:
            result = (view.getUint8(byteOffset) >> 3);
            break;
        case 1:
            result = ((view.getUint8(byteOffset) << 2) + (view.getUint8(byteOffset + 1) >> 6));
            break;
        case 2:
            result = view.getUint8(byteOffset + 1) >> 1;
            break;
        case 3:
            result = ((view.getUint8(byteOffset + 1) << 4) + (view.getUint8(byteOffset + 2) >> 4));
            break;
        case 4:
            result = ((view.getUint8(byteOffset + 2) << 1) + (view.getUint8(byteOffset + 3) >> 7));
            break;
        case 5:
            result = (view.getUint8(byteOffset + 3) >> 2);
            break;
        case 6:
            result = ((view.getUint8(byteOffset + 3) << 3) + (view.getUint8(byteOffset + 4) >> 5));
            break;
        case 7:
            result = view.getUint8(byteOffset + 4);
            break;
        }

        // As every tile exists from out of 5 bits, after swtich break to make sure
        // the result read will be surely relevant to that 5 bit, we bitwise and it
        // with 00011111 (31)
        return result & 31;
    }

    const getRowNeighbourTilePosition = (x, y) => {
        return y & 1 ? [
            (MAP_SIZE * (x - 1)) + y,
            (MAP_SIZE * x) + y - 1,
            (MAP_SIZE * (x + 1)) + y - 1,
            (MAP_SIZE * (x + 1)) + y,
            (MAP_SIZE * (x + 1)) + y + 1,
            (MAP_SIZE * x) + y + 1
        ] : [
            (MAP_SIZE * (x - 1)) + y,
            (MAP_SIZE * (x - 1)) + y - 1,
            (MAP_SIZE * x) + y - 1,
            (MAP_SIZE * (x + 1)) + y,
            (MAP_SIZE * x) + y + 1,
            (MAP_SIZE * (x - 1)) + y + 1
        ];
    }

    const renderVillages = (villages, context = $cacheContext, zoomSettings = zoomLevels[settings.zoomLevel]) => {
        for (let x in villages) {
            for (let y in villages[x]) {
                let [id, name, points, character_id] = villages[x][y]

                let tribeId = character_id ? loader.players[character_id][1] : false

                if (!character_id) {
                    context.fillStyle = COLORS.barbarian
                } else if (character_id in highlights.players) {
                    context.fillStyle = highlights.players[character_id].color
                } else if (tribeId && tribeId in highlights.tribes) {
                    context.fillStyle = highlights.tribes[tribeId].color
                } else {
                    context.fillStyle = COLORS.neutral
                }

                let off = y % 2 ? zoomSettings.villageOffset : 0

                if (zoomSettings.hexagonShape && settings.hexagonVillages) {
                    context.fillRect(x * zoomSettings.tileSize + off + 1, y * zoomSettings.tileSize, 3, 1)
                    context.fillRect(x * zoomSettings.tileSize + off    , y * zoomSettings.tileSize + 1, 5, 1)
                    context.fillRect(x * zoomSettings.tileSize + off    , y * zoomSettings.tileSize + 2, 5, 1)
                    context.fillRect(x * zoomSettings.tileSize + off    , y * zoomSettings.tileSize + 3, 5, 1)
                    context.fillRect(x * zoomSettings.tileSize + off + 1, y * zoomSettings.tileSize + 4, 3, 1)
                } else {
                    context.fillRect(x * zoomSettings.tileSize + off, y * zoomSettings.tileSize, zoomSettings.villageSize, zoomSettings.villageSize)
                }
            }
        }
    }

    const renderViewport = () => {
        $viewportContext.clearRect(0, 0, $viewport.width, $viewport.height)

        const positionXcenter = Math.floor(positionX - middleViewportOffsetX)
        const positionYcenter = Math.floor(positionY - middleViewportOffsetY)

        $viewportContext.drawImage($grid, -positionXcenter, -positionYcenter)
        $viewportContext.drawImage($cache, -positionXcenter, -positionYcenter)
    }

    const renderOverlay = () => {
        clearOverlay()

        if (!activeVillage) {
            return
        }

        if (zoomSettings.activeVillageBorder) {
            $overlayContext.fillStyle = COLORS.activeVillageBorder

            let off = activeVillage.y % 2 ? zoomSettings.villageOffset : 0

            const borderX = Math.abs(positionX - (activeVillage.x * zoomSettings.tileSize) - middleViewportOffsetX) - 1 + off
            const borderY = Math.abs(positionY - (activeVillage.y * zoomSettings.tileSize) - middleViewportOffsetY) - 1
            const borderSize = zoomSettings.villageSize + 2

            if (zoomSettings.hexagonShape && settings.hexagonVillages) {
                $overlayContext.fillRect(borderX + 1, borderY - 1, 5, 1)
                $overlayContext.fillRect(borderX    , borderY    , 1, 1)
                $overlayContext.fillRect(borderX + 6, borderY    , 1, 1)
                $overlayContext.fillRect(borderX - 1, borderY + 1, 1, 5)
                $overlayContext.fillRect(borderX + 7, borderY + 1, 1, 5)
                $overlayContext.fillRect(borderX    , borderY + 6, 1, 1)
                $overlayContext.fillRect(borderX + 6, borderY + 6, 1, 1)
                $overlayContext.fillRect(borderX + 1, borderY + 7, 5, 1)
            } else {
                $overlayContext.fillRect(borderX, borderY - 1, borderSize, 1)
                $overlayContext.fillRect(borderX + borderSize, borderY, 1, borderSize)
                $overlayContext.fillRect(borderX, borderY + borderSize, borderSize, 1)
                $overlayContext.fillRect(borderX - 1, borderY, 1, borderSize)
            }
        }

        const characterId = activeVillage.character_id

        if (!characterId) {
            return
        }

        $overlayContext.fillStyle = COLORS.highlightPlayer

        for (let [x, y] of loader.playerVillages[characterId]) {
            let off = y % 2 ? zoomSettings.villageOffset : 0

            x = x * zoomSettings.tileSize - positionX + middleViewportOffsetX + off
            y = y * zoomSettings.tileSize - positionY + middleViewportOffsetY

            if (zoomSettings.hexagonShape && settings.hexagonVillages) {
                $overlayContext.fillRect(x + 1, y, 3, 1)
                $overlayContext.fillRect(x    , y + 1, 5, 1)
                $overlayContext.fillRect(x    , y + 2, 5, 1)
                $overlayContext.fillRect(x    , y + 3, 5, 1)
                $overlayContext.fillRect(x + 1, y + 4, 3, 1)
            } else {
                $overlayContext.fillRect(x, y, zoomSettings.villageSize, zoomSettings.villageSize)
            }
        }
    }

    const clearOverlay = function () {
        $overlayContext.clearRect(0, 0, viewportWidth, viewportHeight)
    }

    const continuousRender = () => {
        if (renderEnabled) {
            renderViewport()
        }

        requestAnimationFrame(continuousRender)
    }

    const formatVillagesToDraw = (villagesId, scope) => {
        if (villagesId) {
            for (let [x, y] of villagesId) {
                scope[x] = scope[x] || {}
                scope[x][y] = loader.villages[x][y]
            }
        }
    }

    const highlightGetRealId = (category, id) => {
        const lowerId = id.toLowerCase()

        switch (category) {
            case HIGHLIGHT_CATEGORIES.players: {
                if (loader.playersByName.hasOwnProperty(lowerId)) {
                    return loader.playersByName[lowerId]
                } else {
                    throw new Error('Highlights: Player ' + id + ' not found')
                }

                break
            }
            case HIGHLIGHT_CATEGORIES.tribes: {
                if (loader.tribesByTag.hasOwnProperty(lowerId)) {
                    return loader.tribesByTag[lowerId]
                } else if (loader.tribesByName.hasOwnProperty(lowerId)) {
                    return loader.tribesByName[lowerId]
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

    const getVillagesToDraw = (category, realId) => {
        let redrawVillages = {
            x: {}
        }

        switch (category) {
            case HIGHLIGHT_CATEGORIES.players: {
                formatVillagesToDraw(loader.playerVillages[realId], redrawVillages)
                break
            }
            case HIGHLIGHT_CATEGORIES.tribes: {
                for (let playerId of loader.tribePlayers[realId]) {
                    formatVillagesToDraw(loader.playerVillages[playerId], redrawVillages)
                }

                break
            }
            default: {
                throw new Error('Highlights: Invalid category')
            }
        }

        return redrawVillages
    }

    this.recalcSize = () => {
        const { width, height } = $container.getBoundingClientRect()
        viewportWidth = width ? width : window.innerWidth
        viewportHeight = height ? height : window.innerHeight

        middleViewportOffsetX = Math.floor(viewportWidth / 2)
        middleViewportOffsetY = Math.floor(viewportHeight / 2)

        $viewport.width = viewportWidth
        $viewport.height = viewportHeight
        $overlay.width = viewportWidth
        $overlay.height = viewportHeight

        renderVisibleDemarcations()
        renderVisibleContinents()
        renderViewport()
    }

    this.moveTo = (x, y) => {
        if (x === '' || isNaN(x) || y === '' || isNaN(y)) {
            return
        }

        const oldPositionX = positionX
        const oldPositionY = positionY

        positionX = boundNumber(x, 0, 999) * zoomSettings.tileSize
        positionY = boundNumber(y, 0, 999) * zoomSettings.tileSize

        if (oldPositionX === positionX && oldPositionY === positionY) {
            return
        }

        updateCenter()

        if (tooltip) {
            tooltip.hide()
        }

        renderVisibleDemarcations()
        renderVisibleContinents()
        renderViewport()
        activeVillage = false
        renderOverlay()
    }

    this.getCoords = () => {
        return {
            x: Math.floor(positionX / zoomSettings.tileSize),
            y: Math.floor(positionY / zoomSettings.tileSize)
        }
    }

    this.addHighlight = (category, id, color) => {
        let realId
        let displayName

        if (!HIGHLIGHT_CATEGORIES.hasOwnProperty(category)) {
            throw new Error('Highlights: Invalid category')
        }

        if (typeof id === 'number' && loader[category].hasOwnProperty(id)) {
            realId = id
        } else if (typeof id === 'string') {
            try {
                realId = highlightGetRealId(category, id)
            } catch (error) {
                return console.log(error)
            }
        } else {
            throw new Error('Highlights: Invalid id')
        }

        if (!color) {
            color = arrayRandom(colorPalette.flat())
        }

        const redrawVillages = getVillagesToDraw(category, realId)

        switch (category) {
            case HIGHLIGHT_CATEGORIES.tribes: {
                const [name, tag] = loader.tribes[realId]
                displayName = tag + ' (' + name + ')'
                break
            }
            case HIGHLIGHT_CATEGORIES.players: {
                const [name] = loader.players[realId]
                displayName = name
                break
            }
        }

        if (highlights[category].hasOwnProperty(realId)) {
            this.trigger('update highlight', [category, id, displayName, color])
        } else {
            this.trigger('add highlight', [category, id, displayName, color])
        }

        highlights[category][realId] = {
            display: displayName,
            color: color
        }

        renderVillages(redrawVillages)

        for (let zoomLevel in zoomCache) {
            if (zoomLevel !== settings.zoomLevel) {
                renderVillages(redrawVillages, zoomCache[zoomLevel].$cacheContext, zoomLevels[zoomLevel])
            }
        }

        renderViewport()
    }

    this.removeHighlight = (category, id) => {
        let realId

        if (!HIGHLIGHT_CATEGORIES.hasOwnProperty(category)) {
            throw new Error('Highlights: Invalid category')
        }

        if (typeof id === 'number' && loader[category].hasOwnProperty(id)) {
            realId = id
        } else if (typeof id === 'string') {
            try {
                realId = highlightGetRealId(category, id)
            } catch (error) {
                return console.log(error)
            }
        } else {
            throw new Error('Highlights: Invalid id')
        }

        const redrawVillages = getVillagesToDraw(category, realId)

        delete highlights[category][realId]

        this.trigger('remove highlight', [category, id])
        renderVillages(redrawVillages)
        renderViewport()
    }

    this.shareMap = async (type) => {
        const highlightsExport = []

        for (let [id, data] of Object.entries(highlights.players)) {
            highlightsExport.push(['players', parseInt(id, 10), data.color])
        }

        for (let [id, data] of Object.entries(highlights.tribes)) {
            highlightsExport.push(['tribes', parseInt(id, 10), data.color])
        }

        if (!highlightsExport.length) {
            throw new Error('TW2Map: No highlights to create a share')
        }

        return await ajaxPost('/maps/api/create-share', {
            marketId,
            worldNumber,
            highlights: highlightsExport,
            type
        })
    }

    this.on = (event, handler) => {
        events[event] = events[event] || []

        if (typeof handler === 'function') {
            events[event].push(handler)
        }
    }

    this.trigger = (event, args) => {
        if (events.hasOwnProperty(event)) {
            for (let handler of events[event]) {
                handler.apply(this, args)
            }
        }
    }

    setupZoom()

    positionX = 500 * zoomSettings.tileSize
    positionY = 500 * zoomSettings.tileSize

    setupElements()
    mouseEvents()

    Promise.all([
        loader.loadPlayers,
        loader.loadTribes
    ]).then(() => {
        renderVisibleContinents()
        continuousRender()
    })

    loader.loadStruct.then(() => {
        renderVisibleDemarcations()
        renderViewport()
    })

    this.on('click', function (activeVillage) {
        if (!activeVillage) {
            return
        }

        const id = activeVillage.character_id

        if (!id) {
            return
        }

        const category = HIGHLIGHT_CATEGORIES.players
        const color = arrayRandom(colorPalette.flat())

        clearOverlay()

        this.addHighlight(category, id, color)
    })

    if (tooltip) {
        this.on('active village', (village) => {
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
                ([ playerName, tribeId, playerPoints ] = loader.players[villageCharacterId])

                if (tribeId) {
                    ([ tribeName, tribeTag, tribePoints ] = loader.tribes[tribeId])
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

        this.on('inactive village', (village) => {
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
    this.struct = {}

    const mergeVillages = (villages) => {
        for (let x in villages) {
            for (let y in villages[x]) {
                if (x in this.villages) {
                    this.villages[x][y] = villages[x][y]
                } else {
                    this.villages[x] = {}
                    this.villages[x][y] = villages[x][y]
                }

                let village = this.villages[x][y]
                let character_id = village[3]

                if (character_id) {
                    if (character_id in this.playerVillages) {
                        this.playerVillages[character_id].push([x, y])
                    } else {
                        this.playerVillages[character_id] = [[x, y]]
                    }
                }
            }
        }
    }

    this.loadPlayers = new Promise(async (resolve) => {
        const players = await fetch(`/maps/api/${marketId}/${worldNumber}/players`)
        this.players = await players.json()

        for (let id in this.players) {
            let [name, tribeId, points] = this.players[id]
            this.playersByName[name.toLowerCase()] = parseInt(id, 10)

            if (tribeId) {
                this.tribePlayers[tribeId] = this.tribePlayers[tribeId] || []
                this.tribePlayers[tribeId].push(parseInt(id, 10))
            }
        }

        resolve()
    })

    this.loadTribes = new Promise(async (resolve) => {
        const tribes = await fetch(`/maps/api/${marketId}/${worldNumber}/tribes`)
        this.tribes = await tribes.json()

        for (let id in this.tribes) {
            let [name, tag, points] = this.tribes[id]
            this.tribesByName[name.toLowerCase()] = parseInt(id, 10)
            this.tribesByTag[tag.toLowerCase()] = parseInt(id, 10)
        }

        resolve()
    })

    this.loadContinent = (continent) => {
        if (typeof continent !== 'number' || continent < 0 || continent > 99) {
            throw new Error('Invalid continent value')
        }

        if (continentPromises.hasOwnProperty(continent)) {
            return continentPromises[continent]
        }

        continentPromises[continent] = new Promise(async (resolve) => {
            const load = await fetch(`/maps/api/${marketId}/${worldNumber}/continent/${continent}`)
            const villages = await load.json()
            this.continents[continent] = villages
            mergeVillages(villages)
            resolve(villages)
        })

        return continentPromises[continent]
    }

    this.loadStruct = new Promise(async (resolve) => {
        const loadStruct = await fetch(`/maps/api/${marketId}/${worldNumber}/struct`)
        const buffer = await loadStruct.arrayBuffer()
        
        this.struct = new DataView(buffer)

        resolve()
    })
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

    const mouseMoveHandler = (event) => {
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

    const setEvents = () => {
        window.addEventListener('mousemove', mouseMoveHandler)
    }

    const unsetEvents = () => {
        window.removeEventListener('mousemove', mouseMoveHandler)
    }

    this.set = ({
        villageName,
        villageX,
        villageY,
        villagePoints,
        playerName,
        playerPoints,
        tribeName,
        tribeTag,
        tribePoints
    }) => {
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

    this.show = () => {
        setEvents()
        $tooltip.style.visibility = 'visible'
        $tooltip.style.opacity = 1
        visible = true
    }

    this.hide = () => {
        unsetEvents()
        $tooltip.style.visibility = 'hidden'
        $tooltip.style.opacity = 0
        visible = false
    }
}

;(async () => {
    let colorPicker
    let notif

    const setupQuickJump = () => {
        const $quickJumpX = document.querySelector('#quick-jump-x')
        const $quickJumpY = document.querySelector('#quick-jump-y')
        const $quickJumpGo = document.querySelector('#quick-jump-go')

        $quickJumpX.addEventListener('keydown', (event) => {
            if (event.code === 'Enter') {
                map.moveTo($quickJumpX.value, $quickJumpY.value)
            }
        })

        const rnondigit = /[^\d]/g
        const rloosecoords = /(\d{1,3})[^\d](\d{1,3})/

        const coordsInputFactory = ($input) => {
            return (event) => {
                if (event.inputType === 'insertFromPaste' || event.inputType === 'insertFromDrag') {
                    const coords = $input.value.match(rloosecoords)

                    if (coords !== null) {
                        $quickJumpX.value = coords[1]
                        $quickJumpY.value = coords[2]
                        $quickJumpY.focus()

                        return
                    }
                }

                $input.value = $input.value.replace(rnondigit, '')

                if ($input.value.length > 3) {
                    $input.value = $quickJumpX.value.slice(0, 3)
                }
            }
        }

        $quickJumpX.addEventListener('input', coordsInputFactory($quickJumpX))
        $quickJumpY.addEventListener('input', coordsInputFactory($quickJumpY))

        $quickJumpY.addEventListener('keydown', (event) => {
            if (event.code === 'Enter') {
                map.moveTo($quickJumpX.value, $quickJumpY.value)
            }
        })

        $quickJumpGo.addEventListener('click', (event) => {
            map.moveTo($quickJumpX.value, $quickJumpY.value)
        })
    }

    const setupCustomHighlights = () => {
        const $highlightId = document.getElementById('highlight-id')
        const $highlightItems = document.getElementById('highlight-items')

        const setupAutoComplete = () => {
            const autoComplete = new AutoComplete({
                data: {
                    src: async () => {
                        await Promise.all([
                            loader.loadPlayers,
                            loader.loadTribes
                        ])

                        const matches = []

                        for (let [name] of Object.values(loader.players)) {
                            matches.push({
                                search: name,
                                id: name,
                                type: 'players'
                            })
                        }

                        for (let [name, tag] of Object.values(loader.tribes)) {
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
                sort: (a, b) => {
                    if (a.match < b.match) return -1
                    if (a.match > b.match) return 1
                    return 0
                },
                noResults: () => {
                    const $item = document.createElement('li')
                    $item.innerHTML = 'no results'
                    autoComplete.resultsList.view.appendChild($item)
                },
                highlight: true,
                onSelection: (feedback) => {
                    const { search, id, type } = feedback.selection.value
                    const color = arrayRandom(colorPalette.flat())

                    map.addHighlight(type, id, color)
                    $highlightId.value = ''
                }
            })

            $highlightId.addEventListener('blur', () => {
                autoComplete.resultsList.view.style.display = 'none'
            })

            $highlightId.addEventListener('focus', () => {
                autoComplete.resultsList.view.style.display = ''
            })

            $highlightId.addEventListener('keydown', async (event) => {
                if (event.key === 'Escape') {
                    $highlightId.value = ''
                    $highlightId.dispatchEvent(new Event('input'))
                }
            })

            $highlightId.addEventListener('autoComplete', ({ detail }) => {
                if (detail.event.key == 'Enter' && detail.matches > 0) {
                    autoComplete.listMatchedResults(autoComplete.dataStream).then(() => {
                        const first = autoComplete.resultsList.view.children.item(0)
                        first.dispatchEvent(new Event('mousedown'))
                    })
                }
            })
        }

        map.on('add highlight', (category, id, displayName, color) => {
            const $item = document.createElement('li')
            const $name = document.createElement('div')
            const $nameSpan = document.createElement('span')
            const $color = document.createElement('div')
            
            $item.classList.add('highlight-' + normalizeString(id))
            $item.classList.add('item')
            $item.classList.add(category)
            $item.dataset.category = category
            $item.dataset.id = id
            $item.dataset.color = color

            $name.addEventListener('click', () => {
                map.removeHighlight(category, id)
            })

            $name.className = 'name'

            $nameSpan.innerHTML = displayName
            $nameSpan.className = 'icon-' + category

            $color.className = 'color open-color-picker'
            $color.style.backgroundColor = color
            $color.dataset.color = color

            $color.addEventListener('click', () => {
                colorPicker($color, $color.dataset.color, (pickedColor) => {
                    $color.dataset.color = pickedColor
                    map.addHighlight(category, id, pickedColor)
                })
            })

            $name.appendChild($nameSpan)
            $item.appendChild($name)
            $item.appendChild($color)
            $highlightItems.appendChild($item)
        })

        map.on('update highlight', (category, id, displayName, color) => {
            const $item = $highlightItems.querySelector('.highlight-' + normalizeString(id))

            if (!$item) {
                return false
            }

            const $color = $item.querySelector('.color')

            $color.style.background = color
            $item.dataset.color = color
        })

        map.on('remove highlight', (category, id) => {
            const $item = $highlightItems.querySelector('.highlight-' + normalizeString(id))

            if ($item) {
                $item.remove()
            }
        })

        setupAutoComplete()
    }

    const setupColorPicker = () => {
        let activeColorPicker = false

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

        const $colors = $colorPicker.querySelectorAll('div')

        colorPicker = ($reference, selectedColor, callback) => {
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

            setTimeout(() => {
                activeColorPicker = (event) => {
                    if (event.target.classList.contains('color')) {
                        callback(event.target.dataset.color)
                        closeColorPicker()
                    }
                }

                $colorPicker.addEventListener('click', activeColorPicker)
            }, 25)
        }

        const closeColorPicker = () => {
            $colorPicker.removeEventListener('click', activeColorPicker)
            $colorPicker.style.visibility = 'hidden'
            $colorPicker.style.opacity = 0
            activeColorPicker = false
        }

        window.addEventListener('click', (event) => {
            if (!activeColorPicker || event.target.classList.contains('open-color-picker')) {
                return
            }

            if (!event.target.closest('#color-picker')) {
                closeColorPicker()
            }
        })
    }

    const setupDisplayLastSync = () => {
        const $lastSync = document.querySelector('#last-sync-date')

        if (!lastSync) {
            $lastSync.innerHTML = 'never'

            return
        }

        const formatSince = (lastSync) => {
            const elapsedTime = Date.now() - lastSync

            const seconds = elapsedTime / 1000
            const minutes = seconds / 60
            const hours = minutes / 60
            const days = hours / 24

            let format = ''

            if (minutes <= 1) {
                format = 'just now'
            } else if (hours <= 1) {
                format = Math.floor(minutes) + ' minutes ago'
            } else if (days <= 1) {
                if (hours < 2) {
                    format = '1 hour ago'
                } else {
                    format = Math.floor(hours) + ' hours ago'
                }
            } else {
                if (days > 2) {
                    format = Math.floor(days) + ' days ago'
                } else {
                    const dayHours = hours % 24

                    if (dayHours <= 2) {
                        format = '1 day ago'
                    } else {
                        format = '1 day and ' + Math.floor(dayHours) + ' hours ago'
                    }
                    
                }
            }

            return format
        }

        $lastSync.innerHTML = formatSince(lastSync)
    }

    const setupDisplayPosition = () => {
        const $displayPositionX = document.querySelector('#display-position-x')
        const $displayPositionY = document.querySelector('#display-position-y')

        map.on('center coords update', (x, y) => {
            $displayPositionX.innerHTML = x
            $displayPositionY.innerHTML = y
        })
    }

    const setupCommonEvents = () => {
        window.addEventListener('resize', map.recalcSize)

        window.addEventListener('keydown', (event) => {
            if (event.target.nodeName !== 'INPUT' && event.code === 'Space') {
                map.moveTo(500, 500)
            }
        })
    }

    const setupMapShare = async () => {
        const $mapShare = document.querySelector('#map-share')
        const $mapSave = document.querySelector('#map-save')

        $mapShare.addEventListener('click', async () => {
            const result = await map.shareMap('dynamic')

            if (result.success) {
                notif({
                    title: 'Dynamic map',
                    link: location.origin + result.url,
                    timeout: 0
                })
            } else {
                notif({
                    title: 'Error generating map',
                    content: result.message
                })
            }
        })

        $mapSave.addEventListener('click', async () => {
            notif({
                title: 'Static map',
                content: 'Static maps are not available yet!'
            })
        })

        if (mapShareId) {
            const getMapShare = await ajaxPost('/maps/api/get-share/', {
                mapShareId,
                marketId,
                worldNumber
            })

            const mapShare = getMapShare.data
            const highlights = JSON.parse(mapShare.highlights)

            await Promise.all([
                loader.loadPlayers,
                loader.loadTribes
            ])

            for (let [category, id, color] of highlights) {
                map.addHighlight(category, id, color)
            }
        }
    }

    const setupNotif = () => {
        const $notif = document.querySelector('#notif')
        const $notifTitle = $notif.querySelector('#notif-title')
        const $notifContent = $notif.querySelector('#notif-content')
        const $notifLink = $notif.querySelector('#notif-link')
        const $notifClose = $notif.querySelector('#notif-close')

        let activeTimeout

        $notif.addEventListener('click', () => $notif.classList.add('hidden'))
        $notifClose.addEventListener('click', () => $notif.classList.add('hidden'))

        notif = ({ title = '', content = '', timeout = 3000, link = false }) => {
            clearTimeout(activeTimeout)

            title = String(title)

            if (title.length) {
                $notifTitle.innerText = title
                $notifTitle.classList.remove('hidden')
            } else {
                $notifTitle.classList.add('hidden')
            }

            if (link) {
                $notifLink.href = link
                $notifLink.innerText = link
                $notifLink.classList.remove('hidden')
            } else {
                $notifLink.classList.add('hidden')
            }

            if (content.length) {
                $notifContent.innerHTML = content
                $notifContent.classList.remove('hidden')
            } else {
                $notifContent.classList.add('hidden')
            }

            $notifContent.innerHTML = content
            $notif.classList.remove('hidden')

            if (typeof timeout === 'number' && timeout !== 0) {
                activeTimeout = setTimeout(() => {
                    $notif.classList.add('hidden')
                }, timeout)
            }
        }
    }

    const setupWorldList = () => {
        let visible = false

        const $allWorlds = document.querySelector('#all-worlds')
        const $allMarkets = document.querySelector('#all-markets')
        const $currentWorld = document.querySelector('#current-world')
        const $allMarketWorlds = document.querySelector('#all-market-worlds')

        for (let market of allMarkets) {
            const $marketContainer = document.createElement('li')
            const $button = document.createElement('div')
            const $flag = document.createElement('span')
            const $text = document.createElement('span')

            $button.dataset.market = market
            $button.appendChild($flag)

            if (market === marketId) {
                $button.classList.add('selected')
            }

            $button.classList.add('market')
            $button.classList.add('text-container')
            $text.innerText = ' ' + market
            $flag.classList.add('flag')
            $flag.classList.add('flag-' + market)

            $button.appendChild($flag)
            $button.appendChild($text)

            $button.addEventListener('mouseenter', function () {
                $selectedmarket = $allWorlds.querySelector('.market.selected')
                
                if ($selectedmarket) {
                    $selectedmarket.classList.remove('selected')
                }

                this.classList.add('selected')

                changeWorldList(this.dataset.market)
            })

            $marketContainer.appendChild($button)
            $allMarkets.appendChild($marketContainer)
        }

        const changeWorldList = function (newMarket) {
            const marketWorlds = allWorlds.filter((world) => world.market === newMarket)

            while ($allMarketWorlds.firstChild) {
                $allMarketWorlds.removeChild($allMarketWorlds.lastChild)
            }

            for (let {market, num, name} of marketWorlds) {
                const $world = document.createElement('li')
                const $archor = document.createElement('a')
                const $button = document.createElement('button')

                $archor.href = location.origin + '/maps/' + market + '/' + num + '/'

                $button.classList.add('world')

                if (worldNumber === num && marketId === market) {
                    $button.classList.add('selected')
                }

                $button.innerText = market + num + ' ' + name

                $archor.appendChild($button)
                $world.appendChild($archor)
                $allMarketWorlds.appendChild($world)
            }
        }

        const closeHandler = function (event) {
            if (!event.target.closest('#all-worlds') && !event.target.closest('#current-world')) {
                $allWorlds.classList.add('hidden')
                removeEventListener('mousedown', closeHandler)
                visible = false
            }
        }

        $currentWorld.addEventListener('mouseup', () => {
            if (visible) {
                $allWorlds.classList.add('hidden')
                visible = false
                return
            }

            $allWorlds.classList.toggle('hidden')

            if (visible = !visible) {
                addEventListener('mousedown', closeHandler)
            }
        })

        changeWorldList(marketId)
    }

    const mapSettings = {
        hexagonVillages: true,
        zoomLevel: 3
    }

    const loader = new DataLoader(marketId, worldNumber)
    const tooltip = new TW2MapTooltip('#tooltip')
    const map = new TW2Map('#map', loader, tooltip, mapSettings)

    setupQuickJump()
    setupCustomHighlights()
    setupColorPicker()
    setupDisplayLastSync()
    setupDisplayPosition()
    setupCommonEvents()
    setupMapShare()
    setupNotif()
    setupWorldList()
})()
