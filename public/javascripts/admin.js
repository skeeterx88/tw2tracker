define('updateAllWorldsStatus', [
    'updateWorldStatus',
    'backendValues'
], function (
    updateWorldStatus,
    {
        syncStates
    }
) {
    return function updateAllWorldsStatus ({data, achievements}) {
        for (const worldId of data) {
            updateWorldStatus({worldId}, syncStates.START)
        }

        for (const worldId of achievements) {
            updateWorldStatus({worldId}, syncStates.ACHIEVEMENT_START)
        }
    }
})

define('updateWorldStatus', [
    'backendValues'
], function (
    {
        syncStates
    }
) {
    return function updateWorldStatus ({worldId, status, date}, action) {
        const $world = document.querySelector('#' + worldId)
        const $dataDate = $world.querySelector('.last-data-sync-date')
        const $dataStatus = $world.querySelector('.last-data-sync-status')
        const $dataSync = $world.querySelector('.sync-data button')
        const $achievementsSync = $world.querySelector('.sync-achievements button')

        switch (action) {
            case syncStates.START: {
                $dataSync.innerHTML = 'Sync data in progress...'
                break
            }
            case syncStates.FINISH: {
                $dataSync.innerHTML = 'Sync data'
                $dataDate.innerHTML = date
                $dataStatus.innerHTML = status
                break
            }
            case syncStates.ACHIEVEMENT_START: {
                $achievementsSync.innerHTML = 'Sync achievements in progress...'
                break
            }
            case syncStates.ACHIEVEMENT_FINISH: {
                $achievementsSync.innerHTML = 'Sync achievements'
                break
            }
        }
    }
})

require([
    'updateAllWorldsStatus',
    'updateWorldStatus',
    'backendValues'
], function (
    updateAllWorldsStatus,
    updateWorldStatus,
    {
        development,
        syncStates
    }
) {
    function setupSync () {
        const $worlds = document.querySelectorAll('#worlds-sync .world')
        const $worldButtons = Array.from($worlds).map(function ($world) {
            return [
                $world.querySelector('.sync-data'),
                $world.querySelector('.sync-achievements')
            ]
        })

        for (const $buttons of $worldButtons) {
            for (const $button of $buttons) {
                $button.addEventListener('click', function (event) {
                    event.preventDefault()
                    fetch(this.href)
                })
            }
        }
    }

    function setupSocket () {
        const protocol = development ? 'ws' : 'wss'
        const socket = new WebSocket(`${protocol}://${location.host}`)

        socket.addEventListener('message', function (event) {
            const [action, value] = JSON.parse(event.data)

            switch (action) {
                case syncStates.UPDATE: {
                    updateAllWorldsStatus(value)
                    break
                }
                case syncStates.START: {
                    updateWorldStatus(value, action)
                    break
                }
                case syncStates.FINISH: {
                    updateWorldStatus(value, action)
                    break
                }
                case syncStates.ACHIEVEMENT_START: {
                    updateWorldStatus(value, action)
                    break
                }
                case syncStates.ACHIEVEMENT_FINISH: {
                    updateWorldStatus(value, action)
                    break
                }
            }
        })
    }

    setupSync()
    setupSocket()
})
