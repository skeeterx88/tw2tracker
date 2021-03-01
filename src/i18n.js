const config = require('./config.js');
const TOML = require('@iarna/toml');
const path = require('path');
const fs = require('fs');
const I18N_PATH = path.join('i18n');
const file = path.join(I18N_PATH, `${config.lang}.toml`);

if (!fs.existsSync(file)) {
    throw new Error('The selected language does not have a language file');
}

const content = fs.readFileSync(file, 'utf-8');
module.exports = TOML.parse(content);

// const i18n = {};

// for (const file of fs.readdirSync(I18N_PATH)) {
//     const id = path.parse(file).name;
//     const content = fs.readFileSync(path.join(I18N_PATH, file), 'utf-8');
//     i18n[id] = TOML.parse(content);
// }

// module.exports = i18n;
