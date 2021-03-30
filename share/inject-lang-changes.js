const fs = require('fs');
const path = require('path');

function isObject (item) {
    return (item && typeof item === 'object' && !Array.isArray(item));
}

function mergeDeep (target, changes) {
    if (isObject(target) && isObject(changes)) {
        for (const key in changes) {
            if (isObject(changes[key])) {
                if (!target[key]) Object.assign(target, {
                    [key]: {}
                });
                mergeDeep(target[key], changes[key]);
            } else {
                Object.assign(target, {
                    [key]: changes[key]
                });
            }
        }
    }

    return target;
}

const targetLocation = path.resolve(process.argv[2]);
const changesLocation = path.resolve(process.argv[3]);

const target = JSON.parse(fs.readFileSync(targetLocation, 'utf-8'));
const changes = JSON.parse(fs.readFileSync(changesLocation, 'utf-8'));
const result = JSON.stringify(mergeDeep(target, changes), null, 4);

fs.writeFileSync(targetLocation, result, 'utf-8');
