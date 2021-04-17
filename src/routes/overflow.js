const express = require('express');
const router = express.Router();
const {db, sql} = require('../db.js');
const {asyncRouter} = require('../router-helpers.js');

const regexWorldId = /^[a-z]{2}\d{1,2}$/;

const usageRouter = asyncRouter(async function (req, res) {
    const {player_id, world_id} = req.body;

    if (!regexWorldId.test(world_id) || isNaN(player_id)) {
        return res.end();
    }

    db.none(sql('overflow/add-usage-item'), {player_id, world_id});
    res.end();
});

router.post('/usage', usageRouter);

module.exports = router;
