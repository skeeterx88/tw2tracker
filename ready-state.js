module.exports = function () {
    const readyState = function (callback) {
        return new Promise(function (resolve, reject) {
            let injectorTimeout
            let timeout

            timeout = setTimeout(function () {
                clearTimeout(injectorTimeout)

                if (document.querySelector('.modal-establish-village')) {
                    console.log('Scrapper: Ready to fetch villages')

                    return resolve()
                }

                const transferredSharedDataService = injector.get('transferredSharedDataService')
                const mapScope = transferredSharedDataService.getSharedData('MapController')

                if (mapScope && mapScope.isInitialized) {
                    console.log('Scrapper: Ready to fetch villages')

                    resolve()
                } else {
                    reject()
                }
            }, 10000)

            const waitForInjector = function (callback) {
                if (typeof injector === 'undefined') {
                    setTimeout(waitForInjector, 100)
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

                    console.log('Scrapper: Ready to fetch villages')

                    resolve()
                })
            })
        })
    }

    return new Promise(async function (resolve, reject) {
        try {
            await readyState()
            resolve()
        } catch (error) {
            reject()
        }
    })
}
