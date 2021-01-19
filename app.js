(async function () {
    const db = require('./db.js')
    const sql = require('./sql.js')

    const schemaInitialized = (await db.one(sql.helpers.schemaInitialized)).exists

    if (!schemaInitialized) {
        await db.query(sql.createSchema)
    }

    const server = require('./server.js')
    const Sync = require('./sync.js')
    const syncServer = require('./sync-server.js')
    const cluster = require('cluster')
    const cpus = require('os').cpus()

    if (cluster.isMaster) {
        Sync.init()
        syncServer()

        for (let i = 0; i < cpus.length; i++) {
            const worker = cluster.fork()

            worker.on('message', function (data) {
                switch (data.action) {
                    case 'syncWorld': {
                        Sync.world(data.marketId, data.worldNumber)
                        break
                    }
                    case 'syncAllWorlds': {
                        Sync.allWorlds()
                        break
                    }
                }
            })
        }
    } else {
        server()
    }
})()
