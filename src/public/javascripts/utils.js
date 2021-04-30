define('utils', [
    'i18n',
    'backendValues'
], function (
    i18n,
    {
        language
    }
) {
    const hasOwn = function (obj, property) {
        return Object.prototype.hasOwnProperty.call(obj, property);
    };

    const ajaxPost = async function (url = '', data = {}) {
        const response = await fetch(url, {
            method: 'POST',
            cache: 'no-cache',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        return await response.json();
    };

    const boundNumber = function (value, min, max) {
        return Math.min(max, Math.max(parseInt(value, 10), min));
    };

    const arrayRandom = function (arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    };

    const noop = function () {};

    const normalizeString = function (value) {
        return String(value).toLowerCase().replace(/[^\w]/g, '');
    };


    const querySelectorFrom = function (selector, elements) {
        return [].filter.call(elements, function (element) {
            return element.matches(selector);
        });
    };

    const formatSince = (date) => {
        const elapsedTime = Date.now() - date;

        const seconds = elapsedTime / 1000;
        const minutes = seconds / 60;
        const hours = minutes / 60;
        const days = hours / 24;

        const timeFormat = new Intl.RelativeTimeFormat(language.meta.code, {
            style: 'long'
        });

        if (minutes <= 1) {
            return i18n('now', 'time');
        } else if (hours <= 1) {
            return timeFormat.format(minutes, 'minutes');
        } else if (days <= 1) {
            return timeFormat.format(hours, 'hours');
        } else {
            return timeFormat.format(days, 'days');
        }
    };

    const averageCoords = (coords) => {
        if (!coords) {
            return [500, 500];
        }

        let averageX = 0;
        let averageY = 0;

        coords = coords.filter(function (coord) {
            return coord;
        });

        for (const [x, y] of coords) {
            averageX += parseInt(x, 10);
            averageY += parseInt(y, 10);
        }

        averageX = Math.floor(averageX / coords.length);
        averageY = Math.floor(averageY / coords.length);

        return [averageX, averageY];
    };

    const getElemPosition = function ($ref) {
        const {x, y, width, height} = $ref.getBoundingClientRect();

        return {
            x: Math.floor(x + width + 5),
            y: Math.floor(y + height + 5),
            width,
            height
        };
    };

    function sprintf (string, tokens = []) {
        let i = 0;
        return string.replace(/%{[^}]*}/g, () => tokens[i++]);
    }

    function shortifyPoints (points) {
        return Intl.NumberFormat(language.meta.code, {notation: 'compact'}).format(points);
    }

    return {
        hasOwn,
        ajaxPost,
        boundNumber,
        arrayRandom,
        noop,
        normalizeString,
        querySelectorFrom,
        formatSince,
        averageCoords,
        getElemPosition,
        sprintf,
        shortifyPoints
    };
});
