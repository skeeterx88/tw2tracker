const TOML = require('@iarna/toml');
const fs = require('fs');
const defaults = TOML.parse(fs.readFileSync('./share/config.defaults.toml', 'utf-8'));
const defaultsRaw = fs.readFileSync('./share/config.defaults.toml', 'utf-8');

if (!fs.existsSync('./config.toml')) {
    fs.writeFileSync('./config.toml', defaultsRaw);
}

const userDefined = TOML.parse(fs.readFileSync('./config.toml', 'utf-8'));

module.exports = {
    ...defaults,
    ...userDefined
};
