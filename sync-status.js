const Events = require('./events.js')
const enums = require('./enums.js')

let syncing = new Set()
let fullSync = false
let partialSync = false

Events.on(enums.SCRAPE_WORLD_START, function (worldId) {
    syncing.add(worldId)

    if (!fullSync) {
        partialSync = true
    }
})

Events.on(enums.SCRAPE_WORLD_END, function (worldId) {
    syncing.delete(worldId)

    if (!fullSync) {
        partialSync = false
    }
})

Events.on(enums.SCRAPE_ACHIEVEMENT_WORLD_START, function (worldId) {
    fullSync = true
})

Events.on(enums.SCRAPE_ACHIEVEMENT_WORLD_END, function (worldId) {
    fullSync = false
})

function getCurrent () {
    return Array.from(syncing.values())
}

function isFullSync () {
    return fullSync
}

function isPartialSync () {
    return partialSync
}

module.exports = {
    getCurrent,
    isFullSync,
    isPartialSync
}
