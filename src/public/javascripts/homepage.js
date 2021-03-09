require([
    'backendValues'
], function (
    {
        worldsByMarket,
        marketStats
    }
) {
    const $markets = document.querySelectorAll('.market-list .market');

    for (const $market of $markets) {
        const $worldList = $market.querySelector('.world-list');
        const $toggleList = $market.querySelector('.toggle-list-worlds');

        $toggleList.addEventListener('click', function (event) {
            event.preventDefault();
            $worldList.classList.toggle('hidden');
            return false;
        });
    }
});
