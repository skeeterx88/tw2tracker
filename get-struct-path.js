/**
 * This function is evaluated inside the game's page context via puppeteer's page.evaluate()
 */
module.exports = function () {
    console.log('Scrapper: Loading structure binary')

    const cdn = require('cdn')
    const conf = require('conf/conf')

    return cdn.getPath(conf.getMapPath())
}
