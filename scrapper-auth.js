const Scrapper = require('./scrapper.js')
const settings = require('./settings')
const fs = require('fs')
const db = require('./db')
const sql = require('./sql')

module.exports = async function (market, world, account) {
    const puppeteer = require('puppeteer-core')
    const browser = await puppeteer.launch({
        // devtools: true,
        executablePath: '/usr/bin/chromium'
    })

    const page = await browser.newPage()

    page.on('console', function (msg) {
        console.log(msg)
        if (msg._type === 'log' && msg._text.startsWith('puppeteer ')) {
            console.log(msg._text.split('puppeteer ')[1])
        }
    })

    console.log(`Authenticating "${account.account_name}" on world "${market}${world}"`)

    console.log('goto login page')

    await page.goto(`https://${market}.tribalwars2.com/page`)
    await page.waitFor(2500)
    
    console.log('set login cookies')

    await page.setCookie({
        name: 'globalAuthCookie',
        value: JSON.stringify({
            token: account.account_token,
            playerName: account.account_name,
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
    await page.goto(`https://${market}.tribalwars2.com/page`, {
        waitUntil: ['domcontentloaded']
    })

    try {
        console.log('checking login')

        await page.waitForSelector('.player-worlds', { timeout: 10000 })

        console.log('goto game page')

        await page.goto(`https://${market}.tribalwars2.com/game.php?world=${market}${world}&character_id=${account.account_id}`, {
            waitUntil: ['domcontentloaded']
        })

        await page.waitFor(2500)

        console.log('wait for #map element')

        await page.waitForSelector('#map', {
            timeout: 10000
        })

        console.log('Authenticated')

        return [page, browser]
    } catch (error) {
        browser.close()
        throw new Error('ScrapperAuth: Login error')
    }
}
