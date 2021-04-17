const express = require('express');
const router = express.Router();
const cors = require('cors');
const {db, sql} = require('../db.js');
const {asyncRouter} = require('../router-helpers.js');

const regexWorldId = /^[a-z]{2}\d{1,2}$/;
const regexDomain = /https:\/\/[a-z]{2,4}\.tribalwars2\.com/;
const corsMiddleware = cors({origin: regexDomain});

const usageRouter = asyncRouter(async function (req, res) {
    const {player_id, world_id} = req.body;

    if (!regexWorldId.test(world_id) || isNaN(player_id)) {
        return res.end();
    }

    db.none(sql('overflow/add-usage-item'), {player_id, world_id});
    res.end();
});

router.post('/usage', corsMiddleware, usageRouter);

module.exports = router;
