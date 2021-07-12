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
