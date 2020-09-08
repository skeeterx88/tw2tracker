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

        console.log(`Authenticating "${account.account_name}" on world "${market}${world}"`)

        await page.goto(`https://${market}.tribalwars2.com/page`)
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

        await page.goto(`https://${market}.tribalwars2.com/game.php?world=${market}${world}&character_id=${account.account_id}`)

        try {
            await page.waitForSelector('.login-error', {
                visible: true,
                timeout: 5000
            })

            reject('Login error')
        } catch (error) {}

        try {
            await page.waitForSelector('#map', {
                timeout: 10000
            })

            resolve({ page, browser })
        } catch (error) {
            reject('Game page not loaded')
        }

        resolve()
    })
}
