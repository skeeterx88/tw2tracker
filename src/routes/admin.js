const {db, sql} = require('../db.js');
const config = require('../config.js');
const i18n = require('../i18n.js');
const configMap = require('../config-map.json');

const syncCommands = require('../types/sync-commands.js');
const privilegeTypes = require('../types/privileges.js');
const syncStatusTypes = require('../types/sync-status.js');
const authErrors = require('../types/auth-error.js');

const privilegeTypesValue = Object.values(privilegeTypes);
const pgArray = require('pg').types.arrayParser;
const bcrypt = require('bcrypt');
const saltRounds = 10;
const createError = require('http-errors');
const humanInterval = require('human-interval');
const fs = require('fs');

const syncTypes = require('../types/sync.js');

const restrictionTypes = {
    ACCESS: 0,
    ACTION: 1
};

const syncTypeMapping = {
    [syncTypes.DATA]: {
        SYNC_COMMAND: syncCommands.DATA,
        SYNC_ALL_COMMAND: syncCommands.DATA_ALL,
        I18N_SUCCESS_MESSAGE: 'message_sync_data_world_started',
        I18N_ALL_SUCCESS_MESSAGE: 'message_sync_data_all_started'
    },
    [syncTypes.ACHIEVEMENTS]: {
        SYNC_COMMAND: syncCommands.ACHIEVEMENTS,
        SYNC_ALL_COMMAND: syncCommands.ACHIEVEMENTS_ALL,
        I18N_SUCCESS_MESSAGE: 'message_sync_achievements_world_started',
        I18N_ALL_SUCCESS_MESSAGE: 'message_sync_achievements_all_started'
    }
};

const {
    mergeBackendLocals,
    paramWorldParse,
    paramWorld
} = require('../router-helpers.js');

function emitSync (command, data) {
    return new Promise(function (resolve) {
        process.send({command, ...data});
        setTimeout(resolve, 100);
    });
}

const {
    CONTROL_SYNC,
    START_SYNC,
    MODIFY_ACCOUNTS,
    MODIFY_MODS,
    MODIFY_SETTINGS
} = privilegeTypes;

async function authAccount (request) {
    const [account] = await db.any(sql('get-mod-account-by-name'), {name: request.body.name});

    if (!account) {
        request.flash('errors', i18n(authErrors.ACCOUNT_NOT_EXIST, 'admin'));
        return false;
    }

    if (!account.enabled) {
        request.flash('errors', i18n(authErrors.ACCOUNT_NOT_ENABLED, 'admin'));
        return false;
    }

    const match = await bcrypt.compare(request.body.pass, account.pass);

    if (!match) {
        request.flash('errors', i18n(authErrors.INVALID_PASSWORD, 'admin'));
        return false;
    }

    const parsedPrivileges = typeof account.privileges === 'string' ? pgArray.create(account.privileges, String).parse() : account.privileges;
    const privilegeEntries = privilegeTypesValue.map(type => [type, parsedPrivileges.includes(type)]);

    return {
        id: account.id,
        name: account.name,
        privileges: Object.fromEntries(privilegeEntries)
    };
}

function createAdminMenu (account, selected) {
    const adminMenu = [
        ['sync', {
            enabled: true,
            selected: selected === 'sync'
        }],
        ['accounts', {
            enabled: account.privileges[MODIFY_ACCOUNTS],
            selected: selected === 'accounts'
        }],
        ['mods', {
            enabled: account.privileges[MODIFY_MODS],
            selected: selected === 'mods'
        }],
        ['settings', {
            enabled: account.privileges[MODIFY_SETTINGS],
            selected: selected === 'settings'
        }]
    ];

    return adminMenu.filter(function ([, data]) {
        return data.enabled;
    });
}

const authRouter = async function (request, reply) {
    request.session.account = await authAccount(request);

    if (!request.session.account) {
        reply.redirect('/admin/login');
    } else {
        reply.redirect('/admin');
    }
};

const loginRouter = async function (request, reply) {
    reply.view('admin.ejs', {
        title: i18n('admin_panel_login', 'page_titles', reply.locals.lang, [config('general', 'site_name')]),
        subPage: 'login',
        menu: false,
        errors: request.flash('errors'),
        messages: request.flash('messages')
    });
};

const logoutRouter = async function (request, reply) {
    request.session.account = null;
    reply.redirect('/admin/login');
};

const syncRouter = async function (request, reply) {
    const [
        openWorlds,
        closedWorlds,
        markets,
        syncQueue
    ] = await db.task(async tx => [
        await tx.any(sql('get-open-worlds')),
        await tx.any(sql('get-closed-worlds')),
        await tx.any(sql('get-markets')),
        await tx.any(sql('get-sync-queue'))
    ]);

    const syncQueueTyped = {
        data: [],
        achievements: []
    };

    const syncingWorlds = {
        data: [],
        achievements: []
    };

    for (const item of syncQueue) {
        if (item.active) {
            syncingWorlds[item.type].push(item.market_id + item.world_number);
        } else {
            syncQueueTyped[item.type].push(item);
        }
    }

    const subPage = 'sync';
    const menu = createAdminMenu(request.session.account, subPage);

    mergeBackendLocals(reply, {
        subPage,
        accountPrivileges: request.session.account.privileges,
        privilegeTypes
    });

    reply.view('admin.ejs', {
        title: i18n('admin_panel', 'page_titles', reply.locals.lang, [config('general', 'site_name')]),
        menu,
        subPage,
        openWorlds,
        closedWorlds,
        markets,
        syncingWorlds,
        syncQueueTyped,
        privilegeTypes,
        syncStatusTypes,
        errors: request.flash('errors'),
        messages: request.flash('messages')
    });
};

const syncTypeRouter = async function (request, reply) {
    const mapping = syncTypeMapping[request.params.type];

    if (!mapping) {
        throw createError(404, i18n('error_invalid_sync_type', 'admin', reply.locals.lang));
    }

    if (!paramWorld(request)) {
        request.flash('errors', i18n('error_world_not_found', 'admin', reply.locals.lang));
        return reply.redirect('/admin/sync');
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(request);

    const marketsWithAccounts = await db.map(sql('get-markets-with-accounts'), [], market => market.id);

    if (!marketsWithAccounts.includes(marketId)) {
        request.flash('errors', i18n('error_market_has_no_sync_accounts', 'admin', reply.locals.lang, [worldId]));
        return reply.redirect('/admin/sync');
    }

    await emitSync(mapping.SYNC_COMMAND, {
        marketId,
        worldNumber
    });

    request.flash('messages', i18n(mapping.I18N_SUCCESS_MESSAGE, 'admin', reply.locals.lang, [worldId]));
    reply.redirect(`/admin/sync#world-${worldId}`);
};

const syncTypeAllRouter = async function (request, reply) {
    const mapping = syncTypeMapping[request.params.type];

    if (!mapping) {
        throw createError(404, i18n('error_invalid_sync_type', 'admin', reply.locals.lang));
    }

    await emitSync(mapping.SYNC_ALL_COMMAND);

    request.flash('messages', i18n(mapping.I18N_ALL_SUCCESS_MESSAGE, 'admin', reply.locals.lang));
    reply.redirect('/admin/sync');
};

const scrapeMarketsRouter = async function (request, reply) {
    await emitSync(syncCommands.MARKETS);

    request.flash('messages', i18n('message_scrape_markets_started', 'admin', reply.locals.lang));
    reply.redirect('/admin/sync');
};

const scrapeWorldsRouter = async function (request, reply) {
    await emitSync(syncCommands.WORLDS);

    request.flash('messages', i18n('message_scrape_worlds_started', 'admin', reply.locals.lang));
    reply.redirect('/admin/sync');
};

const toggleSyncRouter = async function (request, reply) {
    if (!paramWorld(request)) {
        request.flash('errors', i18n('error_world_not_found', 'admin', reply.locals.lang));
        return reply.redirect('/admin/sync');
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(request);

    await emitSync(syncCommands.TOGGLE, {
        marketId,
        worldNumber
    });

    request.flash('messages', i18n('message_world_toggled', 'admin', reply.locals.lang, [worldId]));
    reply.redirect(`/admin/sync#world-${worldId}`);
};

const resetQueueRouter = async function (request, reply) {
    const type = request.params.type;

    if (!Object.values(syncTypes).includes(type)) {
        request.flash('errors', i18n('error_invalid_sync_type', 'admin', reply.locals.lang, [type]));
        return reply.redirect('/admin/sync');
    }

    const command = type === syncTypes.ACHIEVEMENTS
        ? syncCommands.ACHIEVEMENTS_RESET_QUEUE
        : syncCommands.DATA_RESET_QUEUE;

    await emitSync(command);

    request.flash('messages', i18n('message_sync_queue_reseted', 'admin', reply.locals.lang, [type]));
    reply.redirect('/admin/sync');
};

const accountsRouter = async function (request, reply) {
    const markets = await db.map(sql('get-markets'), [], market => market.id);
    const accounts = await db.map(sql('get-accounts'), [], function (account) {
        account.missingMarkets = getMissingMarkets(account.markets || [], markets);
        return account;
    });

    function getMissingMarkets (accountMarkets, markets) {
        return markets.filter(function (marketId) {
            return !accountMarkets.includes(marketId);
        });
    }

    const subPage = 'accounts';
    const menu = createAdminMenu(request.session.account, subPage);

    mergeBackendLocals(reply, {
        subPage
    });

    reply.view('admin.ejs', {
        title: i18n('admin_panel_sync_accounts', 'page_titles', reply.locals.lang, [config('general', 'site_name')]),
        menu,
        subPage,
        accounts,
        markets,
        errors: request.flash('errors'),
        messages: request.flash('messages')
    });
};

const accountsAddMarketRouter = async function (request, reply) {
    const accountId = request.params.accountId;
    const marketId = request.params.marketId;
    const account = await db.any(sql('get-account'), {accountId});
    const market = await db.any(sql('get-market'), {marketId});

    if (!account.length) {
        request.flash('errors', i18n('error_sync_account_not_exist', 'admin', reply.locals.lang));
    } else if (!market.length) {
        request.flash('errors', i18n('error_sync_market_not_exist', 'admin', reply.locals.lang, [marketId.toUpperCase()]));
    } else if (account[0].markets.includes(marketId)) {
        request.flash('errors', i18n('error_sync_account_market_included', 'admin', reply.locals.lang, [marketId.toUpperCase()]));
    } else {
        request.flash('messages', i18n('message_sync_account_market_added', 'admin', reply.locals.lang, [marketId.toUpperCase()]));
        await db.query(sql('add-account-market'), {accountId, marketId});
    }

    reply.redirect(`/admin/accounts#account-${accountId}`);
};

const accountsRemoveMarketRouter = async function (request, reply) {
    const accountId = request.params.accountId;
    const marketId = request.params.marketId;
    const account = await db.any(sql('get-account'), {accountId});
    const market = await db.any(sql('get-market'), {marketId});

    if (!account.length) {
        request.flash('errors', i18n('error_sync_account_not_exist', 'admin', reply.locals.lang, [accountId]));
    } else if (!market.length) {
        request.flash('errors', i18n('error_sync_market_not_exist', 'admin', reply.locals.lang, [marketId.toUpperCase()]));
    } else if (!account[0].markets.includes(marketId)) {
        request.flash('errors', i18n('error_sync_account_market_included', 'admin', reply.locals.lang));
    } else {
        request.flash('messages', i18n('message_sync_account_market_removed', 'admin', reply.locals.lang));
        await db.query(sql('remove-account-market'), {accountId, marketId});
    }

    reply.redirect(`/admin/accounts#account-${accountId}`);
};

const accountsDeleteRouter = async function (request, reply) {
    const accountId = request.params.accountId;
    const account = await db.any(sql('get-account'), {accountId});

    if (!account.length) {
        request.flash('errors', i18n('error_sync_account_not_exist', 'admin', reply.locals.lang, [accountId]));
    } else if (account.id === request.session.account.id) {
        request.flash('errors', i18n('error_sync_account_delete_own', 'admin', reply.locals.lang));
    } else {
        request.flash('messages', i18n('message_sync_account_deleted', 'admin', reply.locals.lang));
        await db.query(sql('delete-account'), {accountId});
    }

    reply.redirect('/admin/accounts');
};

const accountsEditRouter = async function (request, reply) {
    const {name, pass, id: accountId} = request.body;
    const account = await db.any(sql('get-account'), {accountId});

    if (!account.length) {
        request.flash('errors', i18n('error_sync_account_not_exist', 'admin', reply.locals.lang, [accountId]));
    } else if (pass.length < config('sync_accounts', 'min_password_length')) {
        request.flash('errors', i18n('error_password_minimum_length', 'admin', reply.locals.lang, [4]));
    } else if (name.length < config('sync_accounts', 'min_username_length')) {
        request.flash('errors', i18n('error_username_minimum_length', 'admin', reply.locals.lang, [4]));
    } else {
        request.flash('messages', i18n('message_sync_account_altered', 'admin', reply.locals.lang));
        await db.query(sql('edit-account'), {accountId, name, pass});
    }

    reply.redirect(`/admin/accounts#account-${accountId}`);
};

const accountsCreateRouter = async function (request, reply) {
    const {name, pass, id: accountId} = request.body;

    if (pass.length < config('sync_accounts', 'min_password_length')) {
        request.flash('errors', i18n('error_password_minimum_length', 'admin', reply.locals.lang, [4]));
    } else if (name.length < config('sync_accounts', 'min_username_length')) {
        request.flash('errors', i18n('error_username_minimum_length', 'admin', reply.locals.lang, [4]));
    } else {
        const accountExists = await db.any(sql('get-account-by-name'), {name});

        if (accountExists.length) {
            request.flash('errors', i18n('error_sync_username_already_exists', 'admin', reply.locals.lang, [name]));
        } else {
            request.flash('messages', i18n('message_sync_account_added', 'admin', reply.locals.lang));
            await db.query(sql('add-account'), {name, pass});
        }
    }

    reply.redirect(`/admin/accounts#account-${accountId}`);
};

const modsRouter = async function (request, reply) {
    const mods = await db.map(sql('get-mods'), [], function (mod) {
        mod.privileges = pgArray.create(mod.privileges, String).parse();
        return mod;
    });

    const subPage = 'mods';
    const menu = createAdminMenu(request.session.account, subPage);

    mergeBackendLocals(reply, {
        subPage
    });

    reply.view('admin.ejs', {
        title: i18n('admin_panel_mod_accounts', 'page_titles', reply.locals.lang, [config('general', 'site_name')]),
        menu,
        subPage,
        mods,
        privilegeTypes,
        errors: request.flash('errors'),
        messages: request.flash('messages')
    });
};

const modsEditRouter = async function (request, reply) {
    const {name, pass, email} = request.body;
    let {id, privileges} = request.body;

    id = parseInt(id, 10);

    if (!privileges) {
        privileges = [];
    } else if (typeof privileges === 'string') {
        privileges = [privileges];
    }

    const me = request.session.account;
    const [mod] = await db.any(sql('get-mod'), {id});
    const [accountName] = await db.any(sql('get-mod-account-by-name'), {name});
    const [accountEmail] = await db.any(sql('get-mod-account-by-email'), {email});

    if (!mod) {
        request.flash('errors', i18n('error_mod_account_not_exists', 'admin', reply.locals.lang));
        return reply.redirect('/admin/mods');
    } else if (name.length < config('mod_accounts', 'min_username_length')) {
        request.flash('errors', i18n('error_username_minimum_length', 'admin', reply.locals.lang, [3]));
        return reply.redirect('/admin/mods');
    } else if (pass && pass.length < config('mod_accounts', 'min_password_length')) {
        request.flash('errors', i18n('error_password_minimum_length', 'admin', reply.locals.lang, [4]));
        return reply.redirect('/admin/mods');
    } else if (accountName && accountName.id !== id) {
        request.flash('errors', i18n('error_mod_username_already_exists', 'admin', reply.locals.lang));
        return reply.redirect('/admin/mods');
    } else if (accountEmail && accountEmail.id !== id) {
        request.flash('errors', i18n('error_mod_account_email_already_exists', 'admin', reply.locals.lang));
        return reply.redirect('/admin/mods');
    } else if (privileges.some(type => !privilegeTypesValue.includes(type))) {
        request.flash('errors', i18n('error_invalid_privilege', 'admin', reply.locals.lang));
        return reply.redirect('/admin/mods');
    } else if (me.id === mod.id && me.privileges[MODIFY_MODS] && !privileges.includes(MODIFY_MODS)) {
        request.flash('errors', i18n('error_can_not_remove_self_modify_mods_priv', 'admin', reply.locals.lang));
        return reply.redirect('/admin/mods');
    } else {
        if (pass) {
            const hash = await bcrypt.hash(pass, saltRounds);
            await db.query(sql('update-mod-account'), {id, name, pass: hash, privileges, email});
        } else {
            await db.query(sql('update-mod-account-keep-pass'), {id, name, privileges, email});
        }

        if (id === request.session.account.id) {
            request.session.account = null;
            reply.redirect('/admin/login');

            return request.logIn({id, name, privileges}, function (error) {
                if (error) {
                    request.flash('errors', error);
                } else {
                    request.flash('messages', i18n('message_mod_account_altered', 'admin', reply.locals.lang));
                }

                reply.redirect(`/admin/mods#mod-${id}`);
            });
        } else {
            request.flash('messages', i18n('message_mod_account_altered', 'admin', reply.locals.lang));
            reply.redirect(`/admin/mods#mod-${id}`);
        }
    }
};

const modsCreateRouter = async function (request, reply) {
    const {name, pass, email} = request.body;
    let {privileges} = request.body;

    if (!privileges) {
        privileges = [];
    } else if (typeof privileges === 'string') {
        privileges = [privileges];
    }

    const [accountName] = await db.any(sql('get-mod-account-by-name'), {name});
    const [accountEmail] = await db.any(sql('get-mod-account-by-email'), {email});

    if (name.length < config('mod_accounts', 'min_username_length')) {
        request.flash('errors', i18n('error_username_minimum_length', 'admin', reply.locals.lang, [3]));
    } else if (pass.length < config('mod_accounts', 'min_password_length')) {
        request.flash('errors', i18n('error_password_minimum_length', 'admin', reply.locals.lang, [4]));
    } else if (accountName) {
        request.flash('errors', i18n('error_mod_username_already_exists', 'admin', reply.locals.lang));
    } else if (accountEmail) {
        request.flash('errors', i18n('error_mod_account_email_already_exists', 'admin', reply.locals.lang));
    } else if (privileges.some(type => !privilegeTypesValue.includes(type))) {
        request.flash('errors', i18n('error_invalid_privilege', 'admin', reply.locals.lang));
    } else {
        const hash = await bcrypt.hash(pass, saltRounds);
        const {id} = await db.one(sql('create-mod-account'), {name, pass: hash, privileges, email});
        request.flash('messages', i18n('message_mod_account_created', 'admin', reply.locals.lang));
        return reply.redirect(`/admin/mods#mod-${id}`);
    }

    reply.redirect('/admin/mods');
};

const modsDeleteRouter = async function (request, reply) {
    const {id} = request.params;

    const [mod] = await db.any(sql('get-mod'), {id});

    if (!mod) {
        request.flash('errors', i18n('error_mod_account_not_exists', 'admin', reply.locals.lang));
    } else if (mod.id === request.session.account.id) {
        request.flash('errors', i18n('error_can_not_delete_yourself', 'admin', reply.locals.lang));
    } else {
        request.flash('messages', i18n('message_mod_account_deleted', 'admin', reply.locals.lang));
        await db.query(sql('delete-mod-account'), {id});
    }

    reply.redirect('/admin/mods');
};

const settingsRouter = async function (request, reply) {
    const subPage = 'settings';
    const menu = createAdminMenu(request.session.account, subPage);

    mergeBackendLocals(reply, {
        subPage,
        accountPrivileges: request.session.account.privileges,
        privilegeTypes
    });

    reply.view('admin.ejs', {
        title: i18n('admin_panel', 'page_titles', reply.locals.lang, [config('general', 'site_name')]),
        menu,
        subPage,
        privilegeTypes,
        config,
        configMap,
        errors: request.flash('errors'),
        messages: request.flash('messages')
    });
};

const settingsEditRouter = async function (request, reply) {
    const newConfig = {};
    let updated = false;
    /** @type {[String, String][]} */
    const bodyEntries = Object.entries(request.body);

    for (const [id, value] of bodyEntries) {
        const [category, configId] = id.split('/');
        newConfig[category] = newConfig[category] || {};

        const map = configMap[category][configId];

        switch (map.type) {
            case 'number': {
                const parsed = parseInt(value, 10);

                if (isNaN(parsed)) {
                    request.flash('errors', i18n('error_invalid_not_a_number', 'admin_settings', reply.locals.lang, [category + ':' + configId]));
                    newConfig[category][configId] = config[category][configId];
                } else if (parsed < map.min || parsed > map.max) {
                    request.flash('errors', i18n('error_invalid_number_range', 'admin_settings', reply.locals.lang, [category + ':' + configId, map.min, map.max]));
                    newConfig[category][configId] = config[category][configId];
                } else {
                    updated = true;
                    newConfig[category][configId] = parsed;
                }
                break;
            }
            case 'time': {
                const parsed = humanInterval(value);

                if (isNaN(parsed)) {
                    request.flash('errors', i18n('error_invalid_time_format', 'admin_settings', reply.locals.lang, category + ':' + configId));
                    newConfig[category][configId] = config[category][configId];
                } else {
                    updated = true;
                    newConfig[category][configId] = value;
                }
                break;
            }
            default: {
                updated = true;
                newConfig[category][configId] = value;
                break;
            }
        }
    }

    if (updated) {
        request.flash('messages', i18n('message_settings_changed', 'admin_settings', reply.locals.lang));
        fs.writeFileSync('./config.json', JSON.stringify(newConfig, null, 4), 'utf-8');
    }

    reply.redirect('/admin/settings');
};

module.exports = async function (fastify) {
    fastify.register(require('fastify-auth'));

    function createRestriction (id, privilege, denyType) {
        fastify.decorate(id, async function (request, reply) {
            if (!request.session.account.privileges[privilege]) {
                switch (denyType) {
                    case restrictionTypes.ACCESS: {
                        throw createError(401, i18n('error_not_authorized_access', 'admin', reply.locals.lang));
                    }
                    case restrictionTypes.ACTION: {
                        throw createError(401, i18n('error_not_authorized_action', 'admin', reply.locals.lang));
                    }
                }
            }
        });
    }

    createRestriction('authControlSyncAction', CONTROL_SYNC, restrictionTypes.ACTION);
    createRestriction('authStartSyncAction', START_SYNC, restrictionTypes.ACTION);
    createRestriction('authModifyAccountsAccess', MODIFY_ACCOUNTS, restrictionTypes.ACCESS);
    createRestriction('authModifyAccountsAction', MODIFY_ACCOUNTS, restrictionTypes.ACTION);
    createRestriction('authModifyModsAccess', MODIFY_MODS, restrictionTypes.ACCESS);
    createRestriction('authModifyModsAction', MODIFY_MODS, restrictionTypes.ACTION);
    createRestriction('authModifySettingsAccess', MODIFY_SETTINGS, restrictionTypes.ACCESS);
    createRestriction('authModifySettingsAction', MODIFY_SETTINGS, restrictionTypes.ACTION);

    fastify.decorate('requireAuth', async function (request, reply) {
        if (!request.session.account) {
            reply.redirect('/admin/login');
        }
    });

    await fastify.after();

    fastify.route({
        method: 'POST',
        url: '/admin/login',
        handler: authRouter
    });

    fastify.route({
        method: 'GET',
        url: '/admin/login',
        handler: loginRouter
    });

    fastify.route({
        method: 'GET',
        url: '/admin/logout',
        handler: logoutRouter
    });

    fastify.route({
        method: 'GET',
        url: '/admin',
        handler: (request, reply) => reply.redirect('/admin/sync')
    });

    fastify.route({
        method: 'GET',
        url: '/admin/sync',
        preHandler: fastify.auth([
            fastify.requireAuth
        ]),
        handler: syncRouter
    });

    fastify.route({
        method: 'GET',
        url: '/admin/sync/:type/:marketId/:worldNumber',
        preHandler: fastify.auth([
            fastify.requireAuth,
            fastify.authStartSyncAction
        ], {
            relation: 'and'
        }),
        handler: syncTypeRouter
    });

    fastify.route({
        method: 'GET',
        url: '/admin/sync/:type/all',
        preHandler: fastify.auth([
            fastify.requireAuth,
            fastify.authStartSyncAction
        ], {
            relation: 'and'
        }),
        handler: syncTypeAllRouter
    });

    fastify.route({
        method: 'GET',
        url: '/admin/sync/markets',
        preHandler: fastify.auth([
            fastify.requireAuth,
            fastify.authStartSyncAction
        ], {
            relation: 'and'
        }),
        handler: scrapeMarketsRouter
    });

    fastify.route({
        method: 'GET',
        url: '/admin/sync/worlds',
        preHandler: fastify.auth([
            fastify.requireAuth,
            fastify.authStartSyncAction
        ], {
            relation: 'and'
        }),
        handler: scrapeWorldsRouter
    });

    fastify.route({
        method: 'GET',
        url: '/admin/sync/toggle/:marketId/:worldNumber',
        preHandler: fastify.auth([
            fastify.requireAuth,
            fastify.authControlSyncAction
        ], {
            relation: 'and'
        }),
        handler: toggleSyncRouter
    });

    fastify.route({
        method: 'GET',
        url: '/admin/sync/queue/:type/reset',
        preHandler: fastify.auth([
            fastify.requireAuth,
            fastify.authStartSyncAction
        ], {
            relation: 'and'
        }),
        handler: resetQueueRouter
    });

    fastify.route({
        method: 'GET',
        url: '/admin/accounts',
        preHandler: fastify.auth([
            fastify.requireAuth,
            fastify.authModifyAccountsAccess
        ], {
            relation: 'and'
        }),
        handler: accountsRouter
    });

    fastify.route({
        method: 'GET',
        url: '/admin/accounts/markets/add/:accountId/:marketId',
        preHandler: fastify.auth([
            fastify.requireAuth,
            fastify.authModifyAccountsAction
        ], {
            relation: 'and'
        }),
        handler: accountsAddMarketRouter
    });

    fastify.route({
        method: 'GET',
        url: '/admin/accounts/markets/remove/:accountId/:marketId',
        preHandler: fastify.auth([
            fastify.requireAuth,
            fastify.authModifyAccountsAction
        ], {
            relation: 'and'
        }),
        handler: accountsRemoveMarketRouter
    });

    fastify.route({
        method: 'GET',
        url: '/admin/accounts/delete/:accountId',
        preHandler: fastify.auth([
            fastify.requireAuth,
            fastify.authModifyAccountsAction
        ], {
            relation: 'and'
        }),
        handler: accountsDeleteRouter
    });

    fastify.route({
        method: 'POST',
        url: '/admin/accounts/edit',
        preHandler: fastify.auth([
            fastify.requireAuth,
            fastify.authModifyAccountsAction
        ], {
            relation: 'and'
        }),
        handler: accountsEditRouter
    });

    fastify.route({
        method: 'POST',
        url: '/admin/accounts/create',
        preHandler: fastify.auth([
            fastify.requireAuth,
            fastify.authModifyAccountsAction
        ], {
            relation: 'and'
        }),
        handler: accountsCreateRouter
    });

    fastify.route({
        method: 'GET',
        url: '/admin/mods',
        preHandler: fastify.auth([
            fastify.requireAuth,
            fastify.authModifyModsAccess
        ], {
            relation: 'and'
        }),
        handler: modsRouter
    });

    fastify.route({
        method: 'POST',
        url: '/admin/mods/edit',
        preHandler: fastify.auth([
            fastify.requireAuth,
            fastify.authModifyModsAction
        ], {
            relation: 'and'
        }),
        handler: modsEditRouter
    });

    fastify.route({
        method: 'POST',
        url: '/admin/mods/create',
        preHandler: fastify.auth([
            fastify.requireAuth,
            fastify.authModifyModsAction
        ], {
            relation: 'and'
        }),
        handler: modsCreateRouter
    });

    fastify.route({
        method: 'GET',
        url: '/admin/mods/delete/:id',
        preHandler: fastify.auth([
            fastify.requireAuth,
            fastify.authModifyModsAction
        ], {
            relation: 'and'
        }),
        handler: modsDeleteRouter
    });

    fastify.route({
        method: 'GET',
        url: '/admin/settings',
        preHandler: fastify.auth([
            fastify.requireAuth,
            fastify.authModifySettingsAccess
        ], {
            relation: 'and'
        }),
        handler: settingsRouter
    });

    fastify.route({
        method: 'POST',
        url: '/admin/settings/edit',
        preHandler: fastify.auth([
            fastify.requireAuth,
            fastify.authModifySettingsAction
        ], {
            relation: 'and'
        }),
        handler: settingsEditRouter
    });
};
