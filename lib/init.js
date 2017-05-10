'use strict';

var Q = require('q'),
    _ = require('busyman');

var msgHandler = require('./components/msgHandler.js'),
    NoraEndDevice = require('./components/nora-end-device.js');

var init = {};

init.setupNora = function (nora, callback) {
    return init._loadEndDeviceFromDb(nora);
};

init.exportDeviceFromDb = function (devBox, callback) {
    return Q.ninvoke(devBox, 'findFromDb', {}).then (function (devices) {
        return devices;
    }).nodeify(callback);
};

init._loadEndDeviceFromDb = function (nora, callback) {
    var deferred = Q.defer(),
        devBox = nora._devBox,
        laodEds = [];

    if (devBox) {
        init.exportDeviceFromDb(devBox).then(function (devices) {
            var restoreEd;

            devices.forEach(function (device) {
                devBox.set(device.id, device, function (err, id) {
                    if (err)
                        deferred.reject(err);
                });

                restoreEd = nora._endDeviceBox[device.devAddr] = new NoraEndDevice(nora, device);
                restoreEd._setStatus('offline');
                // so need to be check
                assignSo(restoreEd, device.so);

                // laodEds.push(restoreEd);
            });

            // return Q.all(laodEds);
        }).done(function () {
            deferred.resolve(nora);
        }, function (err) {
            deferred.reject(err);
        });
    } else {
        deferred.reject(new Error('No database.'));
    }

    return deferred.promise.nodeify(callback);
};

function assignSo(so, soData) {
    _.forEach(soData, function (obj, oid) {
        _.forEach(obj, function (iObj, iid) {
            so.init(oid, iid, iObj);
        });
    });
}

module.exports = init;