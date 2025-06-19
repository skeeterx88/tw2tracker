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

const fs = require('fs');
// const defaults = require('../share/default-config.json');
const defaults = require('./config.json');
const utils = require('./utils.js');
let config;

if (fs.existsSync('./config.json')) {
    config = require('./config.json');
    config = utils.mergeDeep(defaults, config);
} else {
    fs.promises.writeFile('./config.json', JSON.stringify(defaults, null, 4));
    config = defaults;
}

module.exports = function (namespace, key) {
    if (!utils.hasOwn(config, namespace)) {
        throw new Error(`Config namespace "${namespace}" not found.`);
    } else if (!key) {
        return config[namespace];
    } else if (!utils.hasOwn(config[namespace], key)) {
        throw new Error(`Config key "${key}" from namespace "${namespace}" not found.`);
    }

    return config[namespace][key];
};
