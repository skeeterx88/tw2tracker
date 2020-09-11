const Scrapper = require('./scrapper.js')
const settings = require('./settings')
const fs = require('fs')
const db = require('./db')
const sql = require('./sql')

module.exports = async function (market, world, account) {
    const puppeteer = require('puppeteer-core')
    const browser = await puppeteer.launch({devtools: false, executablePath: '/usr/bin/chromium'})
    const page = await browser.newPage()

    page.on('console', function (msg) {
        if (msg._type === 'log' && msg._text.startsWith('Scrapper:')) {
            console.log(msg._text)
        }
    })

    console.log('ScrapperAuth: Authenticating ' + account.account_name + ' on ' + market + world)
    console.log('ScrapperAuth: Loading login page')

    await page.goto(`https://${market}.tribalwars2.com/page`)
    await page.waitFor(2500)
    
    console.log('ScrapperAuth: Setting account credentials')

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

    await page.goto(`https://${market}.tribalwars2.com/page`)

    try {
        console.log('ScrapperAuth: Checking login')
        await page.waitForSelector('.player-worlds', { timeout: 10000 })
        console.log('ScrapperAuth: Loading game\'s page')
        await page.goto(`https://${market}.tribalwars2.com/game.php?world=${market}${world}&character_id=${account.account_id}`)
        await page.waitFor(2500)
        await page.waitForSelector('#map', { timeout: 10000 })
        console.log('ScrapperAuth: Account ' + account.account_name + ' Authenticated')

        return [page, browser]
    } catch (error) {
        browser.close()
        throw new Error('ScrapperAuth: Authentication failed')
    }
}
