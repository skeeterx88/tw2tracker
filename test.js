(async function () {
    const puppeteer = require('puppeteer-core')
    const browser = await puppeteer.launch({
        headless: true,
        executablePath: '/usr/bin/chromium'
    })
    const page = await browser.newPage()
    page.on('console', function (msg) {
        if (msg._type === 'log' && msg._text.startsWith('Scrapper:')) {
            console.log(msg._text)
        }
    })

    const test = function () {
        const Scrapper = async function () {
            throw new Error('fuck')
        }

        return new Promise(async function (resolve, reject) {
            try {
                const data = await Scrapper()
                resolve(data)
            } catch (error) {
                reject(error.message)
            }
        })
    }

    try {
        await page.evaluate(test)
    } catch (e) {
        console.log('ok we catch it. results:')
        console.log(e)
    }
})();
