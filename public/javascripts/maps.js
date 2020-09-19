const TW2Map = function (containerSelector, dataLoader) {
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

    let {
        width: viewportWidth,
        height: viewportHeight
    } = $container.getBoundingClientRect()

    const mapWidth = 1000 * tileSize
    const mapHeight = 1000 * tileSize

    let offsetX = Math.floor(viewportWidth / 2)
    let offsetY = Math.floor(viewportHeight / 2)

    let positionX = 500 * tileSize
    let positionY = 500 * tileSize

    let mouseCoordX = 0
    let mouseCoordY = 0

    let activeVillage = false

    const setupElements = function () {
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
                loadVisibleContinents()
            }
        })

        $overlay.addEventListener('mousemove', function (event) {
            mouseCoordX = Math.floor((positionX - offsetX + event.pageX) / tileSize)
            mouseCoordY = Math.floor((positionY - offsetY + event.pageY) / tileSize)

            const villagesX = dataLoader.villages[mouseCoordX]

            if (villagesX) {
                const village = villagesX[mouseCoordY]

                if (village) {
                    return setActiveVillage(village)
                }
            }

            return unsetActiveVillage()
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
    }

    const unsetActiveVillage = function () {
        if (!activeVillage) {
            return
        }

        activeVillage = false

        $overlayContext.clearRect(0, 0, viewportWidth, viewportHeight)
    }

    const loadVisibleContinents = function () {
        const visibleContinents = []

        let ax = boundNumber(((positionX - offsetX) / tileSize), 0, 999)
        let ay = boundNumber(((positionY - offsetY) / tileSize), 0, 999)
        let bx = boundNumber(((positionX + offsetX) / tileSize), 0, 999)
        let by = boundNumber(((positionY + offsetY) / tileSize), 0, 999)

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

        $cacheContext.fillStyle = 'rgba(0,0,0,0.3)'

        $cacheContext.fillRect(0, 0, 1, mapWidth)
        $cacheContext.fillRect(0, 0, mapWidth, 1)

        for (let i = 1; i < 11; i++) {
            $cacheContext.fillRect(i * 100 * tileSize - 1, 0, 1, mapWidth)
            $cacheContext.fillRect(0, i * 100 * tileSize - 1, mapWidth, 1)
        }

        $cacheContext.fillStyle = 'rgba(0,0,0,0.1)'

        for (let i = 1; i < 100; i++) {
            $cacheContext.fillRect(i * 10 * tileSize - 1, 0, 1, mapWidth)
            $cacheContext.fillRect(0, i * 10 * tileSize - 1, mapWidth, 1)
        }
    }

    const renderVillages = function (villages) {
        for (let x in villages) {
            for (let y in villages[x]) {
                let [id, name, points, character_id] = villages[x][y]

                $cacheContext.fillStyle = character_id ? '#823c0a' : '#4c6f15'
                $cacheContext.fillRect(x * tileSize, y * tileSize, villageSize, villageSize)
            }
        }

        renderViewport()
    }

    const renderViewport = function () {
        $viewportContext.fillStyle = '#436213'
        $viewportContext.fillRect(0, 0, mapWidth, mapHeight)

        const positionXcenter = Math.floor(positionX - offsetX)
        const positionYcenter = Math.floor(positionY - offsetY)

        $viewportContext.drawImage($cache, -positionXcenter, -positionYcenter)
    }

    const renderOverlay = function () {
        $overlayContext.clearRect(0, 0, viewportWidth, viewportHeight)

        if (!activeVillage) {
            return
        }

        const borderX = Math.abs(positionX - (activeVillage.x * tileSize) - offsetX) - 1
        const borderY = Math.abs(positionY - (activeVillage.y * tileSize) - offsetY) - 1
        const borderSize = villageSize + 2

        $overlayContext.fillStyle = 'rgba(255, 255, 255, 0.5)'
        $overlayContext.fillRect(borderX, borderY - 1, borderSize, 1)
        $overlayContext.fillRect(borderX + borderSize, borderY, 1, borderSize)
        $overlayContext.fillRect(borderX, borderY + borderSize, borderSize, 1)
        $overlayContext.fillRect(borderX - 1, borderY, 1, borderSize)

        const characterId = activeVillage.character_id

        if (!characterId) {
            return
        }

        $overlayContext.fillStyle = 'white'

        for (let village of dataLoader.playerVillages[characterId]) {
            let x = Math.abs(positionX - (village[0] * tileSize) - offsetX)
            let y = Math.abs(positionY - (village[1] * tileSize) - offsetY)
            $overlayContext.fillRect(x, y, villageSize, villageSize)
        }
    }

    const continuousRender = function () {
        if (renderEnabled) {
            renderViewport()
        }

        requestAnimationFrame(continuousRender)
    }

    this.recalcSize = function () {        
        ({
            width: viewportWidth,
            height: viewportHeight
        } = $container.getBoundingClientRect())

        offsetX = Math.floor(viewportWidth / 2)
        offsetY = Math.floor(viewportHeight / 2)

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

    setupElements()
    mouseEvents()
    renderGrid()
    loadVisibleContinents()
    dataLoader.loadPlayers()
    dataLoader.loadTribes()
    continuousRender()
}

const DataLoader = function (marketId, worldNumber) {
    let loadedPlayers = false
    let loadedTribes = false

    this.players = {}
    this.tribes = {}
    this.continents = {}
    this.villages = {}
    this.villages.x = {}
    this.playerVillages = {}

    const mergeVillages = function (villages) {
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

    this.loadPlayers = async function () {
        if (!loadedPlayers) {
            const players = await fetch(`/maps/api/${marketId}/${worldNumber}/players`)
            this.players = await players.json()
            loadedPlayers = true
        }

        return this.players
    }

    this.loadTribes = async function () {
        if (!loadedTribes) {
            const tribes = await fetch(`/maps/api/${marketId}/${worldNumber}/tribes`)
            this.tribes = await tribes.json()
            loadedTribes = true
        }

        return this.tribes
    }

    this.loadContinent = async function (continent) {
        if (typeof continent !== 'number' || continent < 0 || continent > 99) {
            throw new Error('Invalid continent value')
        }

        if (!(continent in this.continents)) {
            const load = await fetch(`/maps/api/${marketId}/${worldNumber}/continent/${continent}`)
            const villages = await load.json()
            this.continents[continent] = villages
            mergeVillages.call(this, villages)

            return this.continents[continent]
        }

        return {}
    }
}

;(async function () {
    let reInitTimeout

    data = new DataLoader(marketId, worldNumber)
    map = new TW2Map('#map', data)

    window.addEventListener('resize', function () {
        clearTimeout(reInitTimeout)
        reInitTimeout = setTimeout(() => map.recalcSize(), 200)
    })
})();

