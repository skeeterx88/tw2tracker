const puppeteer = require('puppeteer-core')
const fs = require('fs')
const ini = require('ini')

if (!fs.existsSync('./puppeteer.ini')) {
    const defaults = fs.readFileSync('./share/puppeteer.default.ini', 'utf-8')
    fs.writeFileSync('./puppeteer.ini', defaults)
}

const config = ini.decode(fs.readFileSync('./puppeteer.ini', 'utf-8'))

if (!fs.existsSync(config.chromium_path)) {
    throw new Error(`Can't locate chrome executable: "${config.chromium_path}"`)
}

module.exports = async function () {
    return await puppeteer.launch({
        headless: config.headless,
        executablePath: config.chromium_path
    })
}
