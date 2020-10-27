/**
 * This function is evaluated inside the game's page context via puppeteer's page.evaluate()
 */
module.exports = async function () {
    const socketService = injector.get('socketService')
    const routeProvider = injector.get('routeProvider')
    const RANKING_QUERY_COUNT = 25
    const CHUNK_SIZE = 50
    const COORDS_REFERENCE = {
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
    const BOUNDARIE_REFERENCE_COORDS = {
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

    const playersByTribe = new Map()
    const villagesByPlayer = new Map()
    const villages = new Map()
    const tribes = new Map()
    const players = new Map()
    const provinces = new Map()

    const sleep = function (ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, typeof ms === 'number' ? ms : 1000)
        })
    }

    const runTest = function () {
        const assert = function (conditionHandler) {
            if (conditionHandler() !== true) {
                throw new Error('Assertion failed')
            }
        }

        assert(function () {
            const result = filterBlocks({
                left: { x: 200 },
                right: { x: 700 },
                top: { y: 200 },
                bottom: { y: 700 }
            })

            const expect = [
                [200, 200],[300, 200],[200, 300],[300, 300],
                [600, 200],[700, 200],[600, 300],[700, 300],
                [200, 600],[300, 600],[200, 700],[300, 700],
                [600, 600],[700, 600],[600, 700],[700, 700],
            ]

            return JSON.stringify(result) === JSON.stringify(expect)
        })

        assert(function () {
            const result = filterBlocks({
                left: { x: 300, y: 0 },
                right: { x: 700, y: 0 },
                top: { x: 0, y: 300 },
                bottom: { x: 0, y: 700 }
            })

            const expect = [
                [300, 300],[600, 300],[700, 300],[300, 600],
                [300, 700],[600, 600],[700, 600],[600, 700],
                [700, 700]
            ]

            return JSON.stringify(result) === JSON.stringify(expect)
        })
    }

    const getBoundaries = async function () {
        const boundaries = {
            left: 500,
            right: 500,
            top: 500,
            bottom: 500
        }

        for (let side of ['left', 'right', 'top', 'bottom']) {
            for (let i = 0; i < BOUNDARIE_REFERENCE_COORDS[side].length; i++) {
                const [x, y] = BOUNDARIE_REFERENCE_COORDS[side][i]

                if (await loadContinent(x, y) === 0) {
                    break
                }

                boundaries[side] = (side === 'left' || side === 'right') ? x : y
            }
        }

        return boundaries
    }

    const filterBlocks = function (boundaries) {
        return [
            ...COORDS_REFERENCE.topLeft.filter(([x, y]) => x >= boundaries.left && y >= boundaries.top),
            ...COORDS_REFERENCE.topRight.filter(([x, y]) => x <= boundaries.right && y >= boundaries.top),
            ...COORDS_REFERENCE.bottomLeft.filter(([x, y]) => x >= boundaries.left  && y <= boundaries.bottom),
            ...COORDS_REFERENCE.bottomRight.filter(([x, y]) => x <= boundaries.right && y <= boundaries.bottom)
        ]
    }

    const loadVillageSection = function (x, y) {
        return new Promise(function (resolve) {
            socketService.emit(routeProvider.MAP_GETVILLAGES, {
                x: x,
                y: y,
                width: CHUNK_SIZE,
                height: CHUNK_SIZE
            }, function (section) {
                processVillages(section.villages)
                resolve(section.villages.length)
            })
        })
    }

    const loadContinent = async function (x, y) {
        const loadVillages = await Promise.all([
            loadVillageSection(x, y),
            loadVillageSection(x + CHUNK_SIZE, y),
            loadVillageSection(x, y + CHUNK_SIZE),
            loadVillageSection(x + CHUNK_SIZE, y + CHUNK_SIZE)
        ])

        return loadVillages.reduce((sum, value) => sum + value)
    }

    const processVillages = function (rawVillages) {
        if (!rawVillages.length) {
            return
        }

        for (let village of rawVillages) {
            let province_id

            if (provinces.has(village.province_name)) {
                province_id = provinces.get(village.province_name)
            } else {
                province_id = provinces.size
                provinces.set(village.province_name, province_id)
            }

            villages.set(village.id, {
                x: village.x,
                y: village.y,
                name: village.name,
                points: village.points,
                character_id: village.character_id || null,
                province_id
            })
        }
    }

    const loadTribes = function (offset) {
        return new Promise(function (resolve) {
            socketService.emit(routeProvider.RANKING_TRIBE, {
                area_type: 'world',
                offset: offset,
                count: RANKING_QUERY_COUNT,
                order_by: 'rank',
                order_dir: 0,
                query: ''
            }, function (data) {
                for (let tribe of data.ranking) {
                    tribes.set(tribe.tribe_id, {
                        bash_points_def: tribe.bash_points_def,
                        bash_points_off: tribe.bash_points_off,
                        bash_points_total: tribe.bash_points_total,
                        members: tribe.members,
                        name: tribe.name,
                        tag: tribe.tag,
                        points: tribe.points,
                        points_per_member: tribe.points_per_member,
                        points_per_villages: tribe.points_per_villages,
                        rank: tribe.rank,
                        victory_points: tribe.victory_points,
                        villages: tribe.villages
                    })
                }

                resolve(data.total)
            })
        })
    }

    const processTribes = async function () {
        let offset = 0

        const total = await loadTribes(offset)
        offset += RANKING_QUERY_COUNT

        if (total <= RANKING_QUERY_COUNT) {
            return
        }

        for (; offset < total; offset += RANKING_QUERY_COUNT * 4) {
            await Promise.all([
                loadTribes(offset),
                loadTribes(offset + RANKING_QUERY_COUNT),
                loadTribes(offset + (RANKING_QUERY_COUNT * 2)),
                loadTribes(offset + (RANKING_QUERY_COUNT * 3)),
            ])
        }
    }

    const loadPlayers = function (offset) {
        return new Promise(function (resolve) {
            socketService.emit(routeProvider.RANKING_CHARACTER, {
                area_type: 'world',
                offset: offset,
                count: RANKING_QUERY_COUNT,
                order_by: 'rank',
                order_dir: 0,
                query: ''
            }, function (data) {
                for (let player of data.ranking) {
                    players.set(player.character_id, {
                        bash_points_def: player.bash_points_def,
                        bash_points_off: player.bash_points_off,
                        bash_points_total: player.bash_points_total,
                        name: player.name,
                        points: player.points,
                        points_per_villages: player.points_per_villages,
                        rank: player.rank,
                        tribe_id: player.tribe_id,
                        victory_points: player.victory_points,
                        villages: player.villages
                    })
                }

                resolve(data.total)
            })
        })
    }

    const processPlayers = async function () {
        let offset = 0

        const total = await loadPlayers(offset)
        offset += RANKING_QUERY_COUNT

        if (total <= RANKING_QUERY_COUNT) {
            return
        }

        for (; offset < total; offset += RANKING_QUERY_COUNT * 4) {
            await Promise.all([
                loadPlayers(offset),
                loadPlayers(offset + RANKING_QUERY_COUNT),
                loadPlayers(offset + (RANKING_QUERY_COUNT * 2)),
                loadPlayers(offset + (RANKING_QUERY_COUNT * 3)),
            ])
        }
    }

    const processVillagesByPlayer = function () {
        for (let character_id of players.keys()) {
            villagesByPlayer.set(character_id, [])
        }

        for (let [id, village] of villages.entries()) {
            const {character_id} = village

            if (character_id) {
                villagesByPlayer.get(character_id).push(id)
            }
        }
    }

    const processPlayersByTribe = function () {
        for (let tribe_id of tribes.keys()) {
            playersByTribe.set(tribe_id, [])
        }

        for (let [character_id, player] of players.entries()) {
            const {tribe_id} = player

            if (tribe_id) {
                playersByTribe.get(tribe_id).push(character_id)
            }
        }
    }

    const time = async function (name, handler) {
        const start = Date.now()
        await handler()
        console.log('Scrapper:', name, 'runtime:', (Date.now() - start) + 'ms')
    }

    await time('load villages', async function () {
        const boundaries = await getBoundaries()
        const missingBlocks = filterBlocks(boundaries)

        for (let [x, y] of missingBlocks) {
            await loadContinent(x, y)
        }
    })

    await time('load tribes', async function () {
        await processTribes()
    })

    await time('load players', async function () {
        await processPlayers()
    })

    processVillagesByPlayer()
    processPlayersByTribe()

    console.log('Scrapper: Finished (' + villages.size + ' villages, ' + players.size + ' players, ' + tribes.size + ' tribes)')

    return {
        villages: Array.from(villages),
        players: Array.from(players),
        tribes: Array.from(tribes),
        provinces: Array.from(provinces),
        villagesByPlayer: Array.from(villagesByPlayer),
        playersByTribe: Array.from(playersByTribe)
    }
}
