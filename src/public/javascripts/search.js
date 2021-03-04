require([
    'utils'
], function (
    utils
) {
    const setupSearch = async () => {
        if (!document.querySelector('#search')) {
            return false;
        }

        const SEARCH_CATEGORIES = {
            players: 'players',
            tribes: 'tribes',
            villages: 'villages'
        };

        const $searchCategories = document.querySelectorAll('#search-categories li');
        const $searchInput = document.querySelector('#search-input');
        const $form = document.querySelector('#search form');
        const $hiddenInput = document.querySelector('#search-category');

        const selectCategory = (category) => {
            if (!utils.hasOwn(SEARCH_CATEGORIES, category)) {
                return false;
            }

            const $selected = document.querySelector('#search-categories li.selected');

            if ($selected) {
                $selected.classList.remove('selected');
            }

            const $toSelect = document.querySelector(`#search-categories li[data-search-category=${category}]`);
            $toSelect.classList.add('selected');
            $hiddenInput.value = category;

            $searchInput.focus();
        };

        for (const $searchCategory of $searchCategories) {
            $searchCategory.addEventListener('click', function () {
                selectCategory(this.dataset.searchCategory);
                return false;
            });
        }

        $form.addEventListener('submit', function (event) {
            const length = $searchInput.value.length;

            if (!length || length > 20) {
                event.preventDefault();
            }
        });
    };

    setupSearch();
});
