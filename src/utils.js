const https = require('https');
const crypto = require('crypto');
const humanInterval = require('human-interval');
const i18n = require('./i18n.js');

const noop = function () {};

const extractNumbers = function (value) {
    const num = value.match(/\d+/);
    return num ? parseInt(num[0], 10) : value;
};

const makeid = function (length) {
    let result = '';
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';

    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return result;
};

const getHourlyDir = function (now) {
    const rawNow = (now || new Date()).toISOString();
    const [date, rawTime] = rawNow.split('T');
    const [hour] = rawTime.split(':');
    return `${date}-${hour}`;
};

const getHTML = function (url) {
    return new Promise(function (resolve) {
        const HTMLParser = require('fast-html-parser');

        https.get(url, function (res) {
            res.setEncoding('utf8');

            let body = '';

            res.on('data', data => body += data);
            res.on('end', async function () {
                resolve(HTMLParser.parse(body));
            });
        });
    });
};

/**
 * @param url {String}
 * @returns {Promise<Buffer>}
 */
const getBuffer = function (url) {
    return new Promise(function (resolve) {
        https.get(url, function (res) {
            const data = [];

            res.on('data', function (chunk) {
                data.push(chunk);
            });

            res.on('end', async function () {
                resolve(Buffer.concat(data));
            });
        });
    });
};

const perf = function (type = perf.SECONDS) {
    const start = Date.now();

    return {
        end: function () {
            const end = Date.now();

            switch (type) {
                case perf.MILLISECONDS: {
                    return (Math.round(((end - start)) * 10) / 10) + 'ms';
                }
                case perf.SECONDS: {
                    return (Math.round(((end - start) / 1000) * 10) / 10) + 's';
                }
                case perf.MINUTES: {
                    return (Math.round(((end - start) / 1000 / 60) * 10) / 10) + 'm';
                }
            }
        }
    };
};

perf.MILLISECONDS = 'milliseconds';
perf.SECONDS = 'seconds';
perf.MINUTES = 'minutes';

const sha1sum = function (value) {
    const hash = crypto.createHash('sha1');
    hash.update(value);
    return hash.digest('hex');
};

const timeout = function (handler, time, errorMessage) {
    return new Promise(async function (resolve, reject) {
        const id = setTimeout(function () {
            const timeoutMessage = typeof time === 'string' ? `${time} timeout` : `${time}ms timeout`;
            const error = new Error(errorMessage ? errorMessage : timeoutMessage);
            error.timeout = true;
            reject(error);
        }, typeof time === 'string' ? humanInterval(time) : time);

        handler().then(function (result) {
            clearTimeout(id);
            resolve(result);
        }).catch(reject);
    });
};

const hasOwn = function (obj, property) {
    return Object.prototype.hasOwnProperty.call(obj, property);
};

const capitalize = function (value) {
    return typeof value === 'string'
        ? value.charAt(0).toUpperCase() + value.slice(1)
        : value;
};

function sprintf (string, tokens = []) {
    let i = 0;
    return string.replace(/%{[^}]*}/g, () => tokens[i++]);
}

function formatNumbers (value) {
    return typeof value === 'number'
        ? value.toLocaleString('pt-BR')
        : value;
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

const UTC = function () {
    const now = new Date();
    return now.getTime() + now.getTimezoneOffset() * 1000 * 60;
};

const formatSince = function (date, lang) {
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
};

/**
 * Get the correct URL to the specified market.
 * @param marketId {String}
 * @param url {String}
 * @return {String}
 */
function marketDomain (marketId, url) {
    const market = marketId === 'zz' ? 'beta' : marketId;
    return url.replace('%market', market);
}

function randomInteger (min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isObject (item) {
    return (item && typeof item === 'object' && !Array.isArray(item));
}

function mergeDeep (target, changes) {
    if (isObject(target) && isObject(changes)) {
        for (const key in changes) {
            if (isObject(changes[key])) {
                if (!target[key]) Object.assign(target, {
                    [key]: {}
                });
                mergeDeep(target[key], changes[key]);
            } else {
                Object.assign(target, {
                    [key]: changes[key]
                });
            }
        }
    }

    return target;
}

module.exports = {
    noop,
    extractNumbers,
    makeid,
    getHourlyDir,
    getHTML,
    getBuffer,
    perf,
    sha1sum,
    timeout,
    hasOwn,
    capitalize,
    sprintf,
    UTC,
    formatSince,
    formatNumbers,
    formatDate,
    marketDomain,
    randomInteger,
    isObject,
    mergeDeep
};
