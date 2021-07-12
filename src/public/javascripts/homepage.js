// TW2-Tracker
// Copyright (C) 2021 Relaxeaza
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

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
