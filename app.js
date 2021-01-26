(async function () {
    require('toml-require').install();

    const db = require('./db.js');

    try {
        const connection = await db.connect();
        connection.done();
    } catch (error) {
        throw new Error(`Can't connect to PostgreSQL database: ${error.message}`);
    }

    const sql = require('./sql.js');
    const schemaInitialized = (await db.one(sql.helpers.schemaInitialized)).exists;

    if (!schemaInitialized) {
        await db.query(sql.createSchema);
    }

    const cluster = require('cluster');

    if (cluster.isMaster) {
        const cpus = require('os').cpus();
        const Sync = require('./sync.js');

        Sync.init();

        for (let i = 0; i < cpus.length; i++) {
            cluster.fork();
        }
    } else {
        const server = require('./server.js');
        server();
    }
})();
