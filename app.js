const cluster = require('cluster')
const cpus = require('os').cpus()

if (cluster.isMaster) {
    for (let i = 0; i < cpus.length; i++) {
        cluster.fork()
    }
} else {
    const server = require('./server')
    const Sync = require('./sync')

    if (cpus.length === 1) {
        server()
        Sync.init()

        cluster.on('exit', (worker, code, signal) => {
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
