const fs = require('fs');
const defaults = require('../share/default-config.json');

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

if (fs.existsSync('./config.json')) {
    const config = require('../config.json');
    module.exports = mergeDeep(defaults, config);
} else {
    fs.promises.writeFile('./config.json', JSON.stringify(defaults));
    module.exports = defaults;
}
