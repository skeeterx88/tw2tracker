const TW2Map = function (containerSelector, loader, tooltip, settings) {
    const $container = document.querySelector(containerSelector)

    if (!$container || !$container.nodeName || $container.nodeName !== 'DIV') {
        throw new Error('Invalid map element')
    }

    const defaults = {
        allowZoom: true,
        hexagonVillages: true,
        zoomLevel: 2,
        quickHighlight: true,
        neutralColor: '#823c0a',
        barbarianColor: '#4c6f15',
        backgroundColor: '#436213',
        highlightPlayerColor: '#ffffff',
        activeVillageBorderColor: '#ffffff',
        activeVillageBorderOpacity: '80',
        demarcationsColor: '#000000'
    }

    settings = {
        ...defaults,
        ...settings
    }

    let activeVillage = false
    let renderEnabled = false
    let zoomSettings

    const $zoomElements = {}
    const $viewport = document.createElement('canvas')
    const $viewportContext = $viewport.getContext('2d')
    const $overlay = document.createElement('canvas')
    const $overlayContext = $overlay.getContext('2d')

    let $cache
    let $cacheContext
    let $grid
    let $gridContext

    const { x, y, width, height } = $container.getBoundingClientRect()
    let viewportWidth = width ? width : window.innerWidth
    let viewportHeight = height ? height : window.innerHeight
    let viewportOffsetX = x
    let viewportOffsetY = y

    let middleViewportOffsetX = Math.floor(viewportWidth / 2)
    let middleViewportOffsetY = Math.floor(viewportHeight / 2)

    let positionX
    let positionY
    let centerCoordX
    let centerCoordY
    let mouseCoordX
    let mouseCoordY

    const events = {}

    let renderedZoomContinents
    let renderedZoomGrid

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

    const BORDERS_OFFSET = [
        {x: -1, y: 0},
        {x: -1, y: -1},
        {x: +1, y: -1},
        {x: +1, y: 0},
        {x: +1, y: +1},
        {x: -1, y: +1}
    ]

    const highlights = {}

    highlights[TW2Map.highlightTypes.PLAYERS] = {}
    highlights[TW2Map.highlightTypes.TRIBES] = {}

    const settingTriggers = {}

    settingTriggers.neutralColor = (flag) => {
        if (flag === TW2Map.INITIAL_SETUP) {
            return
        }

        resetZoomContinents()
        renderVisibleContinents()
    }

    settingTriggers.barbarianColor = (flag) => {
        if (flag === TW2Map.INITIAL_SETUP) {
            return
        }

        resetZoomContinents()
        renderVisibleContinents()
    }

    settingTriggers.backgroundColor = (flag) => {
        $container.style.backgroundColor = settings.backgroundColor
    }

    settingTriggers.demarcationsColor = (flag) => {
        if (flag === TW2Map.INITIAL_SETUP) {
            return
        }

        resetZoomGrid()
        clearDemarcations()
        renderVisibleDemarcations()
        renderViewport()
    }

    settingTriggers.zoomLevel = (flag) => {
        const currentCenterX = Math.floor(positionX / zoomSettings.tileSize)
        const currentCenterY = Math.floor(positionY / zoomSettings.tileSize)

        setupZoom()

        this.moveTo(currentCenterX, currentCenterY)

        if (flag === TW2Map.INITIAL_SETUP) {
            resetZoomContinents()
        }

        renderVisibleDemarcations()
        renderVisibleContinents()
        renderViewport()
    }

    const resetZoomContinents = () => {
        renderedZoomContinents = Array.from({ length: zoomLevels.length }).map(zoom => Object())
    }

    const resetZoomGrid = () => {
        renderedZoomGrid = Array.from({ length: zoomLevels.length }).map(zoom => Object())
    }

    const setupZoom = function () {
        zoomSettings = zoomLevels[settings.zoomLevel]

        zoomSettings.tileSize = zoomSettings.villageSize + zoomSettings.villageMargin
        zoomSettings.mapWidth = 1000 * zoomSettings.tileSize
        zoomSettings.mapHeight = 1000 * zoomSettings.tileSize

        if (!hasOwn.call($zoomElements, settings.zoomLevel)) {
            $cache = document.createElement('canvas')
            $cacheContext = $cache.getContext('2d')

            $grid = document.createElement('canvas')
            $gridContext = $grid.getContext('2d')

            $cache.width = zoomSettings.mapWidth
            $cache.height = zoomSettings.mapHeight

            $grid.width = zoomSettings.mapWidth
            $grid.height = zoomSettings.mapHeight

            $zoomElements[settings.zoomLevel] = {
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
            } = $zoomElements[settings.zoomLevel])
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

                if (activeVillage && activeVillage.character_id) {
                    clearOverlay()
                    const color = arrayRandom(TW2Map.colorPalette.flat())
                    this.addHighlight(TW2Map.highlightTypes.PLAYERS, activeVillage.character_id, color)
                }
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
            if (!settings.quickHighlight || draggable) {
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

            if (settings.quickHighlight) {
                unsetActiveVillage()
            }
        })

        if (settings.allowZoom) {
            $overlay.addEventListener('wheel', (event) => {
                if (event.deltaY < 0) {
                    this.zoomIn()
                } else if (event.deltaY > 0) {
                    this.zoomOut()
                }
            })
        }
    }

    const setActiveVillage = (village) => {
        if (activeVillage && activeVillage.x === mouseCoordX && activeVillage.y === mouseCoordY) {
            return
        }

        const [id, name, points, character_id, province_id] = village

        activeVillage = {
            id,
            name,
            points,
            character_id,
            x: mouseCoordX,
            y: mouseCoordY,
            province_id
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

        const sorted = visibleContinents.sort(function(a, b){
            return Math.abs(55 - a) - Math.abs(55 - b)
        })

        return sorted
    }

    const renderVisibleContinents = () => {
        let nonRenderedContinents = getVisibleContinents().filter((continent) => {
            return !renderedZoomContinents[settings.zoomLevel][continent]
        })

        nonRenderedContinents.forEach((continent) => {
            renderedZoomContinents[settings.zoomLevel][continent] = true

            loader.loadContinent(continent).then(villages => {
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

    const clearDemarcations = () => {
        $gridContext.clearRect(0, 0, $grid.width, $grid.height)
    }

    const renderVisibleDemarcations = () => {
        if (!zoomSettings.drawContinents && !zoomSettings.drawProvinces || !loader.struct) {
            return
        }

        const visibleContinents = getVisibleContinents()
        const nonRenderedContinents = visibleContinents.filter((k) => !hasOwn.call(renderedZoomGrid[settings.zoomLevel], k))

        for (let k of nonRenderedContinents) {
            k = String(k)
            const startX = k < 10 ? k * 100 : k[1] * 100
            const startY = k < 10 ? 0 : k[0] * 100
            const endX = startX + 100
            const endY = startY + 100

            for (let x = startX; x < endX; x++) {
                for (let y = startY; y < endY; y++) {
                    
                    const tilePos = y + 1000 * x
                    const fiveBits = readBitsAt(loader.struct, tilePos)

                    // has border
                    if (fiveBits >>> 4) {
                        const isContinentBorder = (fiveBits >> 3) & 1

                        if (isContinentBorder) {
                            if (zoomSettings.drawContinents) {
                                $gridContext.fillStyle = settings.demarcationsColor + (zoomSettings.continentOpacity ? zoomSettings.continentOpacity : '')
                            } else {
                                $gridContext.fillStyle = settings.demarcationsColor + (zoomSettings.provinceOpacity ? zoomSettings.provinceOpacity : '')
                            }
                        } else {
                            if (zoomSettings.drawProvinces) {
                                $gridContext.fillStyle = settings.demarcationsColor + (zoomSettings.provinceOpacity ? zoomSettings.provinceOpacity : '')
                            } else {
                                continue
                            }
                        }

                        const borders = getRowNeighbourTilePosition(x, y)

                        for (let i = 0; i < 6; i++) {
                            const neighbourTile = readBitsAt(loader.struct, borders[i])

                            if (neighbourTile >>> 4) {
                                $gridContext.fillRect(x * zoomSettings.tileSize + BORDERS_OFFSET[i].x, y * zoomSettings.tileSize + BORDERS_OFFSET[i].y, 1, 1)
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
        if (tilePos < 0 || tilePos >= 1000000) {
            return;
        }

        var bytePosInSegment    = tilePos % 8,
            byteOffset          = (tilePos - bytePosInSegment) * 0.625,
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
            (1000 * (x - 1)) + y,
            (1000 * x) + y - 1,
            (1000 * (x + 1)) + y - 1,
            (1000 * (x + 1)) + y,
            (1000 * (x + 1)) + y + 1,
            (1000 * x) + y + 1
        ] : [
            (1000 * (x - 1)) + y,
            (1000 * (x - 1)) + y - 1,
            (1000 * x) + y - 1,
            (1000 * (x + 1)) + y,
            (1000 * x) + y + 1,
            (1000 * (x - 1)) + y + 1
        ];
    }

    const renderVillages = (villages, context = $cacheContext, zoomSettings = zoomLevels[settings.zoomLevel]) => {
        for (let x in villages) {
            for (let y in villages[x]) {
                let [id, name, points, character_id] = villages[x][y]

                let tribeId = loader.players && character_id ? loader.players[character_id][1] : false

                if (!character_id) {
                    context.fillStyle = settings.barbarianColor
                } else if (character_id in highlights.players) {
                    context.fillStyle = highlights.players[character_id].color
                } else if (tribeId && tribeId in highlights.tribes) {
                    context.fillStyle = highlights.tribes[tribeId].color
                } else {
                    context.fillStyle = settings.neutralColor
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
            $overlayContext.fillStyle = settings.activeVillageBorderColor + settings.activeVillageBorderOpacity

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

        $overlayContext.fillStyle = settings.highlightPlayerColor

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

    const highlightGetRealId = (highlightType, id) => {
        const lowerId = id.toLowerCase()

        switch (highlightType) {
            case TW2Map.highlightTypes.PLAYERS: {
                if (hasOwn.call(loader.playersByName, lowerId)) {
                    return loader.playersByName[lowerId]
                } else {
                    throw new Error(`Highlights: Player ${id} not found`)
                }

                break
            }
            case TW2Map.highlightTypes.TRIBES: {
                if (hasOwn.call(loader.tribesByTag, lowerId)) {
                    return loader.tribesByTag[lowerId]
                } else if (hasOwn.call(loader.tribesByName, lowerId)) {
                    return loader.tribesByName[lowerId]
                } else {
                    throw new Error(`Highlights: Tribe ${id} not found`)
                }

                break
            }
            default: {
                throw new Error('Highlights: Invalid highlightType')
            }
        }
    }

    const getVillagesToDraw = (highlightType, realId) => {
        let redrawVillages = {
            x: {}
        }

        switch (highlightType) {
            case TW2Map.highlightTypes.PLAYERS: {
                formatVillagesToDraw(loader.playerVillages[realId], redrawVillages)
                break
            }
            case TW2Map.highlightTypes.TRIBES: {
                for (let playerId of loader.tribePlayers[realId]) {
                    formatVillagesToDraw(loader.playerVillages[playerId], redrawVillages)
                }

                break
            }
            default: {
                throw new Error('Highlights: Invalid highlightType')
            }
        }

        return redrawVillages
    }

    const setupTooltip = () => {
        if (!tooltip) {
            return
        }

        this.on('active village', (village) => {
            if (!loader.players) {
                return
            }

            const {
                id,
                name: villageName,
                points: villagePoints,
                character_id: villageCharacterId,
                x: villageX,
                y: villageY,
                province_id
            } = village

            let playerName
            let tribeId
            let playerPoints
            let playerVillages
            let tribe
            let tribeName
            let tribeTag
            let tribePoints
            let tribeVillages
            let provinceName = loader.provinces[province_id]

            if (villageCharacterId) {
                ([ playerName, tribeId, playerPoints, playerVillages ] = loader.players[villageCharacterId])

                if (tribeId) {
                    ([ tribeName, tribeTag, tribePoints, tribeVillages ] = loader.tribes[tribeId])
                }
            }

            tooltip.set({
                villageName,
                villageX,
                villageY,
                villagePoints,
                playerName,
                playerPoints,
                playerVillages,
                tribeName,
                tribeTag,
                tribePoints,
                tribeVillages,
                provinceName
            })

            tooltip.show()
        })

        this.on('inactive village', (village) => {
            tooltip.hide()
        })
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

    this.zoomIn = () => {
        if (zoomLevels[settings.zoomLevel + 1]) {
            settings.zoomLevel++
            settingTriggers.zoomLevel()
        }
    }

    this.zoomOut = () => {
        if (zoomLevels[settings.zoomLevel - 1]) {
            settings.zoomLevel--
            settingTriggers.zoomLevel()
        }
    }

    this.getCoords = () => {
        return {
            x: Math.floor(positionX / zoomSettings.tileSize),
            y: Math.floor(positionY / zoomSettings.tileSize)
        }
    }

    this.addHighlight = (highlightType, id, color) => {
        let realId
        let displayName

        if (typeof id === 'number' && hasOwn.call(loader[highlightType], id)) {
            realId = id
        } else if (typeof id === 'string') {
            try {
                realId = highlightGetRealId(highlightType, id)
            } catch (error) {
                return console.log(error)
            }
        } else {
            throw new Error('Highlights: Invalid id')
        }

        if (!color) {
            color = arrayRandom(TW2Map.colorPalette.flat())
        }

        const redrawVillages = getVillagesToDraw(highlightType, realId)

        switch (highlightType) {
            case TW2Map.highlightTypes.TRIBES: {
                const [name, tag] = loader.tribes[realId]
                displayName = `${tag} (${name})`
                break
            }
            case TW2Map.highlightTypes.PLAYERS: {
                const [name] = loader.players[realId]
                displayName = name
                break
            }
        }

        if (hasOwn.call(highlights[highlightType], realId)) {
            this.trigger('update highlight', [highlightType, id, displayName, color])
        } else {
            this.trigger('add highlight', [highlightType, id, displayName, color])
        }

        highlights[highlightType][realId] = {
            display: displayName,
            color: color
        }

        renderVillages(redrawVillages)

        const sortedZooms = Object.keys($zoomElements).sort((a, b) => a == settings.zoomLevel ? -1 : 0)

        for (let zoomLevel of sortedZooms) {
            renderVillages(redrawVillages, $zoomElements[zoomLevel].$cacheContext, zoomLevels[zoomLevel])
        }

        renderViewport()
    }

    this.removeHighlight = (highlightType, id) => {
        let realId

        if (typeof id === 'number' && hasOwn.call(loader[highlightType], id)) {
            realId = id
        } else if (typeof id === 'string') {
            try {
                realId = highlightGetRealId(highlightType, id)
            } catch (error) {
                return console.log(error)
            }
        } else {
            throw new Error('Highlights: Invalid id')
        }

        const redrawVillages = getVillagesToDraw(highlightType, realId)

        delete highlights[highlightType][realId]

        const sortedZooms = Object.keys($zoomElements).sort((a, b) => a == settings.zoomLevel ? -1 : 0)

        for (let zoomLevel of sortedZooms) {
            renderVillages(redrawVillages, $zoomElements[zoomLevel].$cacheContext, zoomLevels[zoomLevel])
        }

        this.trigger('remove highlight', [highlightType, id])

        renderViewport()
    }

    this.shareMap = async (shareType) => {
        const highlightsExport = []

        for (let [id, data] of Object.entries(highlights.players)) {
            highlightsExport.push([TW2Map.highlightTypes.PLAYERS, parseInt(id, 10), data.color])
        }

        for (let [id, data] of Object.entries(highlights.tribes)) {
            highlightsExport.push([TW2Map.highlightTypes.TRIBES, parseInt(id, 10), data.color])
        }

        if (!highlightsExport.length) {
            throw new Error('No highlights to create a share')
        }

        const response = await fetch('/maps/api/create-share', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                marketId,
                worldNumber,
                highlights: highlightsExport,
                shareType,
                center: {
                    x: centerCoordX,
                    y: centerCoordY
                },
                settings: {
                    zoomLevel: settings.zoomLevel,
                    neutralColor: settings.neutralColor,
                    barbarianColor: settings.barbarianColor,
                    backgroundColor: settings.backgroundColor,
                    highlightPlayerColor: settings.highlightPlayerColor,
                    demarcationsColor: settings.demarcationsColor
                }
            })
        })

        const content = await response.text()

        if (response.status === 400) {
            throw new Error(content)
        } else {
            return content
        }
    }

    this.on = (event, handler) => {
        events[event] = events[event] || []

        if (typeof handler === 'function') {
            events[event].push(handler)
        }
    }

    this.trigger = (event, args) => {
        if (hasOwn.call(events, event)) {
            for (let handler of events[event]) {
                handler.apply(this, args)
            }
        }
    }

    this.getSetting = (id) => {
        return settings[id]
    }

    this.changeSetting = (id, value, flag) => {
        if (!hasOwn.call(settings, id)) {
            throw new Error(`Setting '${id}' does not exist`)
        }

        settings[id] = value

        if (hasOwn.call(settingTriggers, id)) {
            settingTriggers[id](flag)
        }

        this.trigger('change setting', [id, value])
    }

    this.init = () => {
        renderVisibleContinents()
        continuousRender()

        loader.loadStruct.then(() => {
            renderVisibleDemarcations()
            renderViewport()
        })
    }

    setupZoom()
    resetZoomContinents()
    resetZoomGrid()
    positionX = 500 * zoomSettings.tileSize
    positionY = 500 * zoomSettings.tileSize
    centerCoordX = 500
    centerCoordY = 500
    setupElements()
    mouseEvents()
    setupTooltip()
}

TW2Map.colorPalette = [
    ["#ffffff", "#ebebeb", "#d7d7d7", "#c3c3c3", "#afafaf", "#9b9b9b", "#878787", "#737373", "#5f5f5f", "#4b4b4b", "#373737", "#232323", "#0f0f0f", "#000000"],
    ["#4c6f15", "#00ff41", "#0075ff", "#ff0000", "#ff8000", "#ffee00", "#ff008a", "#ffd5b6", "#781fff", "#5d7fa6", "#0000ff", "#ff0cd7", "#2f4f4f", "#ff4b4b"],
    ["#436213", "#0a8028", "#03709d", "#d83333", "#d96d00", "#d9ca00", "#b2146b", "#d96a19", "#661ad9", "#47617f", "#0000d9", "#d90ab7", "#8888fc", "#ce8856"],
    ["#7b730c", "#04571a", "#014a69", "#980e0e", "#b35a00", "#b3a600", "#870d50", "#a44c0b", "#5415b3", "#2a3e55", "#0000b3", "#b30897", "#00a0f4", "#969696"],
    ["#494500", "#02350f", "#00293a", "#730202", "#8c4700", "#8c8200", "#6a043e", "#723305", "#42108c", "#152232", "#00008c", "#8c0676", "#c766c7", "#00ff83"]
]

TW2Map.mapShareTypes = {
    STATIC: 'static',
    DYNAMIC: 'dynamic'
}

TW2Map.highlightTypes = {
    PLAYERS: 'players',
    TRIBES: 'tribes'
}

TW2Map.INITIAL_SETUP = 'initial_setup'

const TW2DataLoader = function (marketId, worldNumber) {
    const self = this
    let continentPromises = {}

    this.players = false
    this.playersByName = {}
    this.playerVillages = {}
    this.tribes = false
    this.tribesByTag = {}
    this.tribesByName = {}
    this.tribePlayers = {}
    this.continents = {}
    this.provinces = []
    this.villages = {}
    this.villages.x = {}
    this.struct = false

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

    this.loadInfo = new Promise(async (resolve) => {
        const url = mapShare && mapShare.type === TW2Map.mapShareTypes.STATIC
            ? `/maps/api/${marketId}/${worldNumber}/info/${mapShare.share_id}`
            : `/maps/api/${marketId}/${worldNumber}/info`

        const load = await fetch(url)
        const info = await load.json()

        this.players = info.players
        this.tribes = info.tribes
        this.provinces = info.provinces

        for (let id in this.players) {
            let [name, tribeId, points] = this.players[id]
            this.playersByName[name.toLowerCase()] = parseInt(id, 10)

            if (tribeId) {
                this.tribePlayers[tribeId] = this.tribePlayers[tribeId] || []
                this.tribePlayers[tribeId].push(parseInt(id, 10))
            }
        }

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

        if (hasOwn.call(continentPromises, continent)) {
            return continentPromises[continent]
        }

        continentPromises[continent] = new Promise(async (resolve) => {
            const url = mapShare && mapShare.type === TW2Map.mapShareTypes.STATIC
                ? `/maps/api/${marketId}/${worldNumber}/continent/${continent}/${mapShare.share_id}`
                : `/maps/api/${marketId}/${worldNumber}/continent/${continent}`

            const load = await fetch(url)
            const villages = await load.json()

            this.continents[continent] = villages

            mergeVillages(villages)
            resolve(villages)
        })

        return continentPromises[continent]
    }

    this.loadStruct = new Promise(async (resolve) => {
        const load = await fetch(`/maps/api/${marketId}/${worldNumber}/struct`)
        const blob = await load.blob()
        const buffer = await blob.arrayBuffer()

        this.struct = new DataView(buffer)

        resolve()
    })
}

const TW2Tooltip = function (selector) {
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
    let $playerVillages = $tooltip.querySelector('.player-villages')
    let $playerPoints = $tooltip.querySelector('.player-points')
    let $tribeName = $tooltip.querySelector('.tribe-name')
    let $tribeTag = $tooltip.querySelector('.tribe-tag')
    let $tribePoints = $tooltip.querySelector('.tribe-points')
    let $tribeVillages = $tooltip.querySelector('.tribe-villages')
    let $provinceName = $tooltip.querySelector('.province-name')

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

        $tooltip.style.transform = `translate3d(${x}px, ${y}px, 0px)`
    }

    const setEvents = () => {
        addEventListener('mousemove', mouseMoveHandler)
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
        playerVillages,
        tribeName,
        tribeTag,
        tribePoints,
        tribeVillages,
        provinceName
    }) => {
        $villageName.innerHTML = villageName
        $villageX.innerHTML = villageX
        $villageY.innerHTML = villageY
        $villagePoints.innerHTML = villagePoints.toLocaleString('pt-BR')
        $playerName.innerHTML = playerName || '-'
        $playerPoints.innerHTML = playerPoints ? playerPoints.toLocaleString('pt-BR') : 0
        $playerVillages.innerHTML = playerVillages ? `(${playerVillages.toLocaleString('pt-BR')} <span class="village mini-icon"></span>)` : ''
        $tribeName.innerHTML = tribeName || '-'
        $tribeTag.innerHTML = tribeTag || '-'
        $tribePoints.innerHTML = tribePoints ? tribePoints.toLocaleString('pt-BR') : 0
        $tribeVillages.innerHTML = tribeVillages ? `(${tribeVillages.toLocaleString('pt-BR')} <span class="village mini-icon"></span>)` : ''
        $provinceName.innerHTML = provinceName
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
