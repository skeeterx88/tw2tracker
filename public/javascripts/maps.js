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

    const { width, height } = $container.getBoundingClientRect()
    let viewportWidth = width ? width : window.innerWidth
    let viewportHeight = height ? height : window.innerHeight

    const mapWidth = 1000 * tileSize
    const mapHeight = 1000 * tileSize

    let offsetX = Math.floor(viewportWidth / 2)
    let offsetY = Math.floor(viewportHeight / 2)

    let positionX = 500 * tileSize
    let positionY = 500 * tileSize

    let mouseCoordX = 0
    let mouseCoordY = 0

    let activeVillage = false

    const CUSTOM_CATEGORIES = {
        players: 'players',
        tribes: 'tribes'
    }

    const customColors = {
        [CUSTOM_CATEGORIES.players]: {},
        [CUSTOM_CATEGORIES.tribes]: {}
    }

    const COLORS = {
        neutral: '#823c0a',
        barbarian: '#4c6f15',
        background: '#436213'
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

                let tribeId = character_id ? dataLoader.players[character_id][1] : false

                if (!character_id) {
                    $cacheContext.fillStyle = COLORS.barbarian
                } else if (character_id in customColors.players) {
                    $cacheContext.fillStyle = customColors.players[character_id].color
                } else if (tribeId && tribeId in customColors.tribes) {
                    $cacheContext.fillStyle = customColors.tribes[tribeId].color
                } else {
                    $cacheContext.fillStyle = COLORS.neutral
                }

                $cacheContext.fillRect(x * tileSize, y * tileSize, villageSize, villageSize)
            }
        }

        renderViewport()
    }

    const renderViewport = function () {
        $viewportContext.fillStyle = COLORS.background
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

        for (let [x, y] of dataLoader.playerVillages[characterId]) {
            x = x * tileSize - positionX + offsetX
            y = y * tileSize - positionY + offsetY

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
        for (let [x, y] of villagesId) {
            scope[x] = scope[x] || {}
            scope[x][y] = dataLoader.villages[x][y]
        }
    }

    const customColorGetRealId = function (category, id) {
        const lowerId = id.toLowerCase()

        switch (category) {
            case CUSTOM_CATEGORIES.players: {
                if (dataLoader.playersByName.hasOwnProperty(lowerId)) {
                    return dataLoader.playersByName[lowerId]
                } else {
                    throw new Error('Custom colors: Player ' + id + ' not found')
                }

                break
            }
            case CUSTOM_CATEGORIES.tribes: {
                if (dataLoader.tribesByTag.hasOwnProperty(lowerId)) {
                    return dataLoader.tribesByTag[lowerId]
                } else if (dataLoader.tribesByName.hasOwnProperty(lowerId)) {
                    return dataLoader.tribesByName[lowerId]
                } else {
                    throw new Error('Custom colors: Tribe ' + id + ' not found')
                }

                break
            }
            default: {
                throw new Error('Custom colors: Invalid category')
            }
        }
    }

    const getVillagesToDraw = function (category, realId) {
        let redrawVillages = {
            x: {}
        }

        console.log('category', category, 'CUSTOM_CATEGORIES.tribes', CUSTOM_CATEGORIES.tribes)

        switch (category) {
            case CUSTOM_CATEGORIES.players: {
                formatVillagesToDraw(dataLoader.playerVillages[realId], redrawVillages)
                break
            }
            case CUSTOM_CATEGORIES.tribes: {
                for (let playerId of dataLoader.tribePlayers[realId]) {
                    formatVillagesToDraw(dataLoader.playerVillages[playerId], redrawVillages)
                }

                break
            }
            default: {
                throw new Error('Custom colors: Invalid category')
            }
        }

        return redrawVillages
    }

    this.recalcSize = function () {        
        const { width, height } = $container.getBoundingClientRect()
        viewportWidth = width ? width : window.innerWidth
        viewportHeight = height ? height : window.innerHeight

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

    this.addCustom = function (category, id, color) {
        if (typeof id !== 'string') {
            throw new Error('Custom colors: Invalid id')
        }

        const realId = customColorGetRealId(category, id)
        const redrawVillages = getVillagesToDraw(category, realId)

        customColors[category][realId] = {
            display: id,
            color: color
        }

        renderVillages(redrawVillages)
    }

    this.removeCustom = function (category, id) {
        if (typeof id !== 'string') {
            throw new Error('Custom colors: Invalid id')
        }

        const realId = customColorGetRealId(category, id)
        const redrawVillages = getVillagesToDraw(category, realId)

        delete customColors[category][realId]

        renderVillages(redrawVillages)
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
}

const DataLoader = function (marketId, worldNumber) {
    const self = this
    let loadedPlayers = false
    let loadedTribes = false
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
        if (!loadedPlayers) {
            loadedPlayers = true
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
        }

        resolve()
    })

    this.loadTribes = new Promise(async function (resolve) {
        if (!loadedTribes) {
            loadedTribes = true
            const tribes = await fetch(`/maps/api/${marketId}/${worldNumber}/tribes`)
            self.tribes = await tribes.json()

            for (let id in self.tribes) {
                let [name, tag, points] = self.tribes[id]
                self.tribesByName[name.toLowerCase()] = parseInt(id, 10)
                self.tribesByTag[tag.toLowerCase()] = parseInt(id, 10)
            }
        }

        resolve()
    })

    this.loadContinent = async function (continent) {
        if (typeof continent !== 'number' || continent < 0 || continent > 99) {
            throw new Error('Invalid continent value')
        }

        if (continentPromises.hasOwnProperty(continent)) {
            return continentPromises
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

const userInterface = function () {
    const colorPalette = [
        ["ffffff", "ffd1d1", "aee7ff", "c0ffd0", "ffe7cf", "fff9a1", "ffdaee", "ffd5b6", "dfceff", "cde4ff", "d8dcff", "ffcff8", "f0c800", "ff4b4b"],
        ["dfdfdf", "e21f1f", "03709d", "0a8028", "aa6b2b", "ffee00", "b2146b", "d96a19", "5c32a9", "47617f", "0111af", "d315b6", "8888fc", "ce8856"],
        ["e0ff4c", "980e0e", "014a69", "04571a", "7f5122", "7b730c", "870d50", "a44c0b", "452483", "2a3e55", "000b74", "9d0886", "00a0f4", "969696"],
        ["000000", "730202", "00293a", "02350f", "572412", "494500", "6a043e", "723305", "2f1460", "152232", "000645", "6c055b", "c766c7", "74c374"]
    ]

    $customColorId = document.getElementById('custom-color-id')
    $customColorItems = document.getElementById('custom-color-items')

    const autocompleteInstance = new autoComplete({
        data: {
            src: async function () {
                await data.loadPlayers
                await data.loadTribes

                const matches = []

                for (let [name] of Object.values(data.players)) {
                    matches.push({
                        search: name,
                        id: name,
                        type: 'players'
                    })
                }

                for (let [name, tag] of Object.values(data.tribes)) {
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
        selector: '#custom-color-id',
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
            $autoCompleteList.appendChild($item)
        },
        placeHolder: 'search...',
        highlight: true,
        onSelection: function (feedback) {
            const { id, type } = feedback.selection.value
            const color = '#' + arrayRandom(colorPalette.flat())

            map.addCustom(type, id, color)
            $customColorId.value = ''
        }
    })

    const $autoCompleteList = document.getElementById('autoComplete_list')

    $customColorId.addEventListener('blur', function () {
        $autoCompleteList.style.display = 'none'
    })

    $customColorId.addEventListener('focus', function () {
        $autoCompleteList.style.display = ''
    })

    $customColorId.addEventListener('keydown', async function (event) {
        if (event.key === 'Escape') {
            $customColorId.value = ''
            $customColorId.dispatchEvent(new Event('input'))
        }
    })

    $customColorId.addEventListener('autoComplete', function ({ detail }) {
        if (detail.event.key == 'Enter' && detail.matches > 0) {
            autocompleteInstance.listMatchedResults(autocompleteInstance.dataStream).then(function () {
                const first = autocompleteInstance.resultsList.view.children.item(0)
                first.dispatchEvent(new Event('mousedown'))
            })
        }
    })
}

;(async function () {
    let reInitTimeout

    data = new DataLoader(marketId, worldNumber)
    map = new TW2Map('#map', data)

    window.addEventListener('resize', function () {
        clearTimeout(reInitTimeout)
        reInitTimeout = setTimeout(() => map.recalcSize(), 200)
    })

    userInterface()
})()

