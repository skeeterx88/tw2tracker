const token = (function () {
    const cookies = {}

    document.cookie.split('; ').every(function (cookie) {
        const [name, value] = cookie.split('=')

        try {
            cookies[name] = JSON.parse(decodeURIComponent(value))
        } catch (error) {
            cookies[name] = decodeURIComponent(value)
        }
    })

    return cookies.globalAuthCookie ? cookies.globalAuthCookie.token : false
})()

console.log('TOKEN', token)
