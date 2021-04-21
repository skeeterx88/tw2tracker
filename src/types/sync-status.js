/**
 * @enum {String}
 */
const syncStatus = {
    SUCCESS: 'success',
    FAIL: 'fail',
    ALREADY_SYNCED: 'already_synced',
    NO_ACCOUNTS: 'no_accounts',
    AUTH_FAILED: 'auth_failed',
    WORLD_CLOSED: 'world_closed',
    NOT_ENABLED: 'not_enabled',
    ALL_ACCOUNTS_FAILED: 'all_accounts_failed',
    TIMEOUT: 'timeout',
    IN_PROGRESS: 'in_progress',
    FAILED_TO_SELECT_CHARACTER: 'failed_to_select_character',
    WORLD_IN_MAINTENANCE: 'world_in_maintenance'
};

module.exports = syncStatus;
