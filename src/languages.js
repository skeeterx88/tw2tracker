const TOML = require('@iarna/toml');
const path = require('path');
const fs = require('fs');
const I18N_PATH = 'i18n';

const i18n = {};

for (const file of fs.readdirSync(I18N_PATH)) {
    const id = path.parse(file).name;
    const content = fs.readFileSync(path.join(I18N_PATH, file), 'utf-8');
    i18n[id] = TOML.parse(content);
}

module.exports = i18n;
