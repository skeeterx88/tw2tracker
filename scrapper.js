/**
 * This function is evaluated inside the game's page context via puppeteer's page.evaluate()
 */
module.exports = function () {
    const socketService = injector.get('socketService')
    const eventTypeProvider = injector.get('eventTypeProvider')
    const routeProvider = injector.get('routeProvider')
    const transferredSharedDataService = injector.get('transferredSharedDataService')
    const $timeHelper = require('helper/time')

    const worldData = {
        villages: {},
        villagesByPlayer: {},
        players: {},
        tribes: {}
    }

    const BLOCK_SIZE = 50

    const refBlocksAll = [
        [0, 0], [100, 0], [200, 0], [300, 0], [400, 0],
        [500, 0], [600, 0], [700, 0], [800, 0], [900, 0],
        [0, 100], [100, 100], [200, 100], [300, 100], [400, 100],
        [500, 100], [600, 100], [700, 100], [800, 100], [900, 100],
        [0, 200], [100, 200], [200, 200], [300, 200], [400, 200],
        [500, 200], [600, 200], [700, 200], [800, 200], [900, 200],
        [0, 300], [100, 300], [200, 300], [300, 300], [400, 300],
        [500, 300], [600, 300], [700, 300], [800, 300], [900, 300],
        [0, 400], [100, 400], [200, 400], [300, 400], [400, 400],
        [500, 400], [600, 400], [700, 400], [800, 400], [900, 400],
        [0, 500], [100, 500], [200, 500], [300, 500], [400, 500],
        [500, 500], [600, 500], [700, 500], [800, 500], [900, 500],
        [0, 600], [100, 600], [200, 600], [300, 600], [400, 600],
        [500, 600], [600, 600], [700, 600], [800, 600], [900, 600],
        [0, 700], [100, 700], [200, 700], [300, 700], [400, 700],
        [500, 700], [600, 700], [700, 700], [800, 700], [900, 700],
        [0, 800], [100, 800], [200, 800], [300, 800], [400, 800],
        [500, 800], [600, 800], [700, 800], [800, 800], [900, 800],
        [0, 900], [100, 900], [200, 900], [300, 900], [400, 900],
        [500, 900], [600, 900], [700, 900], [800, 900], [900, 900]
    ]

    const refBlocks = {
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

    const crossRefBlocks = {
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

    const ready = function (callback) {
        const mapScope = transferredSharedDataService.getSharedData('MapController')

        if (!mapScope) {
            return setTimeout(function () {
                ready(callback)
            }, 250)
        }

        if (mapScope.isInitialized) {
            return callback()
        }

        rootScope.$on(eventTypeProvider.MAP_INITIALIZED, callback)
    }

    const getBondaries = async function () {
        const bondaries = {
            left: {x: 500, y: 500},
            right: {x: 500, y: 500},
            top: {x: 500, y: 500},
            bottom: {x: 500, y: 500}
        }

        const sides = ['left', 'right', 'top', 'bottom']

        for (let i = 0; i < sides.length; i++) {
            const side = sides[i]

            for (let j = 0; j < crossRefBlocks[side].length; j++) {
                const [x, y] = crossRefBlocks[side][j]
                const [firstBlock, secondBlock] = await loadBlock(x, y)

                processBlock(firstBlock)
                processBlock(secondBlock)

                if (firstBlock.villages.length + secondBlock.villages.length) {
                    bondaries[side].x = x
                    bondaries[side].y = y
                } else {
                    break
                }
            }
        }

        return bondaries
    }

    const filterBlocks = function (bondaries) {
        return [
            ...refBlocks.topLeft.filter(([x, y]) => x >= bondaries.left.x  && y >= bondaries.top.y),
            ...refBlocks.topRight.filter(([x, y]) => x <= bondaries.right.x && y >= bondaries.top.y),
            ...refBlocks.bottomLeft.filter(([x, y]) => x >= bondaries.left.x  && y <= bondaries.bottom.y),
            ...refBlocks.bottomRight.filter(([x, y]) => x <= bondaries.right.x && y <= bondaries.bottom.y)
        ]
    }

    const assert = function (conditionHandler) {
        if (conditionHandler() !== true) {
            throw new Error('Assertion failed');
        }
    }

    const loadBlock = function (x, y) {
        return new Promise(function (resolve) {
            socketService.emit(routeProvider.MAP_GETVILLAGES, {
                x: x,
                y: y,
                width: BLOCK_SIZE,
                height: BLOCK_SIZE
            }, function (firstBlock) {
                socketService.emit(routeProvider.MAP_GETVILLAGES, {
                    x: x + BLOCK_SIZE,
                    y: y + BLOCK_SIZE,
                    width: BLOCK_SIZE,
                    height: BLOCK_SIZE
                }, function (secondBlock) {
                    resolve([ firstBlock, secondBlock ])
                })
            })
        })
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

    const processBlock = function (blockData) {
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

                if (!hasTribe(tid)) {
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

        worldData.updated = $timeHelper.gameDate().toLocaleString('pt-BR')
    }

    return new Promise(function (resolve, reject) {
        ready(async function () {
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

            const bondaries = await getBondaries()
            const missingBlocks = filterBlocks(bondaries)

            for (let i = 0; i < missingBlocks.length; i++) {
                const [x, y] = missingBlocks[i]
                const [firstBlock, secondBlock] = await loadBlock(x, y)

                processBlock(firstBlock)
                processBlock(secondBlock)
            }

            processFinish()

            resolve(worldData)
        })
    })
}
