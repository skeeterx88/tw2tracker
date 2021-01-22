const QueryFile = require('pg-promise').QueryFile
const path = require('path')
const fs = require('fs')
const rcamelcase = /-([a-z])/g

const getSqlTree = function (from, sub, tree = {}) {
    sub = sub || from

    const items = fs.readdirSync(from)

    for (const item of items) {
        const itemStat = fs.lstatSync(path.join(from, item))

        if (itemStat.isFile()) {
            const fileName = path.parse(item).name
            const camelCaseName = fileName.replace(rcamelcase, (file) => file[1].toUpperCase())
            const sql = new QueryFile(path.join(__dirname, sub, item))

            tree[camelCaseName] = sql
        } else if (itemStat.isDirectory()) {
            tree[item] = getSqlTree(path.join(from, item), path.join(sub, item))
        }
    }

    return tree
}

module.exports = getSqlTree('sql')
