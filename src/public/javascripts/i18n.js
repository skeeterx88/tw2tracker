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

define('i18n', [
    'backendValues'
], function (
    {
        language
    }
) {
    function sprintf (string, tokens = []) {
        let i = 0;
        return string.replace(/%{[^}]*}/g, () => tokens[i++]);
    }

    /**
     * @param key {String}
     * @param namespace {String}
     * @param [tokens] {Array<String>}
     * @return {String}
     */
    return function (key, namespace, tokens) {
        try {
            if (!language[namespace][key]) {
                return '[' + key + ', ' + namespace + ']';
            } else if (tokens) {
                const value = language[namespace][key];

                if (Array.isArray(value)) {
                    return sprintf(Math.round(tokens[0]) === 1 ? value[0] : value[1], tokens);
                } else {
                    return sprintf(value, tokens);
                }
            } else {
                return language[namespace][key];
            }
        } catch (error) {
            return '[' + key + ', ' + namespace + ']';
        }
    };
});
