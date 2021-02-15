module.exports = {
    SYNC_SUCCESS: 'success',
    SYNC_FAIL: 'fail',
    SYNC_ALREADY_SYNCED: 'already_synced',
    SYNC_WORLD_CLOSED: 'world_closed',

    SYNC_DATA_START: 'sync_data_start',
    SYNC_DATA_FINISH: 'sync_data_finish',
    SYNC_DATA_ALL_START: 'sync_data_all_start',
    SYNC_DATA_ALL_FINISH: 'sync_data_all_finish',
    SYNC_ACHIEVEMENTS_START: 'sync_achievements_start',
    SYNC_ACHIEVEMENTS_FINISH: 'sync_achievements_finish',
    SYNC_ACHIEVEMENTS_ALL_START: 'sync_achievements_all_start',
    SYNC_ACHIEVEMENTS_ALL_FINISH: 'sync_achievements_all_finish',
    SYNC_WORLDS_START: 'sync_worlds_start',
    SYNC_WORLDS_FINISH: 'sync_worlds_finish',

    IGNORE_LAST_SYNC: 'ignore_last_sync',

    SYNC_REQUEST_STATUS: 'request_sync_status',
    SYNC_REQUEST_SYNC_DATA: 'sync_request_sync_data',
    SYNC_REQUEST_SYNC_DATA_ALL: 'sync_request_sync_data_all',
    SYNC_REQUEST_SYNC_ACHIEVEMENTS: 'sync_request_sync_achievements',
    SYNC_REQUEST_SYNC_ACHIEVEMENTS_ALL: 'sync_request_sync_achievements_all',
    SYNC_REQUEST_SYNC_MARKETS: 'sync_request_sync_markets',
    SYNC_REQUEST_SYNC_WORLDS: 'sync_request_sync_worlds',
    EMPTY_CONTINENT: 'empty_continent',
    achievementCommitTypes: {
        ADD: 'add',
        UPDATE: 'update'
    },
    syncStates: {
        START: 'start',
        FINISH: 'finish',
        UPDATE: 'update',
        ACHIEVEMENT_START: 'achievement_start',
        ACHIEVEMENT_FINISH: 'achievement_finish',
        WORLDS_START: 'worlds_start',
        WORLDS_FINISH: 'worlds_finish'
    },
    mapShareTypes: {
        STATIC: 'static',
        DYNAMIC: 'dynamic'
    },
    conquestTypes: {
        GAIN: 'gain',
        LOSS: 'loss',
        SELF: 'self'
    },
    tribeMemberChangeTypes: {
        LEFT: 'left',
        JOIN: 'join'
    }
};
