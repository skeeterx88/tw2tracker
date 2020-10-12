// File sql.js

// Proper way to organize an sql provider:
//
// - have all sql files for Users in ./sql/users
// - have all sql files for Products in ./sql/products
// - have your sql provider module as ./sql/index.js

const QueryFile = require('pg-promise').QueryFile
const path = require('path')
const fs = require('fs')
const rcamelcase = /-([a-z])/g

const readSqlFile = function (file) {
    const fullPath = path.join(__dirname, file)
    return new QueryFile(fullPath, {
        minify: true
    })
}

const getSqlTree = function (from, sub, tree = {}) {
    sub = sub || from

    const items = fs.readdirSync(from)

    for (let item of items) {
        const itemStat = fs.lstatSync(path.join(from, item))

        if (itemStat.isFile()) {
            const fileName = path.parse(item).name
            const camelCaseName = fileName.replace(rcamelcase, (file) => file[1].toUpperCase())
            const sqlPath = path.join(sub, item)
            const sql = readSqlFile(sqlPath)

            tree[camelCaseName] = sql
        } else if (itemStat.isDirectory()) {
            tree[item] = getSqlTree(path.join(from, item), path.join(sub, item))
        }
    }

    return tree
}

module.exports = getSqlTree('sql')
