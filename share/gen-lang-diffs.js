const fs = require('fs');
const path = require('path');
const langs = fs.readdirSync('./i18n/');
const en = require('../i18n/en.json');

if (!fs.existsSync('/tmp/tw2_tracker_i18n_missing')) {
    fs.mkdirSync('/tmp/tw2_tracker_i18n_missing');
}

for (const file of langs) {
    const lang = path.parse(file).name;

    if (lang === 'en') {
        continue;
    }

    const target = require(`../i18n/${lang}.json`);
    const diff = {};

    for (const [category] of Object.entries(en)) {
        for (const [key, string] of Object.entries(en[category])) {
            if (!target[category]) {
                diff[category] = en[category];
            } else if (!target[category][key]) {
                diff[category] = diff[category] || {};
                diff[category][key] = string;
            }
        }
    }

    if (Object.keys(diff).length) {
        const date = new Date().toLocaleDateString('ja-JP', {year: 'numeric', month: '2-digit', day: '2-digit'}).replace(/\//g, '_');
        const dest = `/tmp/tw2_tracker_i18n_missing/${lang}_missing_${date}.json`;
        console.log(`Saving ${dest}`);
        fs.writeFileSync(dest, JSON.stringify(diff, null, 4), 'utf-8');
    }
}
