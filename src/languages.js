const path = require('path');
const fs = require('fs');

const i18n = {};

for (const file of fs.readdirSync('i18n')) {
    const id = path.parse(file).name;
    i18n[id] = require('../i18n/' + file);
}

module.exports = i18n;
