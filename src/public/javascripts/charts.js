require([
    'Chartist',
    'utils',
    'backendValues'
], function (
    Chartist,
    utils,
    {
        historyFullRaw
    }
) {
    const serializedHistory = {};
    const chartOptions = {
        height: 160,
        showArea: true,
        showPoint: false,
        chartPadding: {
            right: 10,
            left: 20,
            top: 25,
            bottom: -2
        },
        fullWidth: true,
        reverseData: true,
        lineSmooth: false,
        axisX: {
            position: 'end',
            labelOffset: {
                x: -15,
                y: 0
            },
            type: Chartist.AutoScaleAxis,
            labelInterpolationFnc: function (ts) {
                return new Date(ts).toLocaleDateString('default', {month: 'short', day: 'numeric'});
            }
        },
        axisY: {
            position: 'end',
            labelInterpolationFnc: utils.shortifyPoints
        }
    };
    const specializedChartOptions = {
        villages: {
            axisY: {
                position: 'end',
                labelInterpolationFnc: Chartist.noop
            }
        }
    };

    function serializeHistory () {
        const chartTypes = ['points', 'bash_points_off', 'bash_points_def', 'villages'];

        for (const type of chartTypes) {
            serializedHistory[type] = [];
        }

        for (const item of historyFullRaw) {
            const date = new Date(item.date);

            for (const type of chartTypes) {
                serializedHistory[type].push({x: date, y: item[type]});
            }
        }

        for (const type of chartTypes) {
            serializedHistory[type] = {series: [serializedHistory[type]]};
        }
    }

    function setupSelector () {
        const $categories = document.querySelectorAll('#chart-selector li');

        const selectChart = (chartType) => {
            const $selected = document.querySelector('#chart-selector li.selected');

            if ($selected) {
                $selected.classList.remove('selected');
            }

            const $toSelect = document.querySelector(`#chart-selector li[data-chart-type=${chartType}]`);
            $toSelect.classList.add('selected');

            new Chartist.Line('.ct-chart', serializedHistory[chartType], {
                ...chartOptions,
                ...(specializedChartOptions[chartType] || {})
            });
        };

        for (const $categorie of $categories) {
            $categorie.addEventListener('click', function () {
                selectChart(this.dataset.chartType);
            });
        }

        selectChart('points');
    }

    serializeHistory();
    setupSelector();
});
