let express = require('express');
let router = express.Router();

router.get('/', function(req, res, next) {
    res.render('index', {
        title: 'Home - TW2Maps'
    });
});

module.exports = router;
