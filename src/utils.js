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

const https = require('https');
const crypto = require('crypto');
const humanInterval = require('human-interval');

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

/**
 * @param {String} value
 * @param {Array.<String|Number>} tokens
 * @return {String}
 */
function sprintf (value, tokens) {
    let i = 0;
    return value.replace(/%{[^}]*}/g, () => tokens[i++]);
}

/**
 * @param {Number} value
 * @param {Object} locale
 * @return {String}
 */
function formatNumbers (value, locale = 'default', options = {}) {
    return Intl.NumberFormat(locale, options).format(value);
}

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
    formatNumbers,
    marketDomain,
    randomInteger,
    isObject,
    mergeDeep
};
