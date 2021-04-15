#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const utils = require('../src/utils.js');

const targetLocation = path.resolve(process.argv[2]);
const changesLocation = path.resolve(process.argv[3]);

const target = JSON.parse(fs.readFileSync(targetLocation, 'utf-8'));
const changes = JSON.parse(fs.readFileSync(changesLocation, 'utf-8'));
const result = JSON.stringify(utils.mergeDeep(target, changes), null, 4);

fs.writeFileSync(targetLocation, result, 'utf-8');
