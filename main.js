"use strict";

/*
 * Solaredge Monitoring
 * github.com/crazykenny93/ioBroker.solaredge
 *
 * (c) crazykenny93 (MIT)
 *
 * Created with @iobroker/create-adapter v1.18.0
 */

const utils = require("@iobroker/adapter-core");
const request = require('request');
const {stat} = require("fs");

const States = Object.freeze({
    LAST_UPDATE_TIME: "lastUpdateTime",
    EXPORTED_ENERGY: "exportedEnergy",
    IMPORTED_ENERGY: "importedEnergy",
    PV_PRODUCTION: "pvProduction",
    BATTERY_DISCHARGE: "batteryDischarge",
    BATTERY_CHARGE: "batteryCharge",
    LOAD: "load"
});


/**
 * The adapter instance
 * @type {ioBroker.Adapter}
 */
let adapter;
let timer;
let shouldCreateStates;
let siteid;

/**
 * Starts the adapter instance
 * @param {Partial<ioBroker.AdapterOptions>} [options]
 */
function startAdapter(options) {
    // Create the adapter and define its methods
    return adapter = utils.adapter(Object.assign({}, options, {
        name: "solaredge",

        // The ready callback is called when databases are connected and adapter received configuration.
        // start here!
        ready: main, // Main method defined below for readability

        // is called when adapter shuts down - callback has to be called under any circumstances!
        unload: (callback) => {
            try {
                adapter.log.info("cleaned everything up...");
                clearTimeout(timer);
                callback();
            } catch (e) {
                callback();
            }
        },
    }));
}

function checkStateCreationNeeded(stateName) {
    adapter.instance
    adapter.getState(`solaredge.${adapter.instance}.${siteid}.${stateName}`, function (err, state) {
        if (!state) {
            adapter.log.info("state " + stateName + " does not exist, will be created");
            shouldCreateStates = true;
        } else {
            adapter.log.debug("state " + stateName + " exists");
            shouldCreateStates |= false;
        }
    });
}

function createStates() {
    adapter.log.debug("creating states");

    Object.keys(States).forEach(stateKey => {
        let value = States[stateKey];
        adapter.createState('', siteid, value, {
            name: value,
            type: value === States.LAST_UPDATE_TIME ? 'string' : 'number',
            read: true,
            write: false,
            role: 'value',
        }, () => {
        });
    });

    shouldCreateStates = false;
}

function main() {

    siteid = adapter.config.siteid;
    let apikey = adapter.config.apikey;

    adapter.log.info("site id: " + siteid);
    adapter.log.info("api key: " + (apikey ? (apikey.substring(0, 4) + "...") : "not set"));

    if ((!siteid) || (!apikey)) {
        adapter.log.error("siteid or api key not set")
    } else {
        const resource = "currentPowerFlow";
        const url = `https://monitoringapi.solaredge.com/site/${siteid}/${resource}.json?api_key=${apikey}`;

        Object.keys(States).forEach(state => {
            checkStateCreationNeeded(States[state]);
        });

        request({
                url: url,
                json: true
            },
            function (error, response, content) {
                if (!error && response.statusCode === 200) {
                    if (content) {
                        if (shouldCreateStates) {
                            createStates();
                        }

                        let currentPowerFlow = content.siteCurrentPowerFlow;
                        let isKW = currentPowerFlow.unit === "kW";

                        let pvPower = isKW ? currentPowerFlow.PV.currentPower * 1000 : currentPowerFlow.PV.currentPower;
                        let batteryDischarge = 0;
                        let batteryCharge = 0;
                        let importedEnergy = 0;
                        let exportedEnergy = 0;
                        let load = 0;


                        let storagePowerFlow = isKW ? currentPowerFlow.STORAGE.currentPower * 1000 : currentPowerFlow.STORAGE.currentPower;
                        console.log(typeof (currentPowerFlow.connections));
                        if (currentPowerFlow.connections.indexOf({from: "STORAGE", to: "Load"}) !== -1) {
                            batteryDischarge = storagePowerFlow;
                        } else if (currentPowerFlow.connections.indexOf({from: "LOAD", to: "Storage"}) !== -1) {
                            batteryCharge = storagePowerFlow;
                        }

                        let gridPowerFlow = isKW ? currentPowerFlow.GRID.currentPower * 1000 : currentPowerFlow.GRID.currentPower;
                        if (currentPowerFlow.connections.indexOf({from: "GRID", to: "Load"}) !== -1) {
                            importedEnergy = gridPowerFlow;
                        } else if (currentPowerFlow.connections.indexOf({from: "Load", to: "GRID"}) !== -1) {
                            exportedEnergy = gridPowerFlow;
                        }

                        currentPowerFlow.connections.filter(c => c.to === "Load").forEach(c => {
                            load += currentPowerFlow[c.from].currentPower;
                        });


                        adapter.log.debug("updating states");

                        adapter.setStateChanged(`${siteid}.${States.LAST_UPDATE_TIME}`, Date.now(), true);
                        adapter.setStateChanged(`${siteid}.${States.PV_PRODUCTION}`, pvPower, true);
                        adapter.setStateChanged(`${siteid}.${States.BATTERY_CHARGE}`, batteryCharge, true);
                        adapter.setStateChanged(`${siteid}.${States.BATTERY_DISCHARGE}`, batteryDischarge, true);
                        adapter.setStateChanged(`${siteid}.${States.IMPORTED_ENERGY}`, importedEnergy, true);
                        adapter.setStateChanged(`${siteid}.${States.EXPORTED_ENERGY}`, exportedEnergy, true);
                        adapter.setStateChanged(`${siteid}.${States.LOAD}`, load, true);
                    } else {
                        adapter.log.warn('Response has no valid content. Check your data and try again. ' + response.statusCode);
                    }
                } else {
                    adapter.log.warn(error);
                }

                adapter.log.info("Done, stopping...");
                adapter.stop();
            }
        );
    }

// (force) stop adapter after 15s
    timer = setTimeout(function () {
        adapter.log.warn("Timeout, stopping...");
        adapter.stop();
    }, 15000);
}

// @ts-ignore parent is a valid property on module
if (module.parent) {
    // Export startAdapter in compact mode
    module.exports = startAdapter;
} else {
    // otherwise start the instance directly
    startAdapter();
}
