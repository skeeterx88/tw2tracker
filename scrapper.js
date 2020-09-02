/**
 * This function is evaluated inside the game's page context via puppeteer's page.evaluate()
 */
module.exports = function Scrapper (scrapperSettings) {
    const socketService = injector.get('socketService')
    const eventTypeProvider = injector.get('eventTypeProvider')
    const routeProvider = injector.get('routeProvider')
    const transferredSharedDataService = injector.get('transferredSharedDataService')
    const $timeHelper = require('helper/time')

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

    const Scrapper = (function () {
        const Scrapper = {}        
        let data
        let x
        let y

        const defaults = {
            allowBarbarians: true,
            includeVillagePerPlayer: false,
            finishCallback: function () {},
            includeDate: true
        }

        const BLOCK_SIZE = 50
        const MAP_SIZE = 1000
        const LAST_BLOCK = MAP_SIZE - BLOCK_SIZE

        const loadBlock = function (x, y, blockSize, callback) {
            socketService.emit(routeProvider.MAP_GETVILLAGES, {
                x: x,
                y: y,
                width: blockSize,
                height: blockSize
            }, callback)
        }

        const insertUpdateDate = function () {
            data.updated = $timeHelper.gameDate().toLocaleString('pt-BR')
        }

        const hasPlayer = function (pid) {
            return !!data.players.hasOwnProperty(pid)
        }

        const hasTribe = function (tid) {
            return tid && !!data.tribes.hasOwnProperty(tid)
        }

        const setTribe = function (v) {
            data.tribes[v.tribe_id] = [
                v.tribe_name,
                v.tribe_tag,
                v.tribe_points
            ]
        }


        const setPlayer = function (v, pid, tid) {
            data.players[pid] = [
                v.character_name,
                v.character_points
            ]

            if (tid) {
                data.players[pid].push(tid)
            }
        }

        const setVillage = function (v) {
            data.villages[v.x] = data.villages[v.x] || {}
            data.villages[v.x][v.y] = [
                v.id,
                v.name,
                v.points,
                v.character_id || 0
            ]
        }

        const process = function (raw) {
            let pid
            let tid

            raw.villages.forEach(function (v) {
                if (!settings.allowBarbarians && !v.character_id) {
                    return false
                }

                pid = v.character_id
                tid = v.tribe_id

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

        const finish = function () {
            let pid
            let x
            let y
            let v

            for (pid in data.players) {
                data.playerVillages[pid] = []
            }

            for (x in data.villages) {
                for (y in data.villages[x]) {
                    v = data.villages[x][y]

                    if (!v[3]) {
                        continue
                    }

                    data.playerVillages[v[3]].push([
                        parseInt(x, 10),
                        parseInt(y, 10)
                    ])
                }
            }
        }

        const handleLoop = function () {
            loadBlock(x, y, BLOCK_SIZE, function (raw) {
                // console.log('puppeteer::' + raw.x + ' ' + raw.y)

                if (raw.x === LAST_BLOCK) {
                    x = 0
                    y += BLOCK_SIZE
                } else {
                    x += BLOCK_SIZE
                }

                if (raw.villages.length) {
                    process(raw)
                }

                // last block finished
                if (raw.x === LAST_BLOCK && raw.y === LAST_BLOCK) {
                    if (settings.includeVillagePerPlayer) {
                        finish()
                    }

                    if (settings.includeDate) {
                        insertUpdateDate()
                    }

                    if (settings.finishCallback) {
                        settings.finishCallback(data)
                    }

                    return true
                }

                handleLoop()
            })
        }

        Scrapper.getData = function () {
            return data
        }

        Scrapper.start = function (options, callback) {
            settings = angular.extend(defaults, options)
            settings.finishCallback = callback
            data = {
                villages: {},
                playerVillages: {},
                players: {},
                tribes: {}
            }
            x = 0
            y = 0

            handleLoop()
        }

        return Scrapper
    })()

    return new Promise(function (resolve, reject) {
        ready(function () {
            Scrapper.start(scrapperSettings, function (data) {
                resolve(data)
            })
        })
    })
}
