const i18n = require('./i18n');

function UTC () {
    const now = new Date();
    return now.getTime() + now.getTimezoneOffset() * 1000 * 60;
}

/**
 * @param {Number} value
 * @param {Number} size
 * @return {Number}
 */
function roundDecimal (value, size = 2) {
    return parseFloat(value.toFixed(size));
}

function formatSince (date, lang) {
    const elapsedTime = UTC() - date;

    const seconds = elapsedTime / 1000;
    const minutes = seconds / 60;
    const hours = minutes / 60;
    const days = hours / 24;

    const timeFormat = new Intl.RelativeTimeFormat(i18n('code', 'meta', lang), {
        style: 'long'
    });

    if (minutes <= 1) {
        return i18n('now', 'time');
    } else if (hours <= 1) {
        return timeFormat.format(roundDecimal(-minutes, 1), 'minutes');
    } else if (days <= 1) {
        return timeFormat.format(roundDecimal(-hours, 1), 'hours');
    } else {
        return timeFormat.format(roundDecimal(-days, 1), 'days');
    }
}

/**
 *
 * @param {Date} date
 * @param {Number=} offset
 * @param {String=} type
 * @param {String=} lang
 * @return {String}
 */
function formatDate (date, offset, type, lang) {
    if (!(date instanceof Date)) {
        throw new Error('formatDate: dateObject is not of type Date');
    }

    if (offset) {
        date = new Date(date.getTime() + offset);
    }

    const locale = i18n('code', 'meta', lang);

    switch (type) {
        default:
        case 'full': {
            return new Intl.DateTimeFormat(locale, {dateStyle: 'short', timeStyle: 'medium'}).format(date);
        }
        case 'day-only': {
            return new Intl.DateTimeFormat(locale, {dateStyle: 'short'}).format(date);
        }
        case 'hour-only': {
            return new Intl.DateTimeFormat(locale, {dateStyle: 'short', timeStyle: 'short'}).format(date);
        }
    }
}

module.exports = {
    UTC,
    formatSince,
    formatDate
};
