(async function () {
    const db = require('./db.js')

    try {
        const connection = await db.connect()
        connection.done()
    } catch (error) {
        throw new Error(`Can't connect to PostgreSQL database: ${error.message}`)
    }

    const sql = require('./sql.js')
    const schemaInitialized = (await db.one(sql.helpers.schemaInitialized)).exists

    if (!schemaInitialized) {
        await db.query(sql.createSchema)
    }

    const server = require('./server.js')
    const Sync = require('./sync.js')
    const cluster = require('cluster')
    const cpus = require('os').cpus()

    if (cluster.isMaster) {
        Sync.init()

        for (let i = 0; i < cpus.length; i++) {
            cluster.fork()
        }
    } else {
        server()
    }
})()
