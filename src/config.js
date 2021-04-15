const fs = require('fs');
const defaults = require('../share/default-config.json');
const utils = require('../src/utils.js');
const hasOwn = Object.prototype.hasOwnProperty;
let configObj;

function config (namespace, key) {
    if (!hasOwn.call(configObj, namespace)) {
        throw new Error(`Config namespace "${namespace}" not found.`);
    } else if (!key) {
        return configObj[namespace];
    } else if (!hasOwn.call(configObj[namespace], key)) {
        throw new Error(`Config key "${key}" from namespace "${namespace}" not found.`);
    }

    return configObj[namespace][key];
}

function refresh () {
    if (fs.existsSync('./config.json')) {
        configObj = require('../config.json');
        configObj = utils.mergeDeep(defaults, configObj);
    } else {
        fs.promises.writeFile('./config.json', JSON.stringify(defaults));
        configObj = defaults;
    }
}

refresh();
config.refresh = refresh;
module.exports = config;
