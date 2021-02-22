const express = require('express');
const router = express.Router();
const connectEnsureLogin = require('connect-ensure-login');

const db = require('../db.js');
const sql = require('../sql.js');
const utils = require('../utils.js');
const config = require('../config.js');
const enums = require('../enums.js');
const syncSocket = require('../sync-socket.js');
const debug = require('../debug.js');
const development = process.env.NODE_ENV === 'development';

router.use(connectEnsureLogin.ensureLoggedIn());

const adminPanelRouter = utils.asyncRouter(async function (req, res) {
    const openWorlds = await db.any(sql.getOpenWorlds);
    const closedWorlds = await db.any(sql.getClosedWorlds);
    const markets = await db.any(sql.getMarkets);
    const subPage = 'sync';

    res.render('admin', {
        title: `Admin Panel - ${config.site_name}`,
        subPage,
        openWorlds,
        closedWorlds,
        markets,
        backendValues: {
            development,
            syncStates: enums.syncStates,
            subPage
        },
        ...utils.ejsHelpers
    });
});

const syncDataRouter = utils.asyncRouter(async function (req, res) {
    const marketId = req.params.marketId;
    const worldNumber = parseInt(req.params.worldNumber, 10);
    const marketsWithAccounts = await db.map(sql.getMarketsWithAccounts, [], market => market.id);
    const worlds = await db.map(sql.getWorlds, [], world => world.num);

    if (marketsWithAccounts.includes(marketId) && worlds.includes(worldNumber)) {
        syncSocket.send(JSON.stringify({
            code: enums.SYNC_REQUEST_SYNC_DATA,
            marketId,
            worldNumber
        }));
    }
    
    res.end('ok');
});

const syncDataAllRouter = utils.asyncRouter(async function (req, res) {
    syncSocket.send(JSON.stringify({
        code: enums.SYNC_REQUEST_SYNC_DATA_ALL
    }));

    res.end('ok');
});

const syncAchievementsRouter = utils.asyncRouter(async function (req, res) {
    const marketId = req.params.marketId;
    const worldNumber = parseInt(req.params.worldNumber, 10);
    const marketsWithAccounts = await db.map(sql.getMarketsWithAccounts, [], market => market.id);
    const worlds = await db.map(sql.getWorlds, [], world => world.num);

    if (marketsWithAccounts.includes(marketId) && worlds.includes(worldNumber)) {
        syncSocket.send(JSON.stringify({
            code: enums.SYNC_REQUEST_SYNC_ACHIEVEMENTS,
            marketId,
            worldNumber
        }));
    }
    
    res.end('ok');
});

const syncAchievementsAllRouter = utils.asyncRouter(async function (req, res) {
    syncSocket.send(JSON.stringify({
        code: enums.SYNC_REQUEST_SYNC_ACHIEVEMENTS_ALL
    }));

    res.end('ok');
});

const scrapeMarketsRouter = utils.asyncRouter(async function (req, res) {
    syncSocket.send(JSON.stringify({
        code: enums.SYNC_REQUEST_SYNC_MARKETS
    }));

    res.end('ok');
});

const scrapeWorldsRouter = utils.asyncRouter(async function (req, res) {
    syncSocket.send(JSON.stringify({
        code: enums.SYNC_REQUEST_SYNC_WORLDS
    }));

    res.end('ok');
});

const toggleSyncRouter = utils.asyncRouter(async function (req, res) {
    const marketId = req.params.marketId;
    const worldNumber = req.params.worldNumber ? parseInt(req.params.worldNumber, 10) : false;
    const code = worldNumber ? enums.SYNC_TOGGLE_WORLD : enums.SYNC_TOGGLE_MARKET;

    if (!worldNumber) {
        const msg = 'Sync toggle is available for worlds only not markets.';
        debug.sync(msg);
        res.end(msg);
        return false;
    }

    syncSocket.send(JSON.stringify({
        code,
        marketId,
        worldNumber
    }));

    res.end('ok');
});

const accountsRouter = utils.asyncRouter(async function (req, res) {
    const accounts = await db.any(sql.getAccounts);
    const markets = await db.any(sql.getMarkets);
    const subPage = 'accounts';

    res.render('admin', {
        title: `Admin Panel - Accounts - ${config.site_name}`,
        subPage,
        accounts,
        markets,
        backendValues: {
            development,
            syncStates: enums.syncStates,
            subPage
        },
        ...utils.ejsHelpers
    });
});

const accountsAddMarketRouter = utils.asyncRouter(async function (req, res) {
    const accountId = req.params.accountId;
    const marketId = req.params.marketId;
    const account = await db.any(sql.getAccount, {accountId});
    const market = await db.any(sql.getMarket, {marketId});

    if (!account.length) {
        return res.end(`Account "${accountId}" does not exist.`);
    }

    if (!market.length) {
        return res.end(`Market "${marketId}" does not exist.`);
    }

    if (account[0].markets.includes(marketId)) {
        return res.end('Account already has market included.');
    }

    await db.query(sql.addAccountMarket, {
        accountId,
        marketId
    });

    res.end('ok');
});

const accountsRemoveMarketRouter = utils.asyncRouter(async function (req, res) {
    const accountId = req.params.accountId;
    const marketId = req.params.marketId;
    const account = await db.any(sql.getAccount, {accountId});
    const market = await db.any(sql.getMarket, {marketId});

    if (!account.length) {
        return res.end(`Account "${accountId}" does not exist.`);
    }

    if (!market.length) {
        return res.end(`Market "${marketId}" does not exist.`);
    }

    if (!account[0].markets.includes(marketId)) {
        return res.end('Account already does not have market included.');
    }

    await db.query(sql.removeAccountMarket, {
        accountId,
        marketId
    });

    res.end('ok');
});

const accountsDeleteRouter = utils.asyncRouter(async function (req, res) {
    const accountId = req.params.accountId;
    const account = await db.any(sql.getAccount, {accountId});

    if (!account.length) {
        return res.end(`Account "${accountId}" does not exist.`);
    }

    await db.query(sql.deleteAccount, {
        accountId,
    });

    res.end('ok');
});

const accountsEditRouter = utils.asyncRouter(async function (req, res) {
    const {name, pass, id: accountId} = req.body;
    const account = await db.any(sql.getAccount, {accountId});

    if (!account.length) {
        return res.end(`Account "${id}" does not exist.`);
    }

    if (pass.length < 4) {
        return res.end(`Password minimum length is 4.`);
    }

    if (name.length < 4) {
        return res.end(`Account name minimum length is 4.`);
    }

    await db.query(sql.editAccount, {
        accountId,
        name,
        pass
    });

    res.end('ok');
});

const accountsCreateRouter = utils.asyncRouter(async function (req, res) {
    const {name, pass, id: accountId} = req.body;

    if (pass.length < 4) {
        return res.end(`Password minimum length is 4.`);
    }

    if (name.length < 4) {
        return res.end(`Account name minimum length is 4.`);
    }

    const accountExists = await db.any(sql.getAccountByName, {name});

    if (accountExists.length) {
        return res.end(`Account with name "${name}" already exists.`);
    }

    await db.query(sql.addAccount, {
        name,
        pass
    });

    res.end('ok');
});

router.get('/', adminPanelRouter);
router.get('/sync', adminPanelRouter);
router.get('/sync/data/all', syncDataAllRouter);
router.get('/sync/data/:marketId/:worldNumber', syncDataRouter);
router.get('/sync/achievements/all', syncAchievementsAllRouter);
router.get('/sync/achievements/:marketId/:worldNumber', syncAchievementsRouter);
router.get('/sync/markets', scrapeMarketsRouter);
router.get('/sync/worlds', scrapeWorldsRouter);
router.get('/sync/toggle/:marketId/:worldNumber?', toggleSyncRouter);
router.get('/accounts', accountsRouter);
router.get('/accounts/markets/add/:accountId/:marketId', accountsAddMarketRouter);
router.get('/accounts/markets/remove/:accountId/:marketId', accountsRemoveMarketRouter);
router.get('/accounts/delete/:accountId', accountsDeleteRouter);
router.post('/accounts/edit/', accountsEditRouter);
router.post('/accounts/create/', accountsCreateRouter);

module.exports = router;
