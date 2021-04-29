const fastifyCORS = require('fastify-cors');
const {db, sql} = require('../db.js');
const debug = require('../debug');

const regexWorldId = /^[a-z]{2}\d{1,2}$/;
const regexDomain = /https:\/\/[a-z]{2,4}\.tribalwars2\.com/;

const usageRouter = async function (request, reply) {
    const {player_id, world_id} = request.body;

    if (regexWorldId.test(world_id) && !isNaN(player_id)) {
        db.none(sql('overflow/add-usage-item'), {player_id, world_id});
    }

    reply.send();
};

const commandRouter = async function (request, reply) {
    let command;

    try {
        command = JSON.parse(decodeURIComponent(request.body.command));
    } catch (e) {
        reply.send();
        return debug.overflow('Command report with invalid data: %o', request.body);
    }

    if (regexWorldId.test(command.world_id) && !isNaN(command.player_id)) {
        command.arrive_time = new Date(command.arrive_time);

        db.none(sql('overflow/add-command-item'), command);
    }

    reply.send();
};

module.exports = async function (fastify, opts, done) {
    fastify.register(fastifyCORS, {
        origin: regexDomain
    });

    fastify.post('/overflow/usage', usageRouter);
    fastify.post('/overflow/command', commandRouter);

    done();
};
