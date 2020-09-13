const db = require('./db')
const sql = require('./sql')
const utils = require('./utils')
const Scrapper = require('./scrapper.js')
const fs = require('fs')

const getMarketList = function () {
    return new Promise(function (resolve) {
        const https = require('https')
        const HTMLParser = require('fast-html-parser')

        https.get('https://en.tribalwars2.com/portal-bar/https/portal-bar.html', function (res) {
            res.setEncoding('utf8')

            let body = ''

            res.on('data', data => {
                body += data
            })

            res.on('end', async function () {
                const root = HTMLParser.parse(body)
                const marketElements = root.querySelectorAll('.pb-lang-sec-options a')

                const markets = marketElements.map(function (elem) {
                    const marketUrl = elem.attributes.href
                    return marketUrl.split('//')[1].split('.')[0]
                })

                resolve(markets)
            })
        })
    })
}

const connectWorldDatabase = async function (marketId, worldId) {
    const settings = await db.one(sql.settings)
    const pgp = require('pg-promise')()
    return pgp({
        user: settings.db_user,
        host: settings.db_host,
        database: 'tw2tracker-' + marketId + worldId,
        password: settings.db_password,
        port: settings.db_port
    })
}

const insertWorldData = async function (dbWorld, worldData) {
    const {villages, villagesByPlayer, players, tribes, updated} = worldData

    for (let id in tribes) {
        const [name, tag, points] = tribes[id]

        await dbWorld.query(sql.insertWorldTribe, [
            parseInt(id, 10),
            name,
            tag,
            points
        ])
    }

    for (let id in players) {
        const [name, points] = players[id]

        await dbWorld.query(sql.insertWorldPlayer, [
            parseInt(id, 10),
            name,
            points
        ])
    }

    for (let x in villages) {
        for (let y in villages[x]) {
            const [id, name, points, character_id] = villages[x][y]

            await dbWorld.query(sql.insertWorldVillage, [
                parseInt(id, 10),
                x,
                y,
                name,
                points,
                character_id || null
            ])
        }
    }

    for (let character_id in villagesByPlayer) {
        const playerVillagesCoords = villagesByPlayer[character_id]
        const playerVillages = []

        for (let i = 0; i < playerVillagesCoords.length; i++) {
            const [x, y] = playerVillagesCoords[i]
            const villageId = villages[x][y][0]

            playerVillages.push(villageId)
        }

        await dbWorld.query(sql.insertWorldPlayerVillages, [
            parseInt(character_id, 10),
            playerVillages
        ])
    }
}

const Sync = {}

Sync.authToken = async function (marketId, { account_name, account_token }) {
    const puppeteer = require('puppeteer-core')
    const browser = await puppeteer.launch({ devtools: false, executablePath: '/usr/bin/chromium' })
    const page = await browser.newPage()

    page.on('console', function (msg) {
        if (msg._type === 'log' && msg._text.startsWith('Scrapper:')) {
            console.log(msg._text)
        }
    })

    console.log('Sync: Authenticating ' + account.account_name + ' on market ' + marketId)
    console.log('Sync: Loading login page')

    await page.goto(`https://${marketId}.tribalwars2.com/page`)
    await page.waitFor(2500)
    
    console.log('Sync: Setting account credentials')

    await page.setCookie({
        name: 'globalAuthCookie',
        value: JSON.stringify({
            token: account.account_token,
            playerName: account.account_name,
            autologin: true
        }),
        domain: `.${marketId}.tribalwars2.com`,
        path: '/',
        expires: 2147482647,
        size: 149,
        httpOnly: false,
        secure: false,
        session: false
    })

    await page.goto(`https://${marketId}.tribalwars2.com/page`)

    try {
        console.log('Sync: Checking login')
        await page.waitForSelector('.player-worlds', { timeout: 10000 })
    
        return [page, browser]
    } catch (error) {
        browser.close()
        throw new Error('Sync: Authentication failed')
    }
}

Sync.getToken = async function (marketId, { account_name, account_password }) {
    const puppeteer = require('puppeteer-core')
    const browser = await puppeteer.launch({ devtools: false, executablePath: '/usr/bin/chromium' })
    const page = await browser.newPage()

    console.log('Sync: Loading login page')

    await page.goto(`https://${marketId}.tribalwars2.com/page`, {
        waitUntil: ['domcontentloaded', 'networkidle0']
    })

    console.log('Sync: Getting account token')

    const response = {}

    const data = await page.evaluate(function (account_name, account_password) {
        return new Promise(function (resolve) {
            const socketService = injector.get('socketService')
            const routeProvider = injector.get('routeProvider')

            const loginTimeout = setTimeout(function () {
                resolve(false)
            }, 5000)

            socketService.emit(routeProvider.LOGIN, {
                name: account_name,
                pass: account_password,
                ref_param: ''
            }, function (data) {
                clearTimeout(loginTimeout)
                resolve(data)
            })
        })
    }, account_name, account_password)

    if (data && data.token) {
        response.success = true
        response.token = data.token
    } else {
        console.log('Sync: Authentication failed')

        try {
            await page.waitForSelector('.login-error', { visible: true, timeout: 5000 })

            response.success = false
            response.reason = await page.$eval('.login-error', elem => elem.textContent)
        } catch (error) {
            response.success = false
            response.reason = 'unknow'
        }
    }

    return response
}

Sync.scrappeAll = async function (callback) {
    const worlds = await db.any(sql.worlds)

    worlds.forEach(async function (world) {
        await Sync.scrappeWorld(world.market, world.id)
    })
}

Sync.scrappeWorld = async function (marketId, worldId, callback = utils.noop) {
    const account = await db.one(sql.enabledMarket, [marketId])
    const worldInfo = await db.one(sql.world, [marketId, worldId])
    const minutesSinceLastSync = (Date.now() - worldInfo.last_sync.getTime()) / 1000 / 60
    const settings = await db.one(sql.settings)

    if (minutesSinceLastSync < settings.scrapper_interval_minutes) {
        return [false, marketId + worldId + ' already syncronized']
    }

    const [page, browser] = await Sync.authToken(marketId, account)

    console.log('Scrapper: Start scrapping', marketId + worldId)

    const dbWorld = connectWorldDatabase(marketId, worldId)

    await page.goto(`https://${marketId}.tribalwars2.com/game.php?world=${marketId}${worldId}&character_id=${account.account_id}`)
    await page.waitFor(2500)
    await page.waitForSelector('#map', { timeout: 10000 })
    const worldData = await page.evaluate(Scrapper)

    await insertWorldData(dbWorld, worldData)

    console.log('Scrapper:', marketId + worldId, 'scrapped successfully')
    browser.close()

    await db.query(sql.updateWorldSync, [marketId, worldId])
    
    return [true, marketId + worldId + ' synced successfully']
}

Sync.markets = async function () {
    const storedMarkets = await db.map(sql.markets, [], market => market.id)
    const marketList = await getMarketList()

    const addedMarkets = marketList.filter(function (marketId) {
        if (storedMarkets.includes(marketId)) {
            return false
        } else {
            db.query(sql.addMarket, [marketId])
            return true
        }
    })

    return addedMarkets
}

module.exports = Sync
