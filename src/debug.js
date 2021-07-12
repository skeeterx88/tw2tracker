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

const debug = require('debug');

module.exports = {
    log: debug('tw2tracker'),
    sync: debug('tw2tracker:sync'),
    auth: debug('tw2tracker:auth'),
    tasks: debug('tw2tracker:tasks'),
    worlds: debug('tw2tracker:worlds'),
    db: debug('tw2tracker:db'),
    socket: debug('tw2tracker:socket'),
    comm: debug('tw2tracker:comm'),
    queue: debug('tw2tracker:queue'),
    history: debug('tw2tracker:history'),
    overflow: debug('tw2tracker:overflow')
};
