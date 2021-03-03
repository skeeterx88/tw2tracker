require([], function () {
    const $selector = document.querySelector('#language-selector');
    const $list = document.querySelector('#language-list');
    const $close = $list.querySelector('.close-wrapper');

    $selector.addEventListener('click', function (event) {
        event.preventDefault();
        $list.classList.toggle('hidden');
        return false;
    });

    $close.addEventListener('click', function (event) {
        $list.classList.add('hidden');
    });
});
