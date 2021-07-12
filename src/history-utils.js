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

const historyChangeType = require('./types/history-change-type.js');
const historyOrderType = require('./types/history-order.js');

/**
 * @param {String} field
 * @param {String} currentField
 * @param {String} lastField
 * @param {historyOrderType} order Indicate if bigger value means a increase or decrease.
 * @return {historyChangeType}
 */
function calcHistoryChange (field, currentField, lastField, order = historyOrderType.ASC) {
    if (!lastField || currentField[field] === lastField[field]) {
        return historyChangeType.EQUAL;
    } else if (order === historyOrderType.ASC) {
        return currentField[field] > lastField[field] ? historyChangeType.INCREASE : historyChangeType.DECREASE;
    } else if (order === historyOrderType.DESC) {
        return currentField[field] < lastField[field] ? historyChangeType.INCREASE : historyChangeType.DECREASE;
    }
}

/**
 * Add keys to each field indicating if the value from the change since the last item
 * was positive, negative or unchanged.
 * @param {Array} history
 * @param {[String, historyOrderType][]} fields
 * @return {Array}
 */
function processHistoryChanges (history, fields) {
    let last;

    const reversed = history.reverse();
    const mapped = reversed.map(function (current) {
        for (const [field, order] of fields) {
            current[field + '_change'] = calcHistoryChange(field, current, last, order);
        }
        last = current;
        return current;
    });

    return mapped.reverse();
}

module.exports = {
    calcHistoryChanges: processHistoryChanges,
    getHistoryChangeType: calcHistoryChange
};
