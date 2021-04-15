const {Router} = require('express');
const {ensureLoggedIn} = require('connect-ensure-login');

const {db, sql} = require('../db.js');
const config = require('../config.js');
const i18n = require('../i18n.js');
const syncCommands = require('../types/sync-commands.json');
const privilegeTypes = require('../types/privileges.json');
const configMap = require('../types/config-map.json');
const privilegeTypesValue = Object.values(privilegeTypes);
const pgArray = require('pg').types.arrayParser;
const bcrypt = require('bcrypt');
const saltRounds = 10;
const createError = require('http-errors');
const passport = require('passport');
const humanInterval = require('human-interval');
const fs = require('fs');

const syncTypes = require('../types/sync-types.json');

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

const authRouter = asyncRouter(async function (req, res, next) {
    passport.authenticate('local', {}, function (error, user, info) {
        if (error) {
            return next(error);
        }

        if (!user) {
            req.flash('error', info.message);
            return res.redirect('/admin/login');
        }

        req.login(user, function (error) {
            if (error) {
                return next(error);
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

const loginRouter = function (req, res) {
    res.render('admin', {
        title: i18n('admin_panel_login', 'page_titles', res.locals.lang, [config('general', 'site_name')]),
        subPage: 'login',
        menu: false,
        errors: req.flash('error'),
        messages: req.flash('messages')
    });
};

const logoutRouter = function (req, res) {
    req.logout();
    res.redirect('/admin/login');
};

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
        user: req.user,
        errors: req.flash('error'),
        messages: req.flash('messages')
    });
});

const syncDataRouter = asyncRouter(async function (req, res) {
    if (!paramWorld(req)) {
        req.flash('error', i18n('error_world_not_found', 'admin', res.locals.lang));
        return res.redirect('/admin/sync');
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req);

    const marketsWithAccounts = await db.map(sql('get-markets-with-accounts'), [], market => market.id);

    if (!marketsWithAccounts.includes(marketId)) {
        req.flash('error', i18n('error_market_has_no_sync_accounts', 'admin', res.locals.lang, [worldId]));
        return res.redirect('/admin/sync');
    }

    await emitSync(syncCommands.DATA, {
        marketId,
        worldNumber
    });

    req.flash('messages', i18n('message_sync_data_world_started', 'admin', res.locals.lang, [worldId]));
    res.redirect(`/admin/sync#world-${worldId}`);
});

const syncDataAllRouter = asyncRouter(async function (req, res) {
    await emitSync(syncCommands.DATA_ALL);

    req.flash('messages', i18n('message_sync_data_all_started', 'admin', res.locals.lang));
    res.redirect('/admin/sync');
});

const syncAchievementsRouter = asyncRouter(async function (req, res) {
    if (!paramWorld(req)) {
        req.flash('error', i18n('error_world_not_found', 'admin', res.locals.lang));
        return res.redirect('/admin/sync');
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req);

    const marketsWithAccounts = await db.map(sql('get-markets-with-accounts'), [], market => market.id);

    if (!marketsWithAccounts.includes(marketId)) {
        req.flash('error', i18n('error_market_has_no_sync_accounts', 'admin', res.locals.lang, [worldId]));
        return res.redirect('/admin/sync');
    }

    await emitSync(syncCommands.ACHIEVEMENTS, {
        marketId,
        worldNumber
    });

    req.flash('messages', i18n('message_sync_achievements_world_started', 'admin', res.locals.lang, [worldId]));
    res.redirect(`/admin/sync#world-${worldId}`);
});

const syncAchievementsAllRouter = asyncRouter(async function (req, res) {
    await emitSync(syncCommands.ACHIEVEMENTS_ALL);

    req.flash('messages', i18n('message_sync_achievements_all_started', 'admin', res.locals.lang));
    res.redirect('/admin/sync');
});

const scrapeMarketsRouter = asyncRouter(async function (req, res) {
    await emitSync(syncCommands.MARKETS);

    req.flash('messages', i18n('message_scrape_markets_started', 'admin', res.locals.lang));
    res.redirect('/admin/sync');
});

const scrapeWorldsRouter = asyncRouter(async function (req, res) {
    await emitSync(syncCommands.WORLDS);

    req.flash('messages', i18n('message_scrape_worlds_started', 'admin', res.locals.lang));
    res.redirect('/admin/sync');
});

const toggleSyncRouter = asyncRouter(async function (req, res) {
    if (!paramWorld(req)) {
        req.flash('error', i18n('error_world_not_found', 'admin', res.locals.lang));
        return res.redirect('/admin/sync');
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

    req.flash('messages', i18n('message_world_toggled', 'admin', res.locals.lang, [worldId]));
    res.redirect(`/admin/sync#world-${worldId}`);
});

const resetQueueRouter = asyncRouter(async function (req, res) {
    const type = req.params.type;

    if (!Object.values(syncTypes).includes(type)) {
        req.flash('error', i18n('error_invalid_sync_type', 'admin', res.locals.lang, [type]));
        return res.redirect('/admin/sync');
    }

    await emitSync(syncCommands.DATA_RESET_QUEUE);

    req.flash('messages', i18n('message_sync_queue_reseted', 'admin', res.locals.lang, [type]));
    res.redirect('/admin/sync');
});

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
        errors: req.flash('error'),
        messages: req.flash('messages')
    });
});

const accountsAddMarketRouter = asyncRouter(async function (req, res) {
    const accountId = req.params.accountId;
    const marketId = req.params.marketId;
    const account = await db.any(sql('get-account'), {accountId});
    const market = await db.any(sql('get-market'), {marketId});

    if (!account.length) {
        req.flash('error', i18n('error_sync_account_not_exist', 'admin', res.locals.lang));
    } else if (!market.length) {
        req.flash('error', i18n('error_sync_market_not_exist', 'admin', res.locals.lang, [marketId.toUpperCase()]));
    } else if (account[0].markets.includes(marketId)) {
        req.flash('error', i18n('error_sync_account_market_included', 'admin', res.locals.lang, [marketId.toUpperCase()]));
    } else {
        req.flash('messages', i18n('message_sync_account_market_added', 'admin', res.locals.lang, [marketId.toUpperCase()]));
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
        req.flash('error', i18n('error_sync_account_not_exist', 'admin', res.locals.lang, [accountId]));
    } else if (!market.length) {
        req.flash('error', i18n('error_sync_market_not_exist', 'admin', res.locals.lang, [marketId.toUpperCase()]));
    } else if (!account[0].markets.includes(marketId)) {
        req.flash('error', i18n('error_sync_account_market_included', 'admin', res.locals.lang));
    } else {
        req.flash('messages', i18n('message_sync_account_market_removed', 'admin', res.locals.lang));
        await db.query(sql('remove-account-market'), {accountId, marketId});
    }

    res.redirect(`/admin/accounts#account-${accountId}`);
});

const accountsDeleteRouter = asyncRouter(async function (req, res) {
    const accountId = req.params.accountId;
    const account = await db.any(sql('get-account'), {accountId});

    if (!account.length) {
        req.flash('error', i18n('error_sync_account_not_exist', 'admin', res.locals.lang, [accountId]));
    } else if (account.id === req.user.id) {
        req.flash('error', i18n('error_sync_account_delete_own', 'admin', res.locals.lang));
    } else {
        req.flash('messages', i18n('message_sync_account_deleted', 'admin', res.locals.lang));
        await db.query(sql('delete-account'), {accountId});
    }

    res.redirect('/admin/accounts');
});

const accountsEditRouter = asyncRouter(async function (req, res) {
    const {name, pass, id: accountId} = req.body;
    const account = await db.any(sql('get-account'), {accountId});

    // TODO: add values to config.json
    if (!account.length) {
        req.flash('error', i18n('error_sync_account_not_exist', 'admin', res.locals.lang, [accountId]));
    } else if (pass.length < 4) {
        req.flash('error', i18n('error_password_minimum_length', 'admin', res.locals.lang, [4]));
    } else if (name.length < 4) {
        req.flash('error', i18n('error_username_minimum_length', 'admin', res.locals.lang, [4]));
    } else {
        req.flash('messages', i18n('message_sync_account_altered', 'admin', res.locals.lang));
        await db.query(sql('edit-account'), {accountId, name, pass});
    }

    res.redirect(`/admin/accounts#account-${accountId}`);
});

const accountsCreateRouter = asyncRouter(async function (req, res) {
    const {name, pass, id: accountId} = req.body;

    // TODO: add values to config.json
    if (pass.length < 4) {
        req.flash('error', i18n('error_password_minimum_length', 'admin', res.locals.lang, [4]));
    } else if (name.length < 4) {
        req.flash('error', i18n('error_username_minimum_length', 'admin', res.locals.lang, [4]));
    } else {
        const accountExists = await db.any(sql('get-account-by-name'), {name});

        if (accountExists.length) {
            req.flash('error', i18n('error_sync_username_already_exists', 'admin', res.locals.lang, [name]));
        } else {
            req.flash('messages', i18n('message_sync_account_added', 'admin', res.locals.lang));
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
        errors: req.flash('error'),
        messages: req.flash('messages')
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

    // TODO: add values to config.json
    if (!mod) {
        req.flash('error', i18n('error_mod_account_not_exists', 'admin', res.locals.lang));
        return res.redirect('/admin/mods');
    } else if (name.length < 3) {
        req.flash('error', i18n('error_username_minimum_length', 'admin', res.locals.lang, [3]));
        return res.redirect('/admin/mods');
    } else if (pass && pass.length < 4) {
        req.flash('error', i18n('error_password_minimum_length', 'admin', res.locals.lang, [4]));
        return res.redirect('/admin/mods');
    } else if (accountName && accountName.id !== id) {
        req.flash('error', i18n('error_mod_username_already_exists', 'admin', res.locals.lang));
        return res.redirect('/admin/mods');
    } else if (accountEmail && accountEmail.id !== id) {
        req.flash('error', i18n('error_mod_account_email_already_exists', 'admin', res.locals.lang));
        return res.redirect('/admin/mods');
    } else if (privileges.some(type => !privilegeTypesValue.includes(type))) {
        req.flash('error', i18n('error_invalid_privilege', 'admin', res.locals.lang));
        return res.redirect('/admin/mods');
    } else if (me.id === mod.id && me.privileges[privilegeTypes.MODIFY_MODS] && !privileges.includes(privilegeTypes.MODIFY_MODS)) {
        req.flash('error', i18n('error_can_not_remove_self_modify_mods_priv', 'admin', res.locals.lang));
        return res.redirect('/admin/mods');
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
                    req.flash('error', error);
                } else {
                    req.flash('messages', i18n('message_mod_account_altered', 'admin', res.locals.lang));
                }

                res.redirect(`/admin/mods#mod-${id}`);
            });
        } else {
            req.flash('messages', i18n('message_mod_account_altered', 'admin', res.locals.lang));
            res.redirect(`/admin/mods#mod-${id}`);
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

    // TODO: add values to config.json
    if (name.length < 3) {
        req.flash('error', i18n('error_username_minimum_length', 'admin', res.locals.lang, [3]));
    } else if (pass.length < 4) {
        req.flash('error', i18n('error_password_minimum_length', 'admin', res.locals.lang, [4]));
    } else if (accountName) {
        req.flash('error', i18n('error_mod_username_already_exists', 'admin', res.locals.lang));
    } else if (accountEmail) {
        req.flash('error', i18n('error_mod_account_email_already_exists', 'admin', res.locals.lang));
    } else if (privileges.some(type => !privilegeTypesValue.includes(type))) {
        req.flash('error', i18n('error_invalid_privilege', 'admin', res.locals.lang));
    } else {
        const hash = await bcrypt.hash(pass, saltRounds);
        const {id} = await db.one(sql('create-mod-account'), {name, pass: hash, privileges, email});
        req.flash('messages', i18n('message_mod_account_created', 'admin', res.locals.lang));
        return res.redirect(`/admin/mods#mod-${id}`);
    }

    res.redirect('/admin/mods');
});

const modsDeleteRouter = asyncRouter(async function (req, res) {
    const {id} = req.params;

    const [mod] = await db.any(sql('get-mod'), {id});

    if (!mod) {
        req.flash('error', i18n('error_mod_account_not_exists', 'admin', res.locals.lang));
    } else if (mod.id === req.session.passport.user.id) {
        req.flash('error', i18n('error_can_not_delete_yourself', 'admin', res.locals.lang));
    } else {
        req.flash('messages', i18n('message_mod_account_deleted', 'admin', res.locals.lang));
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
        errors: req.flash('error'),
        messages: req.flash('messages')
    });
});

const settingsEditRouter = asyncRouter(async function (req, res) {
    const newConfig = {};
    let updated = false;

    for (const [id, value] of Object.entries(req.body)) {
        const [category, configId] = id.split('/');
        newConfig[category] = newConfig[category] || {};

        const map = configMap[category][configId];

        switch (map.type) {
            case 'number': {
                const parsed = parseInt(value, 10);

                if (isNaN(parsed)) {
                    req.flash('error', i18n('error_invalid_not_a_number', 'admin_settings', res.locals.lang, [category + ':' + configId]));
                    newConfig[category][configId] = config[category][configId];
                } else if (parsed < map.min || parsed > map.max) {
                    req.flash('error', i18n('error_invalid_number_range', 'admin_settings', res.locals.lang, [category + ':' + configId, map.min, map.max]));
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
                    req.flash('error', i18n('error_invalid_time_format', 'admin_settings', res.locals.lang, category + ':' + configId));
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
        req.flash('messages', i18n('message_settings_changed', 'admin_settings', res.locals.lang));
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
router.get('/sync/data/all', authStartSyncAction, syncDataAllRouter);
router.get('/sync/data/:marketId/:worldNumber', authStartSyncAction, syncDataRouter);
router.get('/sync/achievements/all', authStartSyncAction, syncAchievementsAllRouter);
router.get('/sync/achievements/:marketId/:worldNumber', authStartSyncAction, syncAchievementsRouter);
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
