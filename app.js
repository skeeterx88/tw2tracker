(async function () {
    const development = process.env.NODE_ENV === 'development'
    const {db} = require('./db')
    const sql = require('./sql')

    const schemaInitialized = (await db.one(sql.helpers.schemaInitialized)).exists

    if (!schemaInitialized) {
        await db.query(sql.createSchema)
    }

    const server = require('./server')
    const Sync = require('./sync')

    if (development) {
        server()
        Sync.init()
    } else {
        const cluster = require('cluster')
        const cpus = require('os').cpus()

        if (cluster.isMaster) {
            for (let i = 0; i < cpus.length; i++) {
                cluster.fork()
            }
        } else {
            if (cpus.length === 1) {
                server()
                Sync.init()

                cluster.on('exit', () => {
                    server()
                    Sync.init()
                })
            } else {
                if (cluster.worker.id === cpus.length) {
                    Sync.init()
                    cluster.on('exit', Sync.init)
                } else {
                    server()
                    cluster.on('exit', server)
                }
            }
        }
    }
})()
