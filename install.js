(async function () {
    let isUser = false
    let runAs = 'arch'
    let environmentType

    const os = require('os')
    const { exec } = require('child_process')
    const fs = require('fs').promises
    const path = require('path')
    const xdgBasedir = require('xdg-basedir')
    const readline = require('readline')
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    })

    if (os.platform() !== 'linux') {
        process.stdout.write('This installer only works on Linux.\n')
        process.exit(1)
    }

    async function install () {
        try {
            await checkUserType()
            await checkSystemd()
            await checkUnitExists()
            await setEnvironment()

            if (!isUser) {
                await selectUser()
            }
        
            const unitDest = isUser ? xdgBasedir.config + '/systemd/user/tw2tracker.service' : '/etc/systemd/system/tw2tracker.service'

            let unitTemplate = await fs.readFile('./share/tw2tracker.service', 'utf-8')

            unitTemplate = unitTemplate.replace('${tw2tracker.environment}', environmentType)
            unitTemplate = unitTemplate.replace('${tw2tracker.directory}', __dirname)
            unitTemplate = unitTemplate.replace('${tw2tracker.user}', isUser ? '' : 'User=' + runAs)

            await fs.writeFile(unitDest, unitTemplate)

            await reloadDaemon()
            await enableDaemon()

            process.stdout.write('Unit installed in ' + unitDest + '\n')
            process.exit(0)
        } catch (error) {
            if (error) {
                process.stdout.write(error.message || error)
            }

            process.stdout.write('Exiting...\n')
            process.exit(1)
        }
    }

    function checkUserType () {
        return new Promise(function (resolve, reject) {
            if (process.env.SUDO_UID) {
                resolve()
            } else {
                rl.question('You need root access to run this.\nDo you want to install with the current user? [Y/n] ', function (response) {
                    if (!response || /y|/i.test(response)) {
                        isUser = true
                        resolve()
                    } else {
                        reject()
                    }
                })
            }
        })
    }

    function checkUserType () {
        return new Promise(function (resolve, reject) {
            if (process.env.SUDO_UID) {
                resolve()
            } else {
                rl.question('You need root access to run this.\nDo you want to install with the current user? [Y/n] ', function (response) {
                    if (!/^y|$/i.test(response)) {
                        isUser = true
                        resolve()
                    } else {
                        reject()
                    }
                })
            }
        })
    }

    function selectUser () {
        return new Promise(function (resolve, reject) {
            rl.question('Which user would you like the unit to run as? [Default: arch] ', async function (response) {
                if (response === 'root') {
                    process.stdout.write('Not allowed to run as root.\n')
                    await selectUser()
                } else if (!response) {
                    runAs = 'arch'
                } else {
                    runAs = response
                }

                resolve()
            })
        })
    }

    function checkSystemd () {
        return new Promise(function (resolve, reject) {
            exec('systemctl', function (error, stdout, stderr) {
                if (error) {
                    reject('Systemd is not installed.')
                } else {
                    resolve()
                }
            })
        })
    }

    function checkUnitExists () {
        return new Promise(async function (resolve, reject) {
            try {
                if (isUser) {
                    await fs.access(xdgBasedir.config + '/systemd/user/tw2tracker.service')
                } else {
                    await fs.access('/etc/systemd/system/tw2tracker.service')
                }

                rl.question('Systemd unit already exists, replace it? [Y/n] ', function (response) {
                    if (/^y|$/i.test(response)) {
                        resolve()
                    } else {
                        reject()
                    }
                })
            } catch {
                resolve()
            }
        })
    }

    function reloadDaemon () {
        return new Promise(function (resolve, reject) {
            const command = isUser ? 'systemctl --user daemon-reload' : 'systemctl daemon-reload'

            exec(command, function (error) {
                if (error) {
                    reject(error)
                } else {
                    resolve()
                }
            })
        })
    }

    function enableDaemon () {
        return new Promise(function (resolve, reject) {
            const enableCommand = isUser ? 'systemctl --user enable tw2tracker.service' : 'systemctl enable tw2tracker.service'
            const disableCommand = isUser ? 'systemctl --user disable tw2tracker.service' : 'systemctl disable tw2tracker.service'

            rl.question('Enable unit to init on system start-up automatically? [Y/n] ', function (response) {
                const finish = function (error) {
                    if (error) {
                        reject(error)
                    } else {
                        resolve()
                    }
                }

                if (/^y|$/i.test(response)) {
                    exec(enableCommand, finish)
                } else {
                    exec(disableCommand, finish)
                }
            })
        })
    }

    function setEnvironment () {
        return new Promise(function (resolve, reject) {
            rl.question('Is this a development environment? [Y/n] ', async function (response) {
                environmentType = /n/i.test(response) ? 'production' : 'development'
                resolve()
            })
        })
    }

    install()
})()
