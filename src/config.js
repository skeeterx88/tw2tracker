const fs = require('fs');
const defaults = require('../share/default-config.json');
const hasOwn = Object.prototype.hasOwnProperty;
let configObj;

function isObject (item) {
    return (item && typeof item === 'object' && !Array.isArray(item));
}

function mergeDeep (target, ...sources) {
    if (!sources.length) {
        return target;
    }

    const source = sources.shift();

    if (isObject(target) && isObject(source)) {
        for (const key in source) {
            if (isObject(source[key])) {
                if (!target[key]) Object.assign(target, {
                    [key]: {}
                });
                mergeDeep(target[key], source[key]);
            } else {
                Object.assign(target, {
                    [key]: source[key]
                });
            }
        }
    }

    return mergeDeep(target, ...sources);
}

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
        configObj = mergeDeep(defaults, configObj);
    } else {
        fs.promises.writeFile('./config.json', JSON.stringify(defaults));
        configObj = defaults;
    }
}

refresh();
config.refresh = refresh;
module.exports = config;
