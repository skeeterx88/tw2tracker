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

const config = require('./config.js');
const utils = require('./utils.js');
const languages = require('./languages.js');
const defaultLang = config('general', 'lang');

/**
 * @param {String} key
 * @param {String} namespace
 * @param {String=} language
 * @param {Array.<String|Number>|String|Number=} tokens
 * @return {String}
 */
module.exports = function i18n (key, namespace, language = defaultLang, tokens) {
    let value;

    try {
        value = languages[language][namespace][key] || languages[defaultLang][namespace][key];
    } catch (e) {
        value = languages[defaultLang][namespace][key];
    }

    if (!value) {
        return '[' + key + ', ' + namespace + ']';
    }

    if (tokens) {
        if (Array.isArray(value)) {
            return utils.sprintf(Math.round(tokens[0]) === 1 ? value[0] : value[1], tokens);
        } else {
            return utils.sprintf(value, tokens);
        }
    } else {
        return value;
    }
};
