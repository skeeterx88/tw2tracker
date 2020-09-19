/**
 * This function is evaluated inside the game's page context via puppeteer's page.evaluate()
 */
module.exports = function (marketId, worldNumber) {
    console.log('Scrapper: Start scrapping', marketId + worldNumber)

    const readyState = function (callback) {
        console.log('Scrapper: readyState()')

        return new Promise(function (resolve, reject) {
            let injectorTimeout
            let timeout

            timeout = setTimeout(function () {
                console.log('Scrapper: readyState: timeout!')

                clearTimeout(injectorTimeout)

                if (document.querySelector('.modal-establish-village')) {
                    console.log('Scrapper: readyState: element modal-establish-village found!')

                    return resolve()
                }

                const transferredSharedDataService = injector.get('transferredSharedDataService')
                const mapScope = transferredSharedDataService.getSharedData('MapController')

                if (mapScope && mapScope.isInitialized) {
                    console.log('Scrapper: readyState: map is initialized!')

                    resolve()
                } else {
                    reject()
                }
            }, 10000)

            const waitForInjector = function (callback) {
                if (typeof injector === 'undefined') {
                    setTimeout(waitForInjector, 100)
                } else {
                    callback()
                }
            }

            console.log('Scrapper: readyState: waiting for injector...')

            waitForInjector(function () {
                console.log('Scrapper: readyState: waiting for CHARACTER_INFO trigger...')

                const $rootScope = injector.get('$rootScope')
                const eventTypeProvider = injector.get('eventTypeProvider')

                $rootScope.$on(eventTypeProvider.CHARACTER_INFO, function () {
                    clearTimeout(timeout)
                    clearTimeout(injectorTimeout)

                    console.log('Scrapper: readyState: OK')

                    resolve()
                })
            })
        })
    }

    const Scrapper = async function () {
        const $rootScope = injector.get('$rootScope')
        const socketService = injector.get('socketService')
        const eventTypeProvider = injector.get('eventTypeProvider')
        const routeProvider = injector.get('routeProvider')

        const worldData = {
            villages: {},
            villagesByPlayer: {},
            players: {},
            tribes: {}
        }

        const BLOCK_SIZE = 50

        // const refCoordsAll = [
        //     [0, 0], [100, 0], [200, 0], [300, 0], [400, 0],
        //     [500, 0], [600, 0], [700, 0], [800, 0], [900, 0],
        //     [0, 100], [100, 100], [200, 100], [300, 100], [400, 100],
        //     [500, 100], [600, 100], [700, 100], [800, 100], [900, 100],
        //     [0, 200], [100, 200], [200, 200], [300, 200], [400, 200],
        //     [500, 200], [600, 200], [700, 200], [800, 200], [900, 200],
        //     [0, 300], [100, 300], [200, 300], [300, 300], [400, 300],
        //     [500, 300], [600, 300], [700, 300], [800, 300], [900, 300],
        //     [0, 400], [100, 400], [200, 400], [300, 400], [400, 400],
        //     [500, 400], [600, 400], [700, 400], [800, 400], [900, 400],
        //     [0, 500], [100, 500], [200, 500], [300, 500], [400, 500],
        //     [500, 500], [600, 500], [700, 500], [800, 500], [900, 500],
        //     [0, 600], [100, 600], [200, 600], [300, 600], [400, 600],
        //     [500, 600], [600, 600], [700, 600], [800, 600], [900, 600],
        //     [0, 700], [100, 700], [200, 700], [300, 700], [400, 700],
        //     [500, 700], [600, 700], [700, 700], [800, 700], [900, 700],
        //     [0, 800], [100, 800], [200, 800], [300, 800], [400, 800],
        //     [500, 800], [600, 800], [700, 800], [800, 800], [900, 800],
        //     [0, 900], [100, 900], [200, 900], [300, 900], [400, 900],
        //     [500, 900], [600, 900], [700, 900], [800, 900], [900, 900]
        // ]

        const refCoords = {
            topLeft: [
                [0, 0], [100, 0], [200, 0], [300, 0],
                [0, 100], [100, 100], [200, 100], [300, 100],
                [0, 200], [100, 200], [200, 200], [300, 200],
                [0, 300], [100, 300], [200, 300], [300, 300]
            ],
            topRight: [
                [600, 0], [700, 0], [800, 0], [900, 0],
                [600, 100], [700, 100], [800, 100], [900, 100],
                [600, 200], [700, 200], [800, 200], [900, 200],
                [600, 300], [700, 300], [800, 300], [900, 300]
            ],
            bottomLeft: [
                [0, 600], [100, 600], [200, 600], [300, 600],
                [0, 700], [100, 700], [200, 700], [300, 700],
                [0, 800], [100, 800], [200, 800], [300, 800],
                [0, 900], [100, 900], [200, 900], [300, 900]
            ],
            bottomRight: [
                [600, 600], [700, 600], [800, 600], [900, 600],
                [600, 700], [700, 700], [800, 700], [900, 700],
                [600, 800], [700, 800], [800, 800], [900, 800],
                [600, 900], [700, 900], [800, 900], [900, 900]
            ]
        }

        const boundarieRefCoords = {
            left: [
                [400, 400], [400, 500], [300, 400], [300, 500],
                [200, 400], [200, 500], [100, 400], [100, 500],
                [0, 400], [0, 500]
            ],
            right: [
                [500, 400], [500, 500], [600, 400], [600, 500],
                [700, 400], [700, 500], [800, 400], [800, 500],
                [900, 400], [900, 500]
            ],
            top: [
                [400, 300], [500, 300], [400, 200], [500, 200],
                [400, 100], [500, 100], [400, 0], [500, 0]
            ],
            bottom: [
                [400, 600], [500, 600], [400, 700], [500, 700],
                [400, 800], [500, 800], [400, 900], [500, 900]
            ]
        }

        const init = async function () {
            // assert(function () {
            //     const result = filterBlocks({
            //         left: { x: 200 },
            //         right: { x: 700 },
            //         top: { y: 200 },
            //         bottom: { y: 700 }
            //     });

            //     const expect = [
            //         [200, 200],[300, 200],[200, 300],[300, 300],
            //         [600, 200],[700, 200],[600, 300],[700, 300],
            //         [200, 600],[300, 600],[200, 700],[300, 700],
            //         [600, 600],[700, 600],[600, 700],[700, 700],
            //     ]

            //     return JSON.stringify(result) === JSON.stringify(expect)
            // })

            // assert(function () {
            //     const result = filterBlocks({
            //         left: { x: 300, y: 0 },
            //         right: { x: 700, y: 0 },
            //         top: { x: 0, y: 300 },
            //         bottom: { x: 0, y: 700 }
            //     });

            //     const expect = [
            //         [300, 300],[600, 300],[700, 300],[300, 600],
            //         [300, 700],[600, 600],[700, 600],[600, 700],
            //         [700, 700]
            //     ]

            //     return JSON.stringify(result) === JSON.stringify(expect)
            // })

            const boundaries = await getBoundaries()
            const missingBlocks = filterBlocks(boundaries)

            for (let i = 0; i < missingBlocks.length; i++) {
                const [x, y] = missingBlocks[i]

                await loadMapChunk(x, y)
            }

            processFinish()

            return worldData

            console.log('Scrapper: Finished scrapping', marketId + worldNumber)
        }

        const getBoundaries = async function () {
            const boundaries = {
                left: 500,
                right: 500,
                top: 500,
                bottom: 500
            }

            for (let side of ['left', 'right', 'top', 'bottom']) {
                for (let i = 0; i < boundarieRefCoords[side].length; i++) {
                    const [x, y] = boundarieRefCoords[side][i]
                    const villageCount = await loadMapChunk(x, y)

                    if (!villageCount) {
                        break
                    }

                    boundaries[side] = (side === 'left' || side === 'right') ? x : y
                }
            }

            return boundaries
        }

        const filterBlocks = function (boundaries) {
            return [
                ...refCoords.topLeft.filter(([x, y]) => x >= boundaries.left && y >= boundaries.top),
                ...refCoords.topRight.filter(([x, y]) => x <= boundaries.right && y >= boundaries.top),
                ...refCoords.bottomLeft.filter(([x, y]) => x >= boundaries.left  && y <= boundaries.bottom),
                ...refCoords.bottomRight.filter(([x, y]) => x <= boundaries.right && y <= boundaries.bottom)
            ]
        }

        const assert = function (conditionHandler) {
            if (conditionHandler() !== true) {
                throw new Error('Assertion failed');
            }
        }

        const loadVillages = function (x, y) {
            return new Promise(function (resolve) {
                socketService.emit(routeProvider.MAP_GETVILLAGES, {
                    x: x,
                    y: y,
                    width: BLOCK_SIZE,
                    height: BLOCK_SIZE
                }, resolve)
            })
        }

        const loadMapChunk = async function (x, y) {
            const chunks = [
                await loadVillages(x, y),
                await loadVillages(x + BLOCK_SIZE, y),
                await loadVillages(x, y + BLOCK_SIZE),
                await loadVillages(x + BLOCK_SIZE, y + BLOCK_SIZE)
            ]

            let loadedVillages = 0

            for (let chunk of chunks) {
                processVillages(chunk)
                loadedVillages += chunk.villages.length
            }

            return loadedVillages
        }

        const hasPlayer = function (pid) {
            return !!worldData.players.hasOwnProperty(pid)
        }

        const hasTribe = function (tid) {
            return tid && !!worldData.tribes.hasOwnProperty(tid)
        }

        const setTribe = function (v) {
            worldData.tribes[v.tribe_id] = [
                v.tribe_name,
                v.tribe_tag,
                v.tribe_points
            ]
        }

        const setPlayer = function (v, pid, tid) {
            worldData.players[pid] = [
                v.character_name,
                v.character_points
            ]

            if (tid) {
                worldData.players[pid].push(tid)
            }
        }

        const setVillage = function (v) {
            worldData.villages[v.x] = worldData.villages[v.x] || {}
            worldData.villages[v.x][v.y] = [
                v.id,
                v.name,
                v.points,
                v.character_id || 0
            ]
        }

        const processVillages = function (blockData) {
            console.log('Scrapper:', 'Processing block', blockData.x, blockData.y, 'Villages:', blockData.villages.length)

            if (!blockData.villages.length) {
                return
            }

            blockData.villages.forEach(function (v) {
                const pid = v.character_id
                const tid = v.tribe_id

                setVillage(v)

                if (pid) {
                    if (!hasPlayer(pid)) {
                        setPlayer(v, pid, tid)
                    }

                    if (tid && !hasTribe(tid)) {
                        setTribe(v, tid)
                    }
                }
            })
        }

        const processFinish = function () {
            for (let pid in worldData.players) {
                worldData.villagesByPlayer[pid] = []
            }

            for (let x in worldData.villages) {
                for (let y in worldData.villages[x]) {
                    const v = worldData.villages[x][y]

                    if (!v[3]) {
                        continue
                    }

                    worldData.villagesByPlayer[v[3]].push([
                        parseInt(x, 10),
                        parseInt(y, 10)
                    ])
                }
            }
        }

        return await init()
    }

    return new Promise(async function (resolve, reject) {
        try {
            await readyState()
        } catch (error) {
            return reject('Scrapper: Couldn\'t get ready state.')
        }

        const worldData = await Scrapper()

        resolve(worldData)
    })
}
