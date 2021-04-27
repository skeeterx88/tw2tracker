const {db, sql} = require('../src/db.js');

db.task(async function (tx) {
    const worlds = await tx.any(sql('get-worlds'));
    const exists = {};

    for (const world of worlds) {
        const marketId = world.market_id;
        const worldNumber = world.world_number;
        const worldId = world.world_id;

        exists[worldId] = {};

        const players = await tx.any('SELECT id, name FROM ${worldId:name}.players', {worldId});

        for (const player of players) {
            if (!exists[worldId][player.id]) {
                await tx.query('INSERT INTO public.players (id, name, market_id) VALUES (${id}, ${name}, ${marketId}) ON CONFLICT (id, market_id) DO NOTHING', {
                    ...player,
                    marketId
                });
                exists[worldId][player.id] = 1;
            }

            await tx.query('UPDATE public.players SET worlds = ARRAY_APPEND(worlds, ${worldNumber}) WHERE id = ${id} AND market_id = ${marketId}', {
                ...player,
                worldNumber,
                marketId
            });
        }

        console.log(worldId, 'added', players.length, 'players');
    }
}).then(function () {
    console.log('finished');
});
