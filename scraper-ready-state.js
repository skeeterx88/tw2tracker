/**
 * This function is evaluated inside the game's page context via puppeteer's page.evaluate()
 */
module.exports = function () {
    return new Promise(function (resolve, reject) {
        let injectorTimeout

        const timeout = setTimeout(function () {
            clearTimeout(injectorTimeout)

            if (document.querySelector('.modal-establish-village')) {
                return resolve()
            }

            const transferredSharedDataService = injector.get('transferredSharedDataService')
            const mapScope = transferredSharedDataService.getSharedData('MapController')

            if (mapScope && mapScope.isInitialized) {
                resolve()
            } else {
                reject('Could not get ready state (timeout)')
            }
        }, 10000)

        const waitForInjector = function (callback) {
            if (typeof injector === 'undefined') {
                injectorTimeout = setTimeout(waitForInjector, 100)
            } else {
                callback()
            }
        }

        waitForInjector(function () {
            const $rootScope = injector.get('$rootScope')
            const eventTypeProvider = injector.get('eventTypeProvider')

            $rootScope.$on(eventTypeProvider.CHARACTER_INFO, function () {
                clearTimeout(timeout)
                clearTimeout(injectorTimeout)
                resolve()
            })
        })
    })
}
