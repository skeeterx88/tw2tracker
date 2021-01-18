function updateSyncStatus (worlds) {
    const $syncings = document.querySelectorAll('#worlds-sync .in-progress')

    for (let $syncing of $syncings) {
        if (!worlds.includes($syncing.id)) {
            $syncing.classList.remove('in-progress')
        }
    }

    for (let worldId of worlds) {
        const $world = document.querySelector('#' + worldId)
        $world.classList.add('in-progress')
    }
}

const socket = new WebSocket('ws://localhost:8080')

socket.addEventListener('message', function (event) {
    const worlds = JSON.parse(event.data)
    updateSyncStatus(worlds)
})
