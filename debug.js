const debug = require('debug');

module.exports = {
    log: debug('tw2tracker'),
    sync: debug('tw2tracker:sync'),
    auth: debug('tw2tracker:sync:auth'),
    tasks: debug('tw2tracker:sync:tasks'),
    worlds: debug('tw2tracker:sync:worlds'),
    db: debug('tw2tracker:sync:db'),
    socket: debug('tw2tracker:socket')
};
