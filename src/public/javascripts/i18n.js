define('i18n', [
    'backendValues'
], function (
    {
        language
    }
) {
    function sprintf (string, tokens = []) {
        let i = 0;
        return string.replace(/%{[^}]*}/g, () => tokens[i++]);
    }

    return function (key, namespace, tokens) {
        try {
            if (!language[namespace][key]) {
                return '[' + key + ', ' + namespace + ']';
            } else if (tokens) {
                const value = language[namespace][key];

                if (Array.isArray(value)) {
                    return sprintf(Math.round(tokens[0]) === 1 ? value[0] : value[1], tokens);
                } else {
                    return sprintf(value, tokens);
                }
            } else {
                return language[namespace][key];
            }
        } catch (error) {
            return '[' + key + ', ' + namespace + ']';
        }
    };
});
