const debug = require('debug');

module.exports = {
    log: debug('tw2tracker'),
    sync: debug('tw2tracker:sync'),
    auth: debug('tw2tracker:auth'),
    tasks: debug('tw2tracker:tasks'),
    worlds: debug('tw2tracker:worlds'),
    db: debug('tw2tracker:db'),
    socket: debug('tw2tracker:socket'),
    comm: debug('tw2tracker:comm'),
    puppeteer: debug('tw2tracker:puppeteer')
};
