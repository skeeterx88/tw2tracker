/**
 * This function is evaluated inside the game's page context via puppeteer's page.evaluate()
 */
module.exports = function (marketId, worldNumber) {
    console.log('Scrapper: Start scrapping', marketId + worldNumber)

    const Scrapper = async function () {
        const socketService = injector.get('socketService')
        const routeProvider = injector.get('routeProvider')
        const hasOwn = Object.prototype.hasOwnProperty

        const worldData = {
            villages: {},
            villagesByPlayer: {},
            players: {},
            tribes: {},
            provinces: {}
        }

        let provinceId = 0

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
            // const assert = function (conditionHandler) {
            //     if (conditionHandler() !== true) {
            //         throw new Error('Assertion failed');
            //     }
            // }

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

            console.log('Scrapper: Finished scrapping', marketId + worldNumber)

            return worldData
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
            const loadChunks = [
                loadVillages(x, y),
                loadVillages(x + BLOCK_SIZE, y),
                loadVillages(x, y + BLOCK_SIZE),
                loadVillages(x + BLOCK_SIZE, y + BLOCK_SIZE)
            ]

            const chunks = await Promise.all(loadChunks)

            let loadedVillages = 0

            for (let chunk of chunks) {
                processVillages(chunk)
                loadedVillages += chunk.villages.length
            }

            console.log('Scrapper:', 'Fetched k' + coords2continent(x, y) + ', villages:', loadedVillages)

            return loadedVillages
        }

        const hasPlayer = function (pid) {
            return !!hasOwn(worldData.players, pid)
        }

        const hasTribe = function (tid) {
            return tid && !!hasOwn(worldData.tribes, tid)
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
                v.character_id || 0,
                v.province_id
            ]
        }

        const setProvince = function (provinceName) {
            if (!hasOwn(worldData.provinces, provinceName)) {
                worldData.provinces[provinceName] = provinceId++
            }

            return worldData.provinces[provinceName]
        }

        const processVillages = function (blockData) {
            if (!blockData.villages.length) {
                return
            }

            blockData.villages.forEach(function (v) {
                const pid = v.character_id
                const tid = v.tribe_id

                v.province_id = setProvince(v.province_name)

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

        const coords2continent = function (x, y) {
            let kx
            let ky

            if (x < 100) {
                kx = '0'
            } else {
                kx = String(x)[0]
            }

            if (y < 100) {
                ky = '0'
            } else {
                ky = String(y)[0]
            }

            return ky + kx
        }

        return await init()
    }

    return new Promise(async function (resolve, reject) {
        resolve(await Scrapper())
    })
}
