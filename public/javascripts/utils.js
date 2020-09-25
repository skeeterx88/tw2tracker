const ajaxPost = async function (url = '', data = {}) {
    const response = await fetch(url, {
        method: 'POST',
        cache: 'no-cache',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })

    return response.json()
}

const boundNumber = function (value, min, max) {
    return Math.min(max, Math.max(parseInt(value, 10), min))
}

const arrayRandom = function (arr) {
    return arr[Math.floor(Math.random() * arr.length)]
}

const noop = function () {}
