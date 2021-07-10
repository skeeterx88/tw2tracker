require([
    'utils'
], function (
    utils
) {
    const STORE_ID = 'dismissed-notice';

    if (localStorage.getItem(STORE_ID) === 'yes') {
        return;
    }

    const $notice = document.querySelector('#notice');
    const $dismiss = document.querySelector('#notice-dismiss');

    $notice.style.visibility = 'visible';

    $dismiss.addEventListener('click', function () {
        localStorage.setItem(STORE_ID, 'yes');
        $notice.style.visibility = 'hidden';
    });
});
