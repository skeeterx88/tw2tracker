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

\require([
    'Chartist',
    'utils',
    'backendValues'
], function (
    Chartist,
    utils,
    {
        historyFullRaw,
        language
    }
) {
    const MAX_AXIS_X_DIVISOR = 5;
    const serializedHistory = {};

    function serializeHistory () {
        const chartTypes = ['points', 'bash_points_off', 'bash_points_def', 'villages'];

        for (const chartType of chartTypes) {
            const data = [];

            for (const item of historyFullRaw) {
                data.push({
                    x: new Date(item.date),
                    y: item[chartType]
                });
            }

            serializedHistory[chartType] = {
                data: {series: [data]},
                options: {
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
                        labelOffset: {
                            x: -15,
                            y: 0
                        },
                        type: Chartist.FixedScaleAxis,
                        divisor: Math.min(MAX_AXIS_X_DIVISOR, data.length - 1),
                        labelInterpolationFnc: function (ts) {
                            return new Date(ts).toLocaleDateString(language.meta.code, {month: 'short', day: 'numeric'});
                        }
                    },
                    axisY: {
                        onlyInteger: true,
                        position: 'end',
                        labelInterpolationFnc: utils.shortifyPoints
                    }
                }
            };
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

            const {data, options} = serializedHistory[chartType];
            new Chartist.Line('.ct-chart', data, options);
        };

        for (const $categorie of $categories) {
            $categorie.addEventListener('click', function () {
                selectChart(this.dataset.chartType);
            });
        }

        selectChart('points');
    }

    function fixChartist () {
        function FixedScaleAxis (axisUnit, data, chartRect, options) {
            const highLow = options.highLow || Chartist.getHighLow(data, options, axisUnit.pos);
            this.divisor = options.divisor || 1;
            this.ticks = options.ticks || Chartist.times(this.divisor+1).map(function (value, index) {
                return highLow.low + (highLow.high - highLow.low) / this.divisor * index;
            }.bind(this));
            this.ticks.sort(function (a, b) {
                return a - b;
            });
            this.range = {
                min: highLow.low,
                max: highLow.high
            };

            Chartist.FixedScaleAxis.super.constructor.call(this,
                axisUnit,
                chartRect,
                this.ticks,
                options);

            this.stepLength = this.axisLength / this.divisor;
        }

        function projectValue (value) {
            return this.axisLength * (+Chartist.getMultiValue(value, this.units.pos) - this.range.min) / (this.range.max - this.range.min);
        }

        Chartist.FixedScaleAxis = Chartist.Axis.extend({
            constructor: FixedScaleAxis,
            projectValue: projectValue
        });
    }

    fixChartist();
    serializeHistory();
    setupSelector();
});
