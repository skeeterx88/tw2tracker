const fs = require('fs');
const puppeteer = require('puppeteer-core');
const config = require('./config.js');

if (!fs.existsSync(config('puppeteer', 'chromium_path'))) {
    throw new Error(`Can't locate chrome executable: "${config('puppeteer', 'chromium_path')}"`);
}

module.exports = async function () {
    return await puppeteer.launch({
        headless: config('puppeteer', 'headless'),
        executablePath: config('puppeteer', 'chromium_path')
    });
};
