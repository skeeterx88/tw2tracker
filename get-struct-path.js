/**
 * This function is evaluated inside the game's page context via puppeteer's page.evaluate()
 */
module.exports = function () {
    return new Promise(async function (resolve) {
        console.log('Scrapper: Loading structure binary')

        const cdn = require('cdn')
        const conf = require('conf/conf')

        resolve(cdn.getPath(conf.getMapPath()))
    })
}
