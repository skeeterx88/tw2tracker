const config = require('./config.js');
const pgp = require('pg-promise')();
const db = pgp(config('database'));

module.exports = {pgp, db};
