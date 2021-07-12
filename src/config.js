const fs = require('fs');
const defaults = require('../share/default-config.json');
const utils = require('../src/utils.js');
let config;

if (fs.existsSync('./config.json')) {
    config = require('../config.json');
    config = utils.mergeDeep(defaults, config);
} else {
    fs.promises.writeFile('./config.json', JSON.stringify(defaults, null, 4));
    config = defaults;
}

module.exports = function (namespace, key) {
    if (!utils.hasOwn(config, namespace)) {
        throw new Error(`Config namespace "${namespace}" not found.`);
    } else if (!key) {
        return config[namespace];
    } else if (!utils.hasOwn(config[namespace], key)) {
        throw new Error(`Config key "${key}" from namespace "${namespace}" not found.`);
    }

    return config[namespace][key];
};
