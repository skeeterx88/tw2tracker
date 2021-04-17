const i18n = require('./i18n');

function UTC () {
    const now = new Date();
    return now.getTime() + now.getTimezoneOffset() * 1000 * 60;
}

function formatSince (date, lang) {
    const elapsedTime = UTC() - date;

    const seconds = elapsedTime / 1000;
    const minutes = seconds / 60;
    const hours = minutes / 60;
    const days = hours / 24;

    let format = '';

    if (minutes <= 1) {
        return i18n('now', 'time', lang);
    } else if (hours <= 1) {
        format = i18n('minutes', 'time', lang, [Math.round(minutes)]);
    } else if (days <= 1) {
        format = i18n('hours', 'time', lang, [Math.round(hours)]);
    } else {
        if (days > 2) {
            format = i18n('days', 'time', lang, [Math.round(days)]);
        } else {
            const dayHours = hours % 24;

            if (dayHours <= 2) {
                format = i18n('days', 'time', lang, [1]);
            } else {
                format = i18n('days', 'time', lang, [1]) + ' ' + i18n('and', 'general', lang) + ' ' + i18n('hours', 'time', lang, [Math.round(dayHours)]);
            }
        }
    }

    format += ' ' + i18n('ago', 'time', lang);

    return format;
}

function formatDate (dateObject, timeOffset, flag = false) {
    if (dateObject instanceof Date) {
        if (typeof timeOffset === 'number') {
            dateObject = new Date(dateObject.getTime() + timeOffset);
        } else if (typeof timeOffset === 'string') {
            flag = timeOffset;
        }

        const date = [
            dateObject.getFullYear(),
            (dateObject.getMonth() + 1).toString().padStart(2, '0'),
            dateObject.getDate().toString().padStart(2, '0')
        ];

        const time = [];

        if (flag === 'hours-only') {
            time.push(dateObject.getHours().toString().padStart(2, '0') + 'h');
        } else if (flag === 'day-only') {
            return date.join('/');
        } else {
            time.push(dateObject.getHours().toString().padStart(2, '0'));
            time.push(dateObject.getMinutes().toString().padStart(2, '0'));
            time.push(dateObject.getSeconds().toString().padStart(2, '0'));
        }

        return date.join('/') + ' ' + time.join(':');
    } else {
        throw new Error('formatDate: dateObject is not of type Date');
    }
}

module.exports = {
    UTC,
    formatSince,
    formatDate
};
