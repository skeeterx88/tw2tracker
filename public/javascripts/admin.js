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
            updateWorldStatus({worldId}, syncStates.START);
        }

        for (const worldId of achievements) {
            updateWorldStatus({worldId}, syncStates.ACHIEVEMENT_START);
        }
    };
});

define('updateWorldStatus', [
    'backendValues'
], function (
    {
        syncStates
    }
) {
    const $syncDataAllActive = document.querySelector('#sync-data-all-active');
    const $syncActiveDataWorlds = document.querySelector('#sync-active-data-worlds');
    const $syncAchievementsAllActive = document.querySelector('#sync-achievements-all-active');
    const $syncActiveAchievementWorlds = document.querySelector('#sync-active-achievement-worlds');

    function addActiveWorld ($container, worldId) {
        const $world = document.createElement('span');
        $world.innerHTML = worldId;
        $world.classList.add('active');
        $world.classList.add(worldId);

        $container.querySelector('.empty').style.display = 'none';
        $container.appendChild($world);
    }

    function removeActiveWorld ($container, worldId) {
        const $world = $container.querySelector('.' + worldId);
        $world.remove();

        if ($container.children.length === 1) {
            $container.querySelector('.empty').style.display = '';
        }
    }

    return function updateWorldStatus ({worldId, status, date}, action) {
        const $world = document.querySelector('#' + worldId);

        const $dataSync = $world.querySelector('.sync-data');
        const $dataDate = $world.querySelector('.last-data-sync-date');
        const $dataStatus = $world.querySelector('.last-data-sync-status');

        const $achievementsSync = $world.querySelector('.sync-achievements');
        const $achievementsDate = $world.querySelector('.last-achievements-sync-date');
        const $achievementsStatus = $world.querySelector('.last-achievements-sync-status');

        switch (action) {
            case syncStates.START: {
                $dataSync.innerHTML = 'Sync data in progress...';
                $dataSync.dataset.active = 'yes';
                addActiveWorld($syncActiveDataWorlds, worldId);
                break;
            }
            case syncStates.FINISH: {
                $dataSync.innerHTML = 'Sync data';
                $dataDate.innerHTML = date;
                $dataStatus.innerHTML = status;
                $dataSync.dataset.active = 'no';
                removeActiveWorld($syncActiveDataWorlds, worldId);
                break;
            }
            case syncStates.ACHIEVEMENT_START: {
                $achievementsSync.innerHTML = 'Sync achievements in progress...';
                $achievementsSync.dataset.active = 'yes';
                addActiveWorld($syncActiveAchievementWorlds, worldId);
                break;
            }
            case syncStates.ACHIEVEMENT_FINISH: {
                $achievementsSync.innerHTML = 'Sync achievements';
                $achievementsDate.innerHTML = date;
                $achievementsStatus.innerHTML = status;
                $achievementsSync.dataset.active = 'no';
                removeActiveWorld($syncActiveAchievementWorlds, worldId);
                break;
            }
        }
    };
});

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
        const $worlds = document.querySelectorAll('#sync-worlds .world');
        const $worldButtons = Array.from($worlds).map(function ($world) {
            return [
                $world.querySelector('.sync-data'),
                $world.querySelector('.sync-achievements')
            ];
        });

        for (const $buttons of $worldButtons) {
            for (const $button of $buttons) {
                $button.addEventListener('click', function (event) {
                    event.preventDefault();

                    if ($button.dataset.active === 'no') {
                        fetch(this.href);
                        $button.dataset.active = 'yes';
                    }
                });
            }
        }
    }

    function setupSocket () {
        const protocol = development ? 'ws' : 'wss';
        const socket = new WebSocket(`${protocol}://${location.host}`);

        socket.addEventListener('message', function (event) {
            const [action, value] = JSON.parse(event.data);

            switch (action) {
                case syncStates.UPDATE: {
                    updateAllWorldsStatus(value);
                    break;
                }
                default: {
                    updateWorldStatus(value, action);
                    break;
                }
            }
        });
    }

    setupSync();
    setupSocket();
});
