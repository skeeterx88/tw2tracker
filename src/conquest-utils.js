const conquestTypes = require('./types/conquest-types.js');

/**
 * @param {Object} conquests
 * @param {Number} tribeId
 * @return {Object} Modified conquests
 */
function processTribeConquestTypes (conquests, tribeId) {
    return conquests.map(function (conquest) {
        if (conquest.new_owner_tribe_id === conquest.old_owner_tribe_id) {
            conquest.type = conquestTypes.SELF;
        } else if (conquest.new_owner_tribe_id === tribeId) {
            conquest.type = conquestTypes.GAIN;
        } else if (conquest.old_owner_tribe_id === tribeId) {
            conquest.type = conquestTypes.LOSS;
        }

        return conquest;
    });
}

/**
 * @param {Object} conquests
 * @param {Number} playerId
 * @return {Object} Modified conquests
 */
function processPlayerConquestTypes (conquests, playerId) {
    return conquests.map(function (conquest) {
        if (conquest.new_owner === conquest.old_owner) {
            conquest.type = conquestTypes.SELF;
        } else if (conquest.new_owner === playerId) {
            conquest.type = conquestTypes.GAIN;
        } else if (conquest.old_owner === playerId) {
            conquest.type = conquestTypes.LOSS;
        }

        return conquest;
    });
}

module.exports = {
    processTribeConquestTypes,
    processPlayerConquestTypes
};
