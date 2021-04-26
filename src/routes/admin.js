const {Router} = require('express');
const {ensureLoggedIn} = require('connect-ensure-login');

const {db, sql} = require('../db.js');
const config = require('../config.js');
const i18n = require('../i18n.js');
const syncCommands = require('../types/sync-commands.js');
const privilegeTypes = require('../types/privileges.js');
const configMap = require('../types/config-map.json');
const privilegeTypesValue = Object.values(privilegeTypes);
const pgArray = require('pg').types.arrayParser;
const bcrypt = require('bcrypt');
const saltRounds = 10;
const createError = require('http-errors');
const passport = require('passport');
const humanInterval = require('human-interval');
const fs = require('fs');

const syncTypes = require('../types/sync.js');

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
    asyncRouter,
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

            return res.redirect('/admin');
        });
    })(req, res, next);
});

function createAdminMenu (user, selected) {
    const adminMenu = [
        ['sync', {
            enabled: true,
            selected: selected === 'sync'
        }],
        ['accounts', {
            enabled: user.privileges[privilegeTypes.MODIFY_ACCOUNTS],
            selected: selected === 'accounts'
        }],
        ['mods', {
            enabled: user.privileges[privilegeTypes.MODIFY_MODS],
            selected: selected === 'mods'
        }],
        ['settings', {
            enabled: user.privileges[privilegeTypes.MODIFY_SETTINGS],
            selected: selected === 'settings'
        }]
    ];

    return adminMenu.filter(function ([, data]) {
        return data.enabled;
    });
}

function createAuthorization (privilege, denyType) {
    return function (req, res, next) {
        if (req.user.privileges[privilege]) {
            next();
        } else {
            switch (denyType) {
                case 'access': {
                    throw createError(401, i18n('error_not_authorized_access', 'admin', res.locals.lang));
                }
                case 'action': {
                    req.flash('error', i18n('error_not_authorized_action', 'admin', res.locals.lang));
                    res.redirect('back');
                }
            }
        } 
    };
}

const loginRouter = asyncRouter(async function (req, res) {
    res.render('admin', {
        title: i18n('admin_panel_login', 'page_titles', res.locals.lang, [config('general', 'site_name')]),
        subPage: 'login',
        menu: false,
        errors: request.flash('errors'),
        messages: request.flash('messages')
    });
});

const logoutRouter = asyncRouter(async function (req, res) {
    req.logout();
    res.redirect('/admin/login');
});

const syncRouter = asyncRouter(async function (req, res) {
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
    const menu = createAdminMenu(req.user, subPage);

    mergeBackendLocals(res, {
        subPage,
        accountPrivileges: req.user.privileges,
        privilegeTypes
    });

    res.render('admin', {
        title: i18n('admin_panel', 'page_titles', res.locals.lang, [config('general', 'site_name')]),
        menu,
        subPage,
        openWorlds,
        closedWorlds,
        markets,
        syncingWorlds,
        syncQueueTyped,
        privilegeTypes,
        errors: request.flash('errors'),
        messages: request.flash('messages')
    });
});

const syncTypeRouter = asyncRouter(async function (req, res) {
    const mapping = syncTypeMapping[req.params.type];

    if (!mapping) {
        throw createError(404, i18n('error_invalid_sync_type', 'admin', res.locals.lang));
    }

    if (!paramWorld(request)) {
        request.flash('errors', i18n('error_world_not_found', 'admin', reply.locals.lang));
        return reply.redirect('/admin/sync');
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req);

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

const syncTypeAllRouter = asyncRouter(async function (req, res) {
    const mapping = syncTypeMapping[req.params.type];

    if (!mapping) {
        throw createError(404, i18n('error_invalid_sync_type', 'admin', res.locals.lang));
    }

    await emitSync(mapping.SYNC_ALL_COMMAND);

    request.flash('messages', i18n(mapping.I18N_ALL_SUCCESS_MESSAGE, 'admin', reply.locals.lang));
    reply.redirect('/admin/sync');
};

const scrapeMarketsRouter = asyncRouter(async function (req, res) {
    await emitSync(syncCommands.MARKETS);

    request.flash('messages', i18n('message_scrape_markets_started', 'admin', reply.locals.lang));
    reply.redirect('/admin/sync');
};

const scrapeWorldsRouter = asyncRouter(async function (req, res) {
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
    } = await paramWorldParse(req);

    await emitSync(syncCommands.TOGGLE, {
        marketId,
        worldNumber
    });

    request.flash('messages', i18n('message_world_toggled', 'admin', reply.locals.lang, [worldId]));
    reply.redirect(`/admin/sync#world-${worldId}`);
};

const resetQueueRouter = asyncRouter(async function (req, res) {
    const type = req.params.type;

    if (!Object.values(syncTypes).includes(type)) {
        request.flash('errors', i18n('error_invalid_sync_type', 'admin', reply.locals.lang, [type]));
        return reply.redirect('/admin/sync');
    }

    await emitSync(syncCommands.DATA_RESET_QUEUE);

    request.flash('messages', i18n('message_sync_queue_reseted', 'admin', reply.locals.lang, [type]));
    reply.redirect('/admin/sync');
};

const accountsRouter = asyncRouter(async function (req, res) {
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
    const menu = createAdminMenu(req.user, subPage);

    mergeBackendLocals(res, {        
        subPage
    });

    res.render('admin', {
        title: i18n('admin_panel_sync_accounts', 'page_titles', res.locals.lang, [config('general', 'site_name')]),
        menu,
        subPage,
        accounts,
        markets,
        errors: request.flash('errors'),
        messages: request.flash('messages')
    });
});

const accountsAddMarketRouter = asyncRouter(async function (req, res) {
    const accountId = req.params.accountId;
    const marketId = req.params.marketId;
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

    res.redirect(`/admin/accounts#account-${accountId}`);
});

const accountsRemoveMarketRouter = asyncRouter(async function (req, res) {
    const accountId = req.params.accountId;
    const marketId = req.params.marketId;
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

    res.redirect(`/admin/accounts#account-${accountId}`);
});

const accountsDeleteRouter = asyncRouter(async function (req, res) {
    const accountId = req.params.accountId;
    const account = await db.any(sql('get-account'), {accountId});

    if (!account.length) {
        request.flash('errors', i18n('error_sync_account_not_exist', 'admin', reply.locals.lang, [accountId]));
    } else if (account.id === request.session.account.id) {
        request.flash('errors', i18n('error_sync_account_delete_own', 'admin', reply.locals.lang));
    } else {
        request.flash('messages', i18n('message_sync_account_deleted', 'admin', reply.locals.lang));
        await db.query(sql('delete-account'), {accountId});
    }

    res.redirect('/admin/accounts');
});

const accountsEditRouter = asyncRouter(async function (req, res) {
    const {name, pass, id: accountId} = req.body;
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

    res.redirect(`/admin/accounts#account-${accountId}`);
});

const accountsCreateRouter = asyncRouter(async function (req, res) {
    const {name, pass, id: accountId} = req.body;

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

    res.redirect(`/admin/accounts#account-${accountId}`);
});

const modsRouter = asyncRouter(async function (req, res) {
    const mods = await db.map(sql('get-mods'), [], function (mod) {
        mod.privileges = pgArray.create(mod.privileges, String).parse();
        return mod;
    });

    const subPage = 'mods';
    const menu = createAdminMenu(req.user, subPage);

    mergeBackendLocals(res, {
        subPage
    });

    res.render('admin', {
        title: i18n('admin_panel_mod_accounts', 'page_titles', res.locals.lang, [config('general', 'site_name')]),
        menu,
        subPage,
        mods,
        privilegeTypes,
        errors: request.flash('errors'),
        messages: request.flash('messages')
    });
});

const modsEditRouter = asyncRouter(async function (req, res) {
    const {name, pass, email} = req.body;
    let {id, privileges} = req.body;

    id = parseInt(id, 10);

    if (!privileges) {
        privileges = [];
    } else if (typeof privileges === 'string') {
        privileges = [privileges];
    }

    const me = req.session.passport.user;
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

        if (id === req.user.id) {
            req.logout();
            res.redirect('/admin/login');

            return req.logIn({id, name, privileges}, function (error) {
                if (error) {
                    request.flash('errors', error);
                } else {
                    request.flash('messages', i18n('message_mod_account_altered', 'admin', reply.locals.lang));
                }

                res.redirect(`/admin/mods#mod-${id}`);
            });
        } else {
            request.flash('messages', i18n('message_mod_account_altered', 'admin', reply.locals.lang));
            reply.redirect(`/admin/mods#mod-${id}`);
        }
    }
});

const modsCreateRouter = asyncRouter(async function (req, res) {
    const {name, pass, email} = req.body;
    let {privileges} = req.body;

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

    res.redirect('/admin/mods');
});

const modsDeleteRouter = asyncRouter(async function (req, res) {
    const {id} = req.params;

    const [mod] = await db.any(sql('get-mod'), {id});

    if (!mod) {
        request.flash('errors', i18n('error_mod_account_not_exists', 'admin', reply.locals.lang));
    } else if (mod.id === request.session.account.id) {
        request.flash('errors', i18n('error_can_not_delete_yourself', 'admin', reply.locals.lang));
    } else {
        request.flash('messages', i18n('message_mod_account_deleted', 'admin', reply.locals.lang));
        await db.query(sql('delete-mod-account'), {id});
    }

    res.redirect('/admin/mods');
});

const settingsRouter = asyncRouter(async function (req, res) {
    const subPage = 'settings';
    const menu = createAdminMenu(req.user, subPage);

    mergeBackendLocals(res, {
        subPage,
        accountPrivileges: req.user.privileges,
        privilegeTypes
    });

    res.render('admin', {
        title: i18n('admin_panel', 'page_titles', res.locals.lang, [config('general', 'site_name')]),
        menu,
        subPage,
        privilegeTypes,
        user: req.user,
        config,
        configMap,
        errors: request.flash('errors'),
        messages: request.flash('messages')
    });
});

const settingsEditRouter = asyncRouter(async function (req, res) {
    const newConfig = {};
    let updated = false;
    /** @type {[String, String][]} */
    const bodyEntries = Object.entries(req.body);

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

    res.redirect('/admin/settings');
});

const {
    CONTROL_SYNC,
    START_SYNC,
    MODIFY_ACCOUNTS,
    MODIFY_MODS,
    MODIFY_SETTINGS
} = privilegeTypes;

const authControlSyncAction = createAuthorization(CONTROL_SYNC, 'action');
const authStartSyncAction = createAuthorization(START_SYNC, 'action');
const authModifyAccountsAccess = createAuthorization(MODIFY_ACCOUNTS, 'access');
const authModifyAccountsAction = createAuthorization(MODIFY_ACCOUNTS, 'action');
const authModifyModsAccess = createAuthorization(MODIFY_MODS, 'access');
const authModifyModsAction = createAuthorization(MODIFY_MODS, 'action');
const authModifySettingsAccess = createAuthorization(MODIFY_SETTINGS, 'access');
const authModifySettingsAction = createAuthorization(MODIFY_SETTINGS, 'action');

const router = Router();

router.get('/login', loginRouter);
router.post('/login', authRouter);
router.use(ensureLoggedIn('/admin/login'));
router.get('/logout', logoutRouter);

router.get('/', syncRouter);
router.get('/sync', syncRouter);
router.get('/sync/data/all', authStartSyncAction, syncTypeAllRouter);
router.get('/sync/:type/:marketId/:worldNumber', authStartSyncAction, syncTypeRouter);
router.get('/sync/achievements/all', authStartSyncAction, syncTypeAllRouter);
router.get('/sync/:type/:marketId/:worldNumber', authStartSyncAction, syncTypeRouter);
router.get('/sync/markets', authStartSyncAction, scrapeMarketsRouter);
router.get('/sync/worlds', authStartSyncAction, scrapeWorldsRouter);
router.get('/sync/toggle/:marketId/:worldNumber?', authControlSyncAction, toggleSyncRouter);

router.get('/sync/queue/:type/reset', authStartSyncAction, resetQueueRouter);

router.get('/accounts', authModifyAccountsAccess, accountsRouter);
router.get('/accounts/markets/add/:accountId/:marketId', authModifyAccountsAction, accountsAddMarketRouter);
router.get('/accounts/markets/remove/:accountId/:marketId', authModifyAccountsAction, accountsRemoveMarketRouter);
router.get('/accounts/delete/:accountId', authModifyAccountsAction, accountsDeleteRouter);
router.post('/accounts/edit/', authModifyAccountsAction, accountsEditRouter);
router.post('/accounts/create/', authModifyAccountsAction, accountsCreateRouter);

router.get('/mods', authModifyModsAccess, modsRouter);
router.post('/mods/edit', authModifyModsAction, modsEditRouter);
router.post('/mods/create', authModifyModsAction, modsCreateRouter);
router.get('/mods/delete/:id', authModifyModsAction, modsDeleteRouter);

router.get('/settings', authModifySettingsAccess, settingsRouter);
router.post('/settings/edit', authModifySettingsAction, settingsEditRouter);

module.exports = router;
