const {noop} = require('./utils.js')
const events = new Map()

const on = function (id, handler = noop) {
    if (typeof id !== 'string') {
        throw new Error('Invalid on event ID: Not a String.')
    }

    if (typeof handler !== 'function') {
        throw new Error('Invalid on event handler: Not a Function/undefined.')
    }

    if (handler === noop) {
        return new Promise(function (resolve) {
            const tmp = function () {
                remove(id, tmp)
                resolve()
            }

            on(id, tmp)
        })
    }

    let handlers

    if (events.has(id)) {
        handlers = events.get(id)
    } else {
        handlers = new Set()
        events.set(id, handlers)
    }

    handlers.add(handler)
}

const remove = function (id, handler) {
    if (typeof id !== 'string') {
        throw new Error('Invalid remove event ID: Not a String.')
    }

    if (typeof handler !== 'function') {
        throw new Error('Invalid remove event handler: Not a Function.')
    }

    if (!events.has(id)) {
        return false
    }

    return events.get(id).delete(handler)
}

const trigger = function (id) {
    if (typeof id !== 'string') {
        throw new Error('Invalid trigger event ID: Not a String.')
    }

    if (!events.has(id)) {
        return false
    }

    for (let handler of events.get(id)) {
        handler()
    }

    return true
}

module.exports = {
    on,
    remove,
    trigger
}
