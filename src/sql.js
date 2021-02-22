const QueryFile = require('pg-promise').QueryFile;
const path = require('path');
const fs = require('fs');
const rcamelcase = /-([a-z])/g;

const getSqlTree = function (from, sub, tree = {}) {
    sub = sub || from;

    const items = fs.readdirSync(path.join(__dirname, from));

    for (const item of items) {
        const itemStat = fs.lstatSync(path.join(__dirname, from, item));

        if (itemStat.isFile()) {
            const fileName = path.parse(item).name;
            const camelCaseName = fileName.replace(rcamelcase, (file) => file[1].toUpperCase());
            tree[camelCaseName] = new QueryFile(path.join(sub, item));
        } else if (itemStat.isDirectory()) {
            tree[item] = getSqlTree(path.join(from, item), path.join(sub, item));
        }
    }

    return tree;
};

module.exports = getSqlTree('sql');
