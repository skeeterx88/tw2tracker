module.exports = function () {
    const WebSocket = require('ws')

    const syncStatus = require('./sync-status.js')
    const enums = require('./enums.js')
    const Events = require('./events.js')

    const syncStates = {
        START: 'start',
        FINISH: 'finish',
        UPDATE: 'update'
    }

    const syncServer = new WebSocket.Server({port: 7777})

    syncServer.on('connection', function connection(ws) {
        function send(data) {
            ws.send(JSON.stringify(data))
        }

        Events.on(enums.SCRAPE_WORLD_START, function (worldId) {
            send([syncStates.START, {
                worldId
            }])
        })

        Events.on(enums.SCRAPE_WORLD_END, function (worldId, status, date) {
            send([syncStates.FINISH, {
                worldId,
                status,
                date
            }])
        })

        send([syncStates.UPDATE, syncStatus.getCurrent()]   )
    })
}
