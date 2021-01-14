/**
 * This function is evaluated inside the game's page context via puppeteer's page.evaluate()
 */
module.exports = async function () {
    const socketService = injector.get('socketService')
    const routeProvider = injector.get('routeProvider')
    const RANKING_QUERY_COUNT = 25

    const achievementsMap = {
        players: {
            router: routeProvider.ACHIEVEMENT_GET_CHAR_ACHIEVEMENTS,
            key: 'character_id'
        },
        tribes: {
            router: routeProvider.ACHIEVEMENT_GET_TRIBE_ACHIEVEMENTS,
            key: 'tribe_id'
        }
    }
    
    const playerIds = new Set()
    const tribeIds = new Set()
    const achievementsData = {
        players: new Map(),
        tribes: new Map()
    }

    const sleep = function (ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, typeof ms === 'number' ? ms : 1000)
        })
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
                    tribeIds.add(tribe.tribe_id)
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

            await sleep(150)
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
                    playerIds.add(player.character_id)
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

            await sleep(150)
        }
    }

    const loadAchievements = function (type, id) {
        return new Promise(function (resolve) {
            if (!id) {
                return resolve()
            }

            const {
                router,
                key
            } = achievementsMap[type]

            socketService.emit(router, {
                [key]: id
            }, function ({achievements}) {
                achievementsData[type].set(id, achievements.filter(achievement => achievement.level))
                resolve()
            })
        })
    }

    const loadTribesAchievements = async function () {
        const tribeIdsArray = Array.from(tribeIds.values())

        for (let i = 0, l = tribeIdsArray.length; i < l; i += 4) {
            await Promise.all([
                loadAchievements('tribes', tribeIdsArray[i]),
                loadAchievements('tribes', tribeIdsArray[i + 1]),
                loadAchievements('tribes', tribeIdsArray[i + 2]),
                loadAchievements('tribes', tribeIdsArray[i + 3])
            ])
        }
    }

    const loadPlayersAchievements = async function () {
        const playerIdsArray = Array.from(playerIds.values())

        for (let i = 0, l = playerIdsArray.length; i < l; i += 4) {
            await Promise.all([
                loadAchievements('players', playerIdsArray[i]),
                loadAchievements('players', playerIdsArray[i + 1]),
                loadAchievements('players', playerIdsArray[i + 2]),
                loadAchievements('players', playerIdsArray[i + 3])
            ])
        }
    }

    await processTribes()
    await processPlayers()
    await loadTribesAchievements()
    await loadPlayersAchievements()

    return {
        players: Array.from(achievementsData.players),
        tribes: Array.from(achievementsData.tribes)
    }
}
