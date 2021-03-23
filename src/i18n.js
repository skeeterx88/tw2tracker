const config = require('./config.js');
const languages = require('./languages.js');

function sprintf (string, tokens = []) {
    let i = 0;
    return string.replace(/%{[^}]*}/g, () => tokens[i++]);
}

module.exports = function (key, namespace, language = config.general.lang, tokens) {
    try {
        if (!languages[language][namespace][key]) {
            return '[' + key + ', ' + namespace + ']';
        } else if (tokens) {
            const value = languages[language][namespace][key];

            if (Array.isArray(value)) {
                return sprintf(Math.round(tokens[0]) === 1 ? value[0] : value[1], tokens);
            } else {
                return sprintf(value, tokens);
            }
        } else {
            return languages[language][namespace][key];
        }
    } catch (error) {
        return '[' + key + ', ' + namespace + ']';
    }
};
