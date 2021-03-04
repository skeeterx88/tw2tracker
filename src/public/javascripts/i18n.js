define('i18n', [
    'backendValues'
], function (
    {
        language
    }
) {
    return function (key, namespace, tokens) {
        try {
            if (!language[namespace][key]) {
                return '[' + key + ', ' + namespace + ']';
            } else if (tokens) {
                return utils.sprintf(language[namespace][key], tokens);
            } else {
                return language[namespace][key];
            }
        } catch (error) {
            return '[' + key + ', ' + namespace + ']';
        }
    }
});
