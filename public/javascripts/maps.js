(async function () {
    const load = await fetch('/maps/api/br48/55.json')
    const data = await load.json()

    console.log(data)
})();
