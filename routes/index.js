const express = require('express')
const router = express.Router()
const getSettings = require('../settings')
const {db,pgp} = require('../db')
const sql = require('../sql')
const utils = require('../utils')
const {asyncRouter, hasOwn} = utils

router.get('/', asyncRouter(async function (req, res, next) {
    const settings = await getSettings()
    const worlds = await db.any(sql.worlds.all)
    const marketsIds = Array.from(new Set(worlds.map(world => world.market)))
    const markets = marketsIds.map(function (marketId) {
        return {
            id: marketId,
            player_count: worlds.reduce((base, next) => next.market === marketId ? base + next.player_count : base, 0),
            tribe_count: worlds.reduce((base, next) => next.market === marketId ? base + next.tribe_count : base, 0),
            village_count: worlds.reduce((base, next) => next.market === marketId ? base + next.village_count : base, 0),
            open_world_count: worlds.reduce((base, next) => next.market === marketId && next.open ? base + 1 : base, 0),
            closed_world_count: worlds.reduce((base, next) => next.market === marketId && !next.open ? base + 1 : base, 0)
        }
    })

    res.render('stats-home', {
        title: settings.site_name,
        markets,
        navigation: [
            `<a href="/stats/">${settings.site_name}</a>`
        ],
        ...utils.ejsHelpers
    })
}))

module.exports = router
