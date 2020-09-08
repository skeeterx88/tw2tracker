const addMarket = async function (market, accountName, accountId, accountToken, enabled = true) {
    return await ajaxPost('/admin/add-market', {
        market: market,
        accountName: accountName,
        accountId: accountId,
        accountToken: accountToken,
        enabled: enabled
    })
}

const debug = {
    addMarket: async function () {
        const result = await addMarket('en', '-Relaxeaza-', '848900934', '0f1673d8f39aa4c15687f5c5afea0ba57d1e6ce6', true)
        console.log(result)
    }
}
