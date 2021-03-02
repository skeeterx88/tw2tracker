const {Router} = require('express');
const {ensureLoggedIn} = require('connect-ensure-login');

const db = require('../db.js');
const sql = require('../sql.js');
const utils = require('../utils.js');
const config = require('../config.js');
const i18n = require('../i18n.js');
const enums = require('../enums.js');
const privilegeTypes = require('../privileges.json');
const syncSocket = require('../sync-socket.js');
const debug = require('../debug.js');
const development = process.env.NODE_ENV === 'development';
const pgArray = require('pg').types.arrayParser;
const bcrypt = require('bcrypt');
const saltRounds = 10;
const createError = require('http-errors');

function createAdminMenu (user, selected) {
    const adminMenu = [
        ['sync', {
            enabled: true,
            selected: selected === 'sync'
        }],
        ['accounts', {
            enabled: user.privileges.modify_accounts,
            selected: selected === 'accounts'
        }],
        ['mods', {
            enabled: user.privileges.modify_mods,
            selected: selected === 'mods'
        }]
    ];

    return adminMenu.filter(function ([id, data]) {
        return data.enabled
    });
}

function createPrivilegeChecker (privilege) {
    return function (req, res, next) {
        if (!req.user.privileges[privilege]) {
            throw createError(401, i18n.admin.error_not_authorized);
        }

        next();
    }
}

const adminPanelRouter = utils.asyncRouter(async function (req, res) {
    const openWorlds = await db.any(sql.getOpenWorlds);
    const closedWorlds = await db.any(sql.getClosedWorlds);
    const markets = await db.any(sql.getMarkets);
    const subPage = 'sync';
    const menu = createAdminMenu(req.user, subPage);

    res.render('admin', {
        title: i18n.page_titles.admin_panel,
        menu,
        subPage,
        openWorlds,
        closedWorlds,
        markets,
        privilegeTypes,
        user: req.user,
        backendValues: {
            development,
            syncStates: enums.syncStates,
            subPage,
            accountPrivileges: req.user.privileges,
            privilegeTypes
        }
    });
});

const syncDataRouter = utils.asyncRouter(async function (req, res) {
    const marketId = req.params.marketId;
    const worldNumber = parseInt(req.params.worldNumber, 10);
    const worldId = marketId + worldNumber;
    const marketsWithAccounts = await db.map(sql.getMarketsWithAccounts, [], market => market.id);
    const worlds = await db.map(sql.getWorlds, [], world => world.num);

    if (marketsWithAccounts.includes(marketId) && worlds.includes(worldNumber)) {
        syncSocket.send(JSON.stringify({
            code: enums.SYNC_REQUEST_SYNC_DATA,
            marketId,
            worldNumber
        }));
    }

    res.redirect(`/admin/sync#world-${worldId}`);
});

const syncDataAllRouter = utils.asyncRouter(async function (req, res) {
    syncSocket.send(JSON.stringify({
        code: enums.SYNC_REQUEST_SYNC_DATA_ALL
    }));

    res.redirect('/admin/sync');
});

const syncAchievementsRouter = utils.asyncRouter(async function (req, res) {
    const marketId = req.params.marketId;
    const worldNumber = parseInt(req.params.worldNumber, 10);
    const worldId = marketId + worldNumber;
    const marketsWithAccounts = await db.map(sql.getMarketsWithAccounts, [], market => market.id);
    const worlds = await db.map(sql.getWorlds, [], world => world.num);

    if (marketsWithAccounts.includes(marketId) && worlds.includes(worldNumber)) {
        syncSocket.send(JSON.stringify({
            code: enums.SYNC_REQUEST_SYNC_ACHIEVEMENTS,
            marketId,
            worldNumber
        }));
    }
    
    res.redirect(`/admin/sync#world-${worldId}`);
});

const syncAchievementsAllRouter = utils.asyncRouter(async function (req, res) {
    syncSocket.send(JSON.stringify({
        code: enums.SYNC_REQUEST_SYNC_ACHIEVEMENTS_ALL
    }));

    res.redirect('/admin/sync');
});

const scrapeMarketsRouter = utils.asyncRouter(async function (req, res) {
    syncSocket.send(JSON.stringify({
        code: enums.SYNC_REQUEST_SYNC_MARKETS
    }));

    res.redirect('/admin/sync');
});

const scrapeWorldsRouter = utils.asyncRouter(async function (req, res) {
    syncSocket.send(JSON.stringify({
        code: enums.SYNC_REQUEST_SYNC_WORLDS
    }));

    res.redirect('/admin/sync');
});

const toggleSyncRouter = utils.asyncRouter(async function (req, res) {
    const marketId = req.params.marketId;
    const worldNumber = req.params.worldNumber ? parseInt(req.params.worldNumber, 10) : false;
    const worldId = marketId + worldNumber;
    const code = worldNumber ? enums.SYNC_TOGGLE_WORLD : enums.SYNC_TOGGLE_MARKET;

    if (!worldNumber) {
        debug.sync(i18n.admin.error_sync_toggle_world_only);
        res.end(i18n.admin.error_sync_toggle_world_only);
        return false;
    }

    syncSocket.send(JSON.stringify({
        code,
        marketId,
        worldNumber
    }));

    res.redirect(`/admin/sync#world-${worldId}`);
});

const accountsRouter = utils.asyncRouter(async function (req, res) {
    const markets = await db.map(sql.getMarkets, [], market => market.id);
    const accounts = await db.map(sql.getAccounts, [], function (account) {
        account.missingMarkets = getMissingMarkets(account.markets, markets);
        return account;
    });

    function getMissingMarkets (accountMarkets, markets) {
        return markets.filter(function (marketId) {
            return !accountMarkets.includes(marketId);
        });
    }

    const subPage = 'accounts';
    const menu = createAdminMenu(req.user, subPage);

    res.render('admin', {
        title: i18n.page_titles.admin_panel_sync_accounts,
        menu,
        subPage,
        accounts,
        markets,
        backendValues: {
            development,
            syncStates: enums.syncStates,
            subPage
        }
    });
});

const accountsAddMarketRouter = utils.asyncRouter(async function (req, res) {
    const accountId = req.params.accountId;
    const marketId = req.params.marketId;
    const account = await db.any(sql.getAccount, {accountId});
    const market = await db.any(sql.getMarket, {marketId});

    if (!account.length) {
        return res.end(i18n.admin.error_sync_account_not_exist);
    }

    if (!market.length) {
        return res.end(i18n.admin.error_sync_market_not_exist);
    }

    if (account[0].markets.includes(marketId)) {
        return res.end(i18n.admin.error_sync_account_market_included);
    }

    await db.query(sql.addAccountMarket, {
        accountId,
        marketId
    });

    res.redirect(`/admin/accounts#account-${accountId}`);
});

const accountsRemoveMarketRouter = utils.asyncRouter(async function (req, res) {
    const accountId = req.params.accountId;
    const marketId = req.params.marketId;
    const account = await db.any(sql.getAccount, {accountId});
    const market = await db.any(sql.getMarket, {marketId});

    if (!account.length) {
        return res.end(i18n.admin.error_sync_account_not_exist);
    }

    if (!market.length) {
        return res.end(i18n.admin.error_sync_market_not_exist);
    }

    if (!account[0].markets.includes(marketId)) {
        return res.end(i18n.admin.error_sync_account_market_included);
    }

    await db.query(sql.removeAccountMarket, {
        accountId,
        marketId
    });

    res.redirect(`/admin/accounts#account-${accountId}`);
});

const accountsDeleteRouter = utils.asyncRouter(async function (req, res) {
    const accountId = req.params.accountId;
    const account = await db.any(sql.getAccount, {accountId});

    if (!account.length) {
        return res.end(i18n.admin.error_sync_account_not_exist);
    }

    await db.query(sql.deleteAccount, {
        accountId,
    });

    res.redirect('/admin/accounts');
});

const accountsEditRouter = utils.asyncRouter(async function (req, res) {
    const {name, pass, id: accountId} = req.body;
    const account = await db.any(sql.getAccount, {accountId});

    if (!account.length) {
        return res.end(i18n.admin.error_sync_account_not_exist);
    }

    if (pass.length < 4) {
        return res.end(i18n.admin.error_password_minimum_length);
    }

    if (name.length < 4) {
        return res.end(i18n.admin.error_username_minimum_length);
    }

    await db.query(sql.editAccount, {
        accountId,
        name,
        pass
    });

    res.redirect(`/admin/accounts#account-${accountId}`);
});

const accountsCreateRouter = utils.asyncRouter(async function (req, res) {
    const {name, pass, id: accountId} = req.body;

    if (pass.length < 4) {
        return res.end(i18n.admin.error_password_minimum_length);
    }

    if (name.length < 4) {
        return res.end(i18n.admin.error_username_minimum_length);
    }

    const accountExists = await db.any(sql.getAccountByName, {name});

    if (accountExists.length) {
        return res.end(i18n.admin.error_sync_username_already_exists);
    }

    await db.query(sql.addAccount, {
        name,
        pass
    });

    res.redirect(`/admin/accounts#account-${accountId}`);
});

const modsRouter = utils.asyncRouter(async function (req, res) {
    const modPrivilegeTypes = await db.map(sql.getModPrivilegeTypes, [], (privilege) => privilege.type);
    const mods = await db.map(sql.getMods, [], function (mod) {
        mod.privileges = pgArray.create(mod.privileges, String).parse();
        return mod;
    });

    const subPage = 'mods';
    const menu = createAdminMenu(req.user, subPage);

    res.render('admin', {
        title: i18n.page_titles.admin_panel_mod_accounts,
        menu,
        subPage,
        mods,
        modPrivilegeTypes,
        backendValues: {
            development,
            subPage
        }
    });
});

const modsEditRouter = utils.asyncRouter(async function (req, res) {
    let {id, name, pass, email, privileges} = req.body;

    id = parseInt(id, 10);

    if (name.length < 3) {
        throw createError(400, i18n.admin.error_username_minimum_length);
    }

    if (pass && pass.length < 4) {
        throw createError(400, i18n.admin.error_password_minimum_length);
    }

    const [accountName] = await db.any(sql.getModAccountByName, {name});
    if (accountName && accountName.id !== id) {
        throw createError(400, i18n.admin.error_mod_username_already_exists);
    }

    const [accountEmail] = await db.any(sql.getModAccountByEmail, {email});
    if (accountEmail && accountEmail.id !== id) {
        throw createError(400, i18n.admin.error_mod_account_email_already_exists);
    }

    if (!privileges) {
        privileges = [];
    } else if (typeof privileges === 'string') {
        privileges = [privileges];
    }

    const privilegeTypes = await db.map(sql.getModPrivilegeTypes, [], ({type}) => type);

    for (const type of privileges) {
        if (!privilegeTypes.includes(type)) {
            throw createError(400, i18n.admin.error_invalid_privilege);
        }
    }

    if (pass) {
        const hash = await bcrypt.hash(pass, saltRounds);
        await db.query(sql.updateModAccount, {id, name, pass: hash, privileges, email});
    } else {
        await db.query(sql.updateModAccountKeepPass, {id, name, privileges, email});
    }

    if (id === req.user.id) {
        req.logIn({id, name, privileges}, function (error) {
            if (error) {
                throw createError(500, error);
            }

            res.redirect(`/admin/mods#mod-${id}`);
        });
    }
});

const modsCreateRouter = utils.asyncRouter(async function (req, res) {
    let {name, pass, email, privileges} = req.body;

    if (name.length < 3) {
        throw createError(400, i18n.admin.error_username_minimum_length);
    }

    if (pass.length < 4) {
        throw createError(400, i18n.admin.error_password_minimum_length);
    }

    const [accountName] = await db.any(sql.getModAccountByName, {name});
    if (accountName) {
        throw createError(400, i18n.admin.error_mod_username_already_exists);
    }

    const [accountEmail] = await db.any(sql.getModAccountByEmail, {email});
    if (accountEmail) {
        throw createError(400, i18n.admin.error_mod_account_email_already_exists);
    }

    if (!privileges) {
        privileges = [];
    } else if (typeof privileges === 'string') {
        privileges = [privileges];
    }

    const privilegeTypes = await db.map(sql.getModPrivilegeTypes, [], ({type}) => type);

    for (const type of privileges) {
        if (!privilegeTypes.includes(type)) {
            throw createError(400, i18n.admin.error_invalid_privilege);
        }
    }

    const hash = await bcrypt.hash(pass, saltRounds);
    const {id} = await db.one(sql.createModAccount, {name, pass: hash, privileges, email});

    res.redirect(`/admin/mods#mod-${id}`);
});

const modsDeleteRouter = utils.asyncRouter(async function (req, res) {
    let {id} = req.params;

    const [mod] = await db.any(sql.getMod, {id});

    if (!mod) {
        throw createError(404, i18n.admin.error_mod_account_not_exists);
    }

    await db.query(sql.deleteModAccount, {id});
    res.redirect('/admin/mods');
});

const privilegeControlSync = createPrivilegeChecker(privilegeTypes.CONTROL_SYNC);
const privilegeStartSync = createPrivilegeChecker(privilegeTypes.START_SYNC);
const privilegeModifyAccounts = createPrivilegeChecker(privilegeTypes.MODIFY_ACCOUNTS);
const privilegeModifyMods = createPrivilegeChecker(privilegeTypes.MODIFY_MODS);
// const privilegeModifySettings = createPrivilegeChecker(privilegeTypes.MODIFY_SETTINGS);

const router = Router();
router.use(ensureLoggedIn());
router.get('/', adminPanelRouter);
router.get('/sync', adminPanelRouter);
router.get('/sync/data/all', privilegeStartSync, syncDataAllRouter);
router.get('/sync/data/:marketId/:worldNumber', privilegeStartSync, syncDataRouter);
router.get('/sync/achievements/all', privilegeStartSync, syncAchievementsAllRouter);
router.get('/sync/achievements/:marketId/:worldNumber', privilegeStartSync, syncAchievementsRouter);
router.get('/sync/markets', privilegeStartSync, scrapeMarketsRouter);
router.get('/sync/worlds', privilegeStartSync, scrapeWorldsRouter);
router.get('/sync/toggle/:marketId/:worldNumber?', privilegeControlSync, toggleSyncRouter);
router.get('/accounts', privilegeModifyAccounts, accountsRouter);
router.get('/accounts/markets/add/:accountId/:marketId', privilegeModifyAccounts, accountsAddMarketRouter);
router.get('/accounts/markets/remove/:accountId/:marketId', privilegeModifyAccounts, accountsRemoveMarketRouter);
router.get('/accounts/delete/:accountId', privilegeModifyAccounts, accountsDeleteRouter);
router.post('/accounts/edit/', privilegeModifyAccounts, accountsEditRouter);
router.post('/accounts/create/', privilegeModifyAccounts, accountsCreateRouter);
router.get('/mods', privilegeModifyMods, modsRouter);
router.post('/mods/edit', privilegeModifyMods, modsEditRouter);
router.post('/mods/create', privilegeModifyMods, modsCreateRouter);
router.get('/mods/delete/:id', privilegeModifyMods, modsDeleteRouter);

module.exports = router;
