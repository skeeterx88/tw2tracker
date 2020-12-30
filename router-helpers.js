const createError = require('http-errors')
const {schemaExists} = require('./utils.js')
const {db} = require('./db.js')
const sql = require('./sql.js')

async function getPlayer (worldId, playerId) {
    const player = await db.any(sql.getPlayer, {worldId, playerId})

    if (!player.length) {
        throw createError(404, 'This tribe does not exist')
    }

    return player[0]
}

async function getTribe (worldId, tribeId) {
    const tribe = await db.any(sql.getTribe, {worldId, tribeId})


    if (!tribe.length) {
        throw createError(404, 'This tribe does not exist')
    }

    return tribe[0]
}

async function getVillage (worldId, villageId) {
    const village = await db.any(sql.getVillage, {worldId, villageId})

    if (!village.length) {
        throw createError(404, 'This village does not exist')
    }

    return village[0]
}

async function getPlayerVillages (worldId, playerId) {
    return await db.any(sql.getPlayerVillages, {worldId, playerId})
}

function paramMarket (req) {
    return req.params.marketId.length === 2
}

function paramWorld (req) {
    return req.params.marketId.length === 2 && !isNaN(req.params.worldNumber)
}

async function paramWorldParse (req) {
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)
    const worldId = marketId + worldNumber
    const worldSchema = await schemaExists(worldId)

    if (!worldSchema) {
        throw createError(404, 'This world does not exist')
    }

    return {
        marketId,
        worldId,
        worldNumber
    }
}

async function paramTribeParse (req, worldId) {
    const tribeId = parseInt(req.params.tribeId, 10)
    const tribe = await getTribe(worldId, tribeId)

    return {
        tribeId,
        tribe
    }
}

async function paramPlayerParse (req, worldId) {
    const playerId = parseInt(req.params.playerId, 10)
    const player = await getPlayer(worldId, playerId)

    return {
        playerId,
        player
    }
}

async function paramVillageParse (req, worldId) {
    const villageId = parseInt(req.params.villageId, 10)
    const village = await getVillage(worldId, villageId)

    return {
        villageId,
        village
    }
}

module.exports = {
    getPlayer,
    getPlayerVillages,
    getTribe,
    paramWorld,
    paramMarket,
    paramWorldParse,
    paramTribeParse,
    paramPlayerParse,
    paramVillageParse
}
