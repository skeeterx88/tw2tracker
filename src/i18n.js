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
