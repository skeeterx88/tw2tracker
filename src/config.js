const fs = require('fs');
const defaults = require('../share/default-config.json');

if (fs.existsSync('../config.json')) {
    const config = require('../config.json');
    module.exports = {...defaults, ...config};
} else {
    fs.promises.writeFile('../config.json', JSON.stringify(defaults));
    module.exports = defaults;
}
