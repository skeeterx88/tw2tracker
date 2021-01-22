define('syncStates', [], function () {
    return {
        START: 'start',
        FINISH: 'finish',
        UPDATE: 'update'
    }
})

define('updateAllWorldsStatus', [
    'syncStates',
    'updateWorldStatus'
], function (
    syncStates,
    updateWorldStatus
) {
    return function updateAllWorldsStatus (worlds) {
        for (const worldId of worlds) {
            updateWorldStatus({worldId}, syncStates.START)
        }
    }
})

define('updateWorldStatus', [
    'syncStates'
], function (
    syncStates
) {
    return function updateWorldStatus ({worldId, status, date}, stateType) {
        const $world = document.querySelector('#' + worldId)
        const $date = $world.querySelector('.last-sync-date')
        const $status = $world.querySelector('.last-sync-status')
        const $syncButton = $world.querySelector('.sync-now button')

        switch (stateType) {
            case syncStates.START: {
                $world.classList.add('in-progress')
                $syncButton.innerHTML = 'Sync in progress...'
                break
            }
            case syncStates.FINISH: {
                $world.classList.remove('in-progress')
                $syncButton.innerHTML = 'Sync now'
                $date.innerHTML = date
                $status.innerHTML = status
                break
            }
        }
    }
})

require([
    'syncStates',
    'updateAllWorldsStatus',
    'updateWorldStatus',
    'backendValues'
], function (
    syncStates,
    updateAllWorldsStatus,
    updateWorldStatus,
    {
        development
    }
) {
    function setupSync () {
        const $worlds = document.querySelectorAll('#worlds-sync .world')
        const syncButtons = Array.from($worlds).map(function ($world) {
            return [$world.dataset, $world.querySelector('.sync-now')]
        })

        for (const [{marketId, worldNumber}, $sync] of syncButtons) {
            $sync.addEventListener('click', function (event) {
                event.preventDefault()

                fetch(`/admin/scraper/${marketId}/${worldNumber}`)
            })
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
                    updateWorldStatus(value, syncStates.START)
                    break
                }
                case syncStates.FINISH: {
                    updateWorldStatus(value, syncStates.FINISH)
                    break
                }
            }
        })
    }

    setupSync()
    setupSocket()
})
