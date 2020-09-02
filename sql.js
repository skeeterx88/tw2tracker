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

const sql = {}

fs.readdirSync('sql').forEach(function (item) {
    const stat = fs.lstatSync('sql/' + item)

    if (stat.isFile()) {
        const fileName = path.parse(item).name
        const camelCaseName = fileName.replace(rcamelcase, (file) => file[1].toUpperCase())
        sql[camelCaseName] = readSqlFile('sql/' + item)
    } else if (stat.isDirectory()) {
        sql[item] = {}

        fs.readdirSync('sql/' + item).forEach(function (sqlFile) {
            const fileName = path.parse(sqlFile).name
            const camelCaseName = fileName.replace(rcamelcase, (file) => file[1].toUpperCase())
            sql[item][camelCaseName] = readSqlFile('sql/' + item + '/' + sqlFile)
        })
    }
})

module.exports = sql
