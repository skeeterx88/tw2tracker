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
