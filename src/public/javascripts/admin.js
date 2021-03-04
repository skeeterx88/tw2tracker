define('updateAllWorldsStatus', [
    'updateWorldStatus',
    'updateWorldSyncStatus',
    'updateWorldSyncEnabled',
    'i18n',
    'backendValues'
], function (
    updateWorldStatus,
    updateWorldSyncStatus,
    updateWorldSyncEnabled,
    i18n,
    {
        syncStates,
        accountPrivileges,
        privilegeTypes
    }
) {
    return function updateAllWorldsStatus ({worlds, data, achievements, other}) {
        if (accountPrivileges[privilegeTypes.CONTROL_SYNC]) {
            for (const world of worlds) {
                updateWorldSyncEnabled({
                    marketId: world.market,
                    worldNumber: world.num,
                    enabled: world.sync_enabled
                });
            }
        }

        for (const worldId of data) {
            updateWorldStatus({worldId}, syncStates.START);
        }

        for (const worldId of achievements) {
            updateWorldStatus({worldId}, syncStates.ACHIEVEMENT_START);
        }

        if (accountPrivileges[privilegeTypes.START_SYNC]) {
            updateWorldSyncStatus(other.worldList);
        }
    };
});

define('updateWorldStatus', [
    'i18n',
    'backendValues'
], function (
    i18n,
    {
        syncStates,
        accountPrivileges,
        privilegeTypes
    }
) {
    // const $syncDataAllActive = document.querySelector('#sync-data-all-active');
    const $syncActiveDataWorlds = document.querySelector('#sync-active-data-worlds');
    // const $syncAchievementsAllActive = document.querySelector('#sync-achievements-all-active');
    const $syncActiveAchievementWorlds = document.querySelector('#sync-active-achievement-worlds');

    function addActiveWorld ($container, worldId) {
        const $world = document.createElement('span');
        $world.innerHTML = worldId;
        $world.classList.add('world-label');
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
        const $world = document.querySelector('#world-' + worldId);

        const $dataSync = $world.querySelector('.sync-data');
        const $dataDate = $world.querySelector('.last-data-sync-date');
        const $dataStatus = $world.querySelector('.last-data-sync-status');

        const $achievementsSync = $world.querySelector('.sync-achievements');
        const $achievementsDate = $world.querySelector('.last-achievements-sync-date');
        const $achievementsStatus = $world.querySelector('.last-achievements-sync-status');

        switch (action) {
            case syncStates.START: {
                if ($dataSync) {
                    $dataSync.classList.add('disabled');
                    $dataSync.dataset.active = i18n('yes', 'admin_sync');
                }
                addActiveWorld($syncActiveDataWorlds, worldId);
                break;
            }
            case syncStates.FINISH: {
                if ($dataSync) {
                    $dataSync.classList.remove('disabled');
                    $dataSync.dataset.active = i18n('no', 'admin_sync');
                }
                $dataDate.innerHTML = date;
                $dataStatus.innerHTML = i18n(status, 'admin_sync_status');
                removeActiveWorld($syncActiveDataWorlds, worldId);
                break;
            }
            case syncStates.ACHIEVEMENT_START: {
                if ($achievementsSync) {
                    $dataSync.classList.add('disabled');
                    $achievementsSync.dataset.active = i18n('yes', 'admin_sync');
                }
                addActiveWorld($syncActiveAchievementWorlds, worldId);
                break;
            }
            case syncStates.ACHIEVEMENT_FINISH: {
                if ($achievementsSync) {
                    $dataSync.classList.remove('disabled');
                    $achievementsSync.dataset.active = i18n('no', 'admin_sync');
                }
                $achievementsDate.innerHTML = date;
                $achievementsStatus.innerHTML = i18n(status, 'admin_sync_status');
                removeActiveWorld($syncActiveAchievementWorlds, worldId);
                break;
            }
        }
    };
});

define('updateWorldSyncStatus', [
    'i18n',
    'backendValues'
], function (
    i18n,
    {
        syncStates
    }
) {
    return function updateWorldSyncStatus (running) {
        const $button = document.querySelector('#sync-world-list');
        $button.innerHTML = i18n('button_sync_world_list', 'admin_sync');

        if (running) {
            $button.classList.add('disabled');
        } else {
            $button.classList.remove('disabled');
        }
    };
});

define('updateWorldSyncEnabled', [
    'i18n',
    'backendValues'
], function (
    i18n,
    {
        syncStates
    }
) {
    return function updateWorldSyncEnabled ({marketId, worldNumber, enabled}) {
        const worldId = marketId + worldNumber;
        const $button = document.querySelector(`#world-${worldId} .sync-toggle`);

        if (enabled) {
            $button.classList.add('red');
            $button.classList.remove('green');
            $button.innerHTML = i18n('button_disable_sync', 'admin_sync');
        } else {
            $button.classList.add('green');
            $button.classList.remove('red');
            $button.innerHTML = i18n('button_enable_sync', 'admin_sync');
        }
    };
});

require([
    'updateAllWorldsStatus',
    'updateWorldStatus',
    'updateWorldSyncStatus',
    'updateWorldSyncEnabled',
    'backendValues'
], function (
    updateAllWorldsStatus,
    updateWorldStatus,
    updateWorldSyncStatus,
    updateWorldSyncEnabled,
    {
        development,
        syncStates,
        subPage,
        accountPrivileges,
        privilegeTypes
    }
) {
    function setupReloadlessActions () {
        const $worlds = document.querySelectorAll('#sync-worlds .world');
        const $worldButtons = Array.from($worlds).map(function ($world) {
            return [
                $world.querySelector('.sync-data'),
                $world.querySelector('.sync-achievements'),
                $world.querySelector('.sync-toggle')
            ];
        });

        for (const $buttons of $worldButtons) {
            for (const $button of $buttons) {
                if (!$button) {
                    continue;
                }

                $button.addEventListener('click', function (event) {
                    event.preventDefault();

                    if ($button.dataset.active) {
                        if ($button.dataset.active === 'no') {
                            fetch(this.href);
                            $button.dataset.active = 'yes';
                        }
                    } else {
                        fetch(this.href);
                    }
                });
            }
        }
    }

    function setupWorldListSync () {
        const $syncWorldList = document.querySelector('#sync-world-list');
        $syncWorldList.addEventListener('click', function (event) {
            event.preventDefault();

            if ($syncWorldList.dataset.active === 'no') {
                fetch(this.href);
                $syncWorldList.dataset.active = 'yes';
            }

            return false;
        });
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
                case syncStates.WORLDS_START: {
                    if (accountPrivileges[privilegeTypes.START_SYNC]) {
                        updateWorldSyncStatus(true);
                    }
                    break;
                }
                case syncStates.WORLDS_FINISH: {
                    if (accountPrivileges[privilegeTypes.START_SYNC]) {
                        updateWorldSyncStatus(false);
                    }
                    break;
                }
                case syncStates.TOGGLE_WORLD: {
                    if (accountPrivileges[privilegeTypes.CONTROL_SYNC]) {
                        updateWorldSyncEnabled(value);
                    }
                    break;
                }
                default: {
                    updateWorldStatus(value, action);
                    break;
                }
            }
        });
    }

    if (subPage === 'sync') {
        if (accountPrivileges[privilegeTypes.START_SYNC] || accountPrivileges[privilegeTypes.CONTROL_SYNC]) {
            setupReloadlessActions();
        }

        if (accountPrivileges[privilegeTypes.START_SYNC]) {
            setupWorldListSync();
        }

        setupSocket();
    }
});
