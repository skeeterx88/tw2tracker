const config = require('./config.js');
const utils = require('./utils.js');
const languages = require('./languages.js');

module.exports = function (key, namespace, language = config.general.lang, tokens) {
    try {
        if (!languages[language][namespace][key]) {
            return '[' + key + ', ' + namespace + ']';
        } else if (tokens) {
            return utils.sprintf(languages[language][namespace][key], tokens);
        } else {
            return languages[language][namespace][key];
        }
    } catch (error) {
        return '[' + key + ', ' + namespace + ']';
    }
};
