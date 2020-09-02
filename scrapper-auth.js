const Scrapper = require('./scrapper.js')
const settings = require('./settings')
const fs = require('fs')
const db = require('./db')
const sql = require('./sql')

module.exports = async function (market, world, account) {
    return new Promise(async function (resolve, reject) {
        const puppeteer = require('puppeteer-core')
        const browser = await puppeteer.launch({
            headless: true,
            executablePath: '/usr/bin/chromium'
        })

        const page = await browser.newPage()

        console.log(`Authenticating "${account.playerName}" on world "${market}${world}"`)

        await page.goto(`https://${market}.tribalwars2.com/page`)
        await page.setCookie({
            name: 'globalAuthCookie',
            value: JSON.stringify({
                token: account.token,
                playerName: account.playerName,
                autologin: true
            }),
            domain: `.${market}.tribalwars2.com`,
            path: '/',
            expires: 2147482647,
            size: 149,
            httpOnly: false,
            secure: false,
            session: false
        })
        await page.goto(`https://${market}.tribalwars2.com/game.php?world=${market}${world}&character_id=${account.id}`)

        await page.waitForSelector('#map', {
            timeout: 10000
        })

        console.log(`Scrapping ${market}${world}`)

        const settings = await db.query(sql.settings)

        const data = await page.evaluate(Scrapper, {
            allowBarbarians: settings.scrapper_allow_barbarians
        })

        console.log(`Scrapping ${market}${world} finished`)

        await fs.writeFileSync(`data/${market}${world}.json`, JSON.stringify(data))

        browser.close()
        resolve()
    })
}
