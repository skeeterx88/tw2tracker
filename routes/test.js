const fs = require('fs')
const express = require('express')
const router = express.Router()

router.get('/', function (req, res) {
    const data = fs.readFileSync('./data/test.json')

    res.setHeader('Content-Type', 'application/json')
    res.end(data)
})

module.exports = router
