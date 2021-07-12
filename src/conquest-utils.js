// TW2-Tracker
// Copyright (C) 2021 Relaxeaza
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

const conquestTypes = require('./types/conquest.js');

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
