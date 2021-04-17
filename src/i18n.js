const config = require('./config.js');
const utils = require('./utils.js');
const languages = require('./languages.js');
const defaultLang = config('general', 'lang');

module.exports = function (key, namespace, language = defaultLang, tokens) {
    try {
        if (!languages[language][namespace][key]) {
            return '[' + key + ', ' + namespace + ']';
        } else if (tokens) {
            const value = languages[language][namespace][key];

            if (Array.isArray(value)) {
                return utils.sprintf(Math.round(tokens[0]) === 1 ? value[0] : value[1], tokens);
            } else {
                return utils.sprintf(value, tokens);
            }
        } else {
            return languages[language][namespace][key];
        }
    } catch (error) {
        return '[' + key + ', ' + namespace + ']';
    }
};
