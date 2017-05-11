'use strict';

var nutils = require('../components/nutils.js'),
    _ = require('busyman'),
    aesCmac = require('node-aes-cmac').aesCmac,
    crypto = require('crypto'),
    Q = require('q'),
    Lwm2mCodec = require('lwm2m-codec'),
    SmartObject = require('smartobject');

var CNST = require('../constants.json'),
    RSP = CNST.RSP,
    Lwm2mCmdId = CNST.LWM2MCMDID;

var lwm2mEncode = Lwm2mCodec.encode,
    lwm2mDecode = Lwm2mCodec.decode;

function NoraEndDeivce(nora, settings) {
    var self = this,
        devBox = nora._devBox,
        propUnwritable = { writable: false, enumerable: false, configurable: false };
    // members:
    //  info
    // mac option(class): A, B, C
    this._option = settings.option || {};
    if (this._option === 'A')
        this.transmitTiming = recordTiming;
    else if (this._option === 'B') {
        this.transmitTiming = pingSlotTiming;
    } else if (this._option === 'C') {
        this.transmitTiming = 0;
    }
    nora._endDeviceBox[settings.devAddr] = this;
    // control end-device instance operation or not
    //  true: instance is created, the information will be stored
    //  false: instance is created, the information will not be stored and api do not allow to used
    // this._operation = false;
    this.nora = nora;
    this.status = 'offline';
    this._registered = false;
    this.lifeChecker = null;
    // this.sleepChecker = null;

    // record linkCheckReq time
    this._gwCnt = 0;
    // record frame count
    this.count = 0;
    // The information do not want to modify on device instance
    // netId, devAddr, 
    // [ TODO] ping slot

    // Device Infomation
    Object.defineProperty(this, 'info', _.assign({
        value: {
            appEUI: settings.appEUI,
            devEUI: settings.devEUI,
            devNonce: settings.devNonce,
            appKey: settings.appKey,
            appNonce: settings.appNonce,
            netId: settings.netId,
            devAddr: settings.devAddr,
            appSKey: null,
            nwkSKey: null,
            _nwkId: (settings.devAddr >> 25),
            _nwkAddr: (settings.devAddr & 0x1ffffff)
        }
    }, propUnwritable));

    this.info.appSKey = nutils.createSKey('appSKey', self);
    this.info.nwkSKey = nutils.createSKey('nwkSKey', self);

    // [TODO] appKey encrypted, and store in database
    // gateway EUI?
    // this.dlSettings = settings.dlSettings;
    this.rx1DROffset = settings.rx1DROffset || 0;
    this.rx2DR = settings.rx2DR || 2;
    this.rxDelay = settings.rxDelay || 1;
    this.cfList = settings.cfList;
    this.nextPingSlotTime = null;
    this.dataPendingCount = 0;

    this.joinTime = Math.floor(Date.now()/1000);
    this.so = new SmartObject();
    this.version = settings.version || '';
    this.lifetime = settings.lifetime || 86400;
    this.objList = settings.objList || {};
}

NoraEndDeivce.prototype.getStatus = function () {
    return this.status;
};

NoraEndDeivce.prototype._setStatus = function (status) {
    var nora = this.nora;

    if (this.getStatus() !== status) {
        this.status = status;
        nora.emit('ind:status', this, this.getStatus());
    }
};

NoraEndDeivce.prototype.enableLifeChecker = function () {
    var self = this;

    if (this.lifeChecker)
        clearTimeout(this.lifeChecker);

    this.lifeChecker = setTimeout(function () {
        self.nora.remove(self.devAddr).done();
    }, self.lifetime * 1000);

    return this;
};

NoraEndDeivce.prototype.disableLifeChecker = function () {
    if (this.lifeChecker) {
        clearTimeout(this.lifeChecker);
        this.lifeChecker = null;
    }
    return this;
};
/*************************************************************************************************/
/*** Database Functions                                                                        ***/
/*************************************************************************************************/
NoraEndDeivce.prototype.devBoxModify = function (path, data, callback) {
    var self = this;

    this.nora._devBox.findFromDb({devAddr: self.info.devAddr}, function (err, dev) {
        if (err)
            throw new Error('There is an error when finding data from database.');
        else
            self.nora._devBox.modify(dev[0].id, path, data, function (err, diffSnippet) {
                if (err)
                    console.log(err);
                else
                    console.log(diffSnippet);
                if (_.isFunction(callback))
                    callback();
            });
    });
};

NoraEndDeivce.prototype.devBoxReplace = function (path, data, callback) {
    var self = this;

    this.nora._devBox.findFromDb({devAddr: self.info.devAddr}, function (err, dev) {
        if (err)
            throw new Error('There is an error when finding data from database.');
        else
            self.nora._devBox.replace(dev.id, path, data);

        if (_.isFunction(callback))
            callback();
    });
};

NoraEndDeivce.prototype.devBoxSave = function (callback) {
    var self = this,
        devBox;

    return Q.fcall(function () {
        return self.getDevBox();
    }).then(function (db) {
        if (!db)
            throw new Error('No database.');
        else
            devBox = db;

        return self.findEndDeviceFromDb();
    }).then(function (edData) {
        if (!edData) {
            devBox.add({dump: function () {
                return self.dump();
            }}, function (err, id) {
                if (err)
                    throw new Error(err);
            });
        } else {
            return self.devBoxRemove().then(function () {
                var endDeviceData = _.assign(self.dump(), { _id: edData._id });
                devBox.add(endDeviceData, function (err, id) {if (err) throw new Error(err);});
            });
        }
    }).nodeify(callback);
};

NoraEndDeivce.prototype.devBoxRemove = function (callback) {
    var self = this,
        devBox;

    return Q.fcall(function () {
        return self.getDevBox();
    }).then(function (db) {
        if (!db)
            throw new Error('No database.');
        else
            devBox = db;
        return self.findEndDeviceFromDb();
    }).then(function (dev) {
        if (dev) {
            devBox.remove(dev.id, function (err) {
                if (err)
                    throw new Error(err);
                else
                    return self.info.devAddr;
            });
        }
    }).nodeify(callback);
};

NoraEndDeivce.prototype.findEndDeviceFromDb = function (callback) {
    var self = this,
        deferred = Q.defer();

    Q.fcall(function () {
        return self.getDevBox();
    }).then(function (db) {
        if (!db)
            deferred.reject('No database.');
        db.findFromDb({devAddr: self.info.devAddr}, function (err, dev) {
            if (err)
                deferred.reject('There is an error when finding data from database.');
            else
                deferred.resolve(dev[0]);
        });
    }).done();

    return deferred.promise.nodeify(callback);
};

NoraEndDeivce.prototype.getDevBox = function () {
    return this.nora ? this.nora._devBox : undefined;
};

NoraEndDeivce.prototype.dump = function () {
    // store in database information
    // devAddr, netId, version, lifetime, joinTime, nextPingSlotTime, objList(so)
    // netId, rxDelay, cfList
    // endpoint?binding mdoe? sms number?
    return {
        status: this.status,
        option: this._option,
        devEUI: this.info.devEUI,
        appEUI: this.info.appEUI,
        devNonce: this.info.devNonce,
        devAddr: this.info.devAddr,
        netId: this.info.netId,
        appNonce: this.info.appNonce,
        rx1DROffset: this.info.rx1DROffset,
        rx2DR: this.info.rx2DR,
        // dlSettings: this.dlSettings,
        rxDelay: this.rxDelay,
        // cfList: ,
        appKey: this.info.appKey, // need to be encrypted?
        version: this.version,
        lifetime: this.lifetime,
        joinTime: this.joinTime,
        nextPingSlotTime: this.nextPingSlotTime,
        objList: this.so.objectList(),
        so: this.so.dumpSync()
    };
};

NoraEndDeivce.prototype.readReq = function (path, callback) {
    // object id [MUST], object instance id , resource id [OPTIONAL]
    // rsp status: 205(content), 400(bad request), 401(unauthorized), 404(not found), 405(method not allowed), 406(not acceptable)
    var self = this,
        deferred = Q.defer(),
        result = { status: null, data: null },
        buf = [],
        pathContent,
        frmPayload = [],
        frmPayloadBuf;
    // [TODO] bootstrap check
    // path: '/object/object instance/resource'
    if (!_.isString(path))
        throw new TypeError('path should be a string.');
    // [TODO] judge path exist in nora or not, nora exist, register? so exist?
    if (!this._registered)
        throw new TypeError('device is not registerd yet.');
    if (!(this.so instanceof SmartObject))
        throw new Error('No smart object bound to this node.');
    // [TODO] return database information? remote to read end-device value?
    // command cluster? use in appSKey(FPort)?
    Q.fcall(function () {
        // [TODO] rxDelay. class option(A, B, C), transmit message
        //  class A: need to record the next uplink timing.
        //  calss B: be transmited at pingSlot except beaconPeriod timing
        //  class C: be transmited at any time except beaconPeriod timing
        if (self._option === 'A') {
            var nowTime = Math.floor(Date.now()/1000);
            // if (self.nowTime)
        } else if (self._option === 'B') {

        } else if (self._option === 'C') {

        }
        // [TODO] check left time, if > 10 seconds, return error?
        // buf.push(0xa0); // confirmed data down
        // devAddr
        // for (var i = 0;i < 4;i += 1)
        //     buf.push(((self.info.devAddr >> (8 * i)) & 0xff));
        // fctrl
        // if (self.dataPendingCount) {
        //     buf.push(0x10);
        //     self.dataPendingCount -= 1;
        // } else
        //     buf.push(0x00);
        // count
        // for (var i = 0;i < 2;i += 1)
        //     buf.push(((self.count >> (8 * i)) & 0xff));
        // self.count += 1;
        // fport
        // buf.push(0x09);
        // data format? tlv?
        // buf.push(0x20);
        pathContent = nutils.pathParserToArray(path);
        if (pathContent.length === 0 || pathContent.length > 3)
            throw new Error('path is incorrect.');
        // object ID, object instance ID, resource ID
        frmPayload.push(parseInt(pathContent[0]) & 0xff); // number
        frmPayload.push(parseInt((pathContent[0] >> 8)) & 0xff); // number
        if (pathContent.length > 1) {
            frmPayload.push(pathContent[1].length);    // string length
            for (var i = 0;i < pathContent[1].length;i += 1)
                frmPayload.push(pathContent[1][i].charCodeAt(0));   // string, ascii
        }
        if (pathContent.length > 2) {
            frmPayload.push(parseInt(pathContent[2]) & 0xff); // number
            frmPayload.push(parseInt((pathContent[2]) >> 8) & 0xff); // number
        }
        frmPayloadBuf = new Buffer(frmPayload);
        // [TODO] pending problem
        var pending = false;
        if (self.dataPendingCount) {
            pending = true;
            self.dataPendingCount -= 1;
        }
        // devAddr, confirm, ack, pendingBit, cmdId, payload, callback
        self.nora.sendMessage(self.info.devAddr, true, false, pending, Lwm2mCmdId.Read, frmPayloadBuf);
        // encrypt frmPayload
    //     frmPayloadBuf = nutils.frmPayloadcrypto({ devAddr: self.info.devAddr, count: self.count }, 'downlink',frmPayloadBuf, self.info.appSKey);
    //     for (var i = 0;i < frmPayloadBuf.length;i += 1)
    //         buf.push(frmPayloadBuf[i]);
    //     // add mic
    //     buf = nutils.addMic(self, new Buffer(buf), 'downlink');

    //     return buf;
    // }).then(function (buf) {
    //     var data = new Buffer(buf);
    //     console.log('send readReq data');
    //     console.log(data);
    //     self.nora.serverFakeTxData(data);
    //     return self.nora._hal.send(data);
    }).then(function () {
        var receiveFlag = false;
        self.nora.on('readRsp', function (noraEDMsg) {
            // console.log('readRsp');
            // console.log('noraEDMsg');
            // console.log(noraEDMsg);
            // [TODO] Do noraEDMsg need to have devAddr?LoRaWAN is already have devAddr
            if (noraEDMsg.devAddr === self.info.devAddr) {
                // update database
                if (noraEDMsg.data.status === 205)  // content
                    self.updateSoAndDevBox(path, noraEDMsg.data.data);

                self.nora.removeListener('readRsp', function () {
                    // console.log('content');
                });
                receiveFlag = true;
                result.status = noraEDMsg.data.status;
                // result.status = noraEDMsg.data.status;
                // console.log('path');
                // console.log(path);
                result.data = lwm2mDecode('tlv', path, noraEDMsg.data.data);
                // result.data = noraEDMsg.data.data;
                // return result;
                // return { status: noraEDMsg.data.status, data: noraEDMsg.data.data };
                // console.log('result');
                // console.log(result);
                deferred.resolve(result);
                // deferred.resolve({ status: noraEDMsg.data.status, data: noraEDMsg.data.data });
                // return deferred.promise.nodeify(callback);
            }
        });

        setTimeout(function () {
            // console.log('timeout');
            if (!receiveFlag) {
                self.nora.removeListener('readRsp', function () {
                    // console.log('readRsp timeout');
                });
                console.log('readReq timeout');
                result.status = 408;
                result.data = null;
                // return result;
                // return { status: 408, data: null }; // timeout
                // deferred.resolve({ status: 408, data: null });  // timeout
                deferred.resolve(result);  // timeout

                // return deferred.promise.nodeify(callback);
            }
        }, self.rxDelay * 5000);
    }).done();

    return deferred.promise.nodeify(callback);
};

NoraEndDeivce.prototype.writeReq = function (path, value, callback) {
    // object id , object instance id, new value [MUST], resource id [OPTIONAL]
    // path: '/object/object instance/resource'
    // value is depend, it can be string, number, boolean, float...
    // rsp status: 204(changed), 231(continue), 400(bad request), 401(unauthorized), 404(not found), 405(method not allowed)
    //             408(request entity incomplete), 413(request entity too large), 415(unsupported content format)
    var self = this,
        result = { status: null, data: null },
        buf = [],
        pathContent,
        frmPayload = [];
    // [TODO] bootstrap check
    // path: '/object/object instance/resource'
    if (!_.isString(path))
        throw new TypeError('path should be a string.');
    // [TODO] judge path exist in nora or not, nora exist, register? so exist?
    if (!this._registered)
        throw new TypeError('device is not registerd yet.');
    if (!(this.so instanceof SmartObject))
        throw new Error('No smart object bound to this node.');
    // [TODO] return database information? remote to read end-device value?
    // command cluster? use in appSKey(FPort)?
    return Q.fcall(function () {
        // [TODO] rxDelay. class option(A, B, C), transmit message
        //  class A: need to record the next uplink timing.
        //  calss B: be transmited at pingSlot except beaconPeriod timing
        //  class C: be transmited at any time except beaconPeriod timing
        // if (self._option === 'A') {
        //     var nowTime = Math.floor(Date.now()/1000);
        //     if (self.nowTime)
        // } else if (self._option === 'B') {

        // } else if (self._option === 'C') {

        // }
        // check left time, if > 10 seconds, return error?
        buf.push(0xa0);
        // devAddr
        for (var i = 0;i < 4;i += 1)
            buf.push(((self.devAddr >> (8 * i)) & 0xff));
        // fctrl
        if (this.dataPendingCount) {
            buf.push(0x10);
            this.dataPendingCount -= 1;
        } else
            buf.push(0x00);
        // fport
        buf.push(0x0a);
        pathContent = nutils.pathParserToArray(path);
        if (pathContent.length === 0 || pathContent.length > 3)
            throw new Error('path is incorrect.');
        // object ID, object instance ID, resource ID
        frmPayload.push(pathContent[0].value & 0xff); // number
        frmPayload.push((pathContent[0].value >> 8) & 0xff); // number
        frmPayload.push(pathContent[1].length);    // string length
        for (var i = 0;i < pathContent[1].length;i += 1)
            frmPayload.push(pathContent[1][i].charCodeAt(0));   // string, ascii
        if (pathContent.length > 2) {
            frmPayload.push(pathContent[2].value & 0xff); // number
            frmPayload.push((pathContent[2].value >> 8) & 0xff); // number
        }
        // set value, string? float? boolean? integer?
        value = JSON.stringify(value);
        for (var i = 0;i < value.length;i += 1)
            frmPayload.push(value[i]);
        // encrypt frmPayload
        frmPayload = nutils.frmPayloadcrypto({ devAddr: self.info.devAddr, count: self.count }, 'downlink', frmPayload, self.appSKey);
        for (var i = 0;i < frmPayload.length;i += 1)
            buf.push(frmPayload[i]);
        // add mic
        buf = nutils.addMic(self, buf, 1);
        return buf;
    }).then(function (buf) {
        var data = new Buffer(buf);

        nora._hal.send(data);
        nora.on('writeRsp', function (noraEDMsg) {
            if (noraEDMsg.devAddr === self.info.devAddr) {
                if (noraEDMsg.data.status === 204)  // changed
                    self.updateSoAndDevBox(path, noraEDMsg.data.data);

                nora.removeListener('writeRsp');
                reciveFlag = true;

                deferred.resolve({ status: noraEDMsg.data.status });
            }
        });

        setTimeout(function () {
            if (!reciveFlag) {
                nora.removeListener('writeRsp');
                deferred.resolve({ status: 408 });  // timeout
            }
        }, self.rxDelay * 1000);
    }).done();
};

NoraEndDeivce.prototype.executeReq = function (path, args, callback) {
    // object id , object instance id , resource id [MUST], arguments [OPTIONAL]
    // path: '/object/object instance/resource'
    // rsp status: 204(changed), 400(bad request), 401(unauthorized), 404(not found), 405(method not allowed)
    var self = this,
        result = { status: null, data: null },
        buf = [],
        pathContent,
        frmPayload = [];
    // [TODO] bootstrap check
    // path: '/object/object instance/resource'
    if (!_.isString(path))
        throw new TypeError('path should be a string.');
    // [TODO] judge path exist in nora or not, nora exist, register? so exist?
    if (!this._registered)
        throw new TypeError('device is not registerd yet.');
    if (!(this.so instanceof SmartObject))
        throw new Error('No smart object bound to this node.');
    if (_.isFunction(args))
        callback = args;
    else if (!_.isArray(args))
        throw new TypeError('args should be an array.');
    // [TODO] return database information? remote to read end-device value?
    // command cluster? use in appSKey(FPort)?
    return Q.fcall(function () {
        // [TODO] rxDelay. class option(A, B, C), transmit message
        //  class A: need to record the next uplink timing.
        //  calss B: be transmited at pingSlot except beaconPeriod timing
        //  class C: be transmited at any time except beaconPeriod timing
        // if (self._option === 'A') {
        //     var nowTime = Math.floor(Date.now()/1000);
        //     if (self.nowTime)
        // } else if (self._option === 'B') {

        // } else if (self._option === 'C') {

        // }
        // check left time, if > 10 seconds, return error?
        buf.push(0xa0);
        // devAddr
        for (var i = 0;i < 4;i += 1)
            buf.push(((self.devAddr >> (8 * i)) & 0xff));
        // fctrl
        if (this.dataPendingCount) {
            buf.push(0x10);
            this.dataPendingCount -= 1;
        } else
            buf.push(0x00);
        // fport
        buf.push(0x0b);
        pathContent = nutils.pathParserToArray(path);
        if (pathContent.length !== 3)
            throw new Error('path is incorrect.');
        // object ID, object instance ID, resource ID
        frmPayload.push(pathContent[0].value & 0xff); // number
        frmPayload.push((pathContent[0].value >> 8) & 0xff); // number
        frmPayload.push(pathContent[1].length);    // string length
        for (var i = 0;i < pathContent[1].length;i += 1)
            frmPayload.push(pathContent[1][i].charCodeAt(0));   // string, ascii
        frmPayload.push(pathContent[2].value & 0xff); // number
        frmPayload.push((pathContent[2].value >> 8) & 0xff); // number
        // set args
        if (_.isArray(args)) {
            for (var i = 0;i < args.length;i += 1)
                frmPayload.push(args[i]);
        }
        // encrypt frmPayload
        frmPayload = nutils.frmPayloadcrypto({ devAddr: self.info.devAddr, count: self.count }, 'downlink', frmPayload, self.appSKey);
        for (var i = 0;i < frmPayload.length;i += 1)
            buf.push(frmPayload[i]);
        // add mic
        buf = nutils.addMic(self, buf, 1);
        return buf;
    }).then(function (buf) {
        var data = new Buffer(buf);

        nora._hal.send(data);
        nora.on('executeRsp', function (noraEDMsg) {
            if (noraEDMsg.devAddr === self.info.devAddr) {
                nora.removeListener('executeRsp');
                reciveFlag = true;

                deferred.resolve({ status: noraEDMsg.data.status });
            }
        });

        setTimeout(function () {
            if (!reciveFlag) {
                nora.removeListener('executeRsp');
                deferred.resolve({ status: 408 });  // timeout
            }
        }, self.rxDelay * 1000);
    }).nodeify(callback);
};

NoraEndDeivce.prototype.writeAttrsReq = function (path, attrs, callback) {
    // object id [MUST], object instance id , resource id [OPTIONAL]
    // path: '/object/object instance/resource'
    // rsp status: 204(changed), 400(bad request), 401(unauthorized), 404(not found), 405(method not allowed)
    var self = this,
        result = { status: null, data: null },
        buf = [],
        pathContent,
        frmPayload = [];
    // [TODO] bootstrap check
    // path: '/object/object instance/resource'
    if (!_.isString(path))
        throw new TypeError('path should be a string.');
    // [TODO] judge path exist in nora or not, nora exist, register? so exist?
    if (!this._registered)
        throw new TypeError('device is not registerd yet.');
    if (!(this.so instanceof SmartObject))
        throw new Error('No smart object bound to this node.');
    // [TODO] return database information? remote to read end-device value?
    // command cluster? use in appSKey(FPort)?
    return Q.fcall(function () {
        // [TODO] rxDelay. class option(A, B, C), transmit message
        //  class A: need to record the next uplink timing.
        //  calss B: be transmited at pingSlot except beaconPeriod timing
        //  class C: be transmited at any time except beaconPeriod timing
        // if (self._option === 'A') {
        //     var nowTime = Math.floor(Date.now()/1000);
        //     if (self.nowTime)
        // } else if (self._option === 'B') {

        // } else if (self._option === 'C') {

        // }
        // check left time, if > 10 seconds, return error?
        buf.push(0xa0);
        // devAddr
        for (var i = 0;i < 4;i += 1)
            buf.push(((self.devAddr >> (8 * i)) & 0xff));
        // fctrl
        if (this.dataPendingCount) {
            buf.push(0x10);
            this.dataPendingCount -= 1;
        } else
            buf.push(0x00);
        // fport
        buf.push(0x0f);
        pathContent = nutils.pathParserToArray(path);
        if (pathContent.length === 0 || pathContent.length > 3)
            throw new Error('path is incorrect.');
        // object ID, object instance ID, resource ID
        frmPayload.push(pathContent[0].value & 0xff); // number
        frmPayload.push((pathContent[0].value >> 8) & 0xff); // number
        if (pathContent.length > 1) {
            frmPayload.push(pathContent[1].length);    // string length
            for (var i = 0;i < pathContent[1].length;i += 1)
                frmPayload.push(pathContent[1][i].charCodeAt(0));   // string, ascii
        }
        if (pathContent.length > 2) {
            frmPayload.push(pathContent[2].value & 0xff); // number
            frmPayload.push((pathContent[2].value >> 8) & 0xff); // number
        }
        // set class attributes
        frmPayload.push(attrs);
        // encrypt frmPayload
        frmPayload = nutils.frmPayloadcrypto({ devAddr: self.info.devAddr, count: self.count }, 'downlink', frmPayload, self.appSKey);
        for (var i = 0;i < frmPayload.length;i += 1)
            buf.push(frmPayload[i]);
        // add mic
        buf = nutils.addMic(self, buf, 1);
        return buf;
    }).then(function (buf) {
        var data = new Buffer(buf);

        return nora._hal.send(data);
        nora.on('writeAttrsRsp', function (noraEDMsg) {
            if (noraEDMsg.devAddr === self.info.devAddr) {
                nora.removeListener('writeAttrsRsp');
                reciveFlag = true;

                deferred.resolve({ status: noraEDMsg.data.status });
            }
        });

        setTimeout(function () {
            if (!reciveFlag) {
                nora.removeListener('writeAttrsRsp');
                deferred.resolve({ status: 408 });  // timeout
            }
        }, self.rxDelay * 1000);
    }).nodeify(callback);
};

NoraEndDeivce.prototype.discoverReq = function (path, callback) {
    // object id [MUST], object instance id , resource id [OPTIONAL]
    // path: '/object/object instance/resource'
    // rsp status: 204(changed), 400(bad request), 401(unauthorized), 404(not found), 405(method not allowed)
    var self = this,
        result = { status: null, data: null },
        buf = [],
        pathContent,
        frmPayload = [];
    // [TODO] bootstrap check
    // path: '/object/object instance/resource'
    if (!_.isString(path))
        throw new TypeError('path should be a string.');
    // [TODO] judge path exist in nora or not, nora exist, register? so exist?
    if (!this._registered)
        throw new TypeError('device is not registerd yet.');
    if (!(this.so instanceof SmartObject))
        throw new Error('No smart object bound to this node.');
    // [TODO] return database information? remote to read end-device value?
    // command cluster? use in appSKey(FPort)?
    return Q.fcall(function () {
        // [TODO] rxDelay. class option(A, B, C), transmit message
        //  class A: need to record the next uplink timing.
        //  calss B: be transmited at pingSlot except beaconPeriod timing
        //  class C: be transmited at any time except beaconPeriod timing
        // if (self._option === 'A') {
        //     var nowTime = Math.floor(Date.now()/1000);
        //     if (self.nowTime)
        // } else if (self._option === 'B') {

        // } else if (self._option === 'C') {

        // }
        // check left time, if > 10 seconds, return error?
        buf.push(0xa0);
        // devAddr
        for (var i = 0;i < 4;i += 1)
            buf.push(((self.devAddr >> (8 * i)) & 0xff));
        // fctrl
        if (this.dataPendingCount) {
            buf.push(0x10);
            this.dataPendingCount -= 1;
        } else
            buf.push(0x00);
        // fport
        buf.push(0x0e);
        pathContent = nutils.pathParserToArray(path);
        if (pathContent.length === 0 || pathContent.length > 3)
            throw new Error('path is incorrect.');
        // object ID, object instance ID, resource ID
        frmPayload.push(pathContent[0].value & 0xff); // number
        frmPayload.push((pathContent[0].value >> 8) & 0xff); // number
        if (pathContent.length > 1) {
            frmPayload.push(pathContent[1].length);    // string length
            for (var i = 0;i < pathContent[1].length;i += 1)
                frmPayload.push(pathContent[1][i].charCodeAt(0));   // string, ascii
        }
        if (pathContent.length > 2) {
            frmPayload.push(pathContent[2].value & 0xff); // number
            frmPayload.push((pathContent[2].value >> 8) & 0xff); // number
        }
        // encrypt frmPayload
        frmPayload = nutils.frmPayloadcrypto({ devAddr: self.info.devAddr, count: self.count }, 'downlink', frmPayload, self.appSKey);
        for (var i = 0;i < frmPayload.length;i += 1)
            buf.push(frmPayload[i]);
        // add mic
        buf = nutils.addMic(self, buf, 1);
        return buf;
    }).then(function (buf) {
        var data = new Buffer(buf);

        nora._hal.send(data);
        nora.on('discoverRsp', function (noraEDMsg) {
            if (noraEDMsg.devAddr === self.info.devAddr) {
                nora.removeListener('discoverRsp');
                reciveFlag = true;

                deferred.resolve({ status: noraEDMsg.data.status, data: noraEDMsg.data.data });
            }
        });

        setTimeout(function () {
            if (!reciveFlag) {
                nora.removeListener('discoverRsp');
                deferred.resolve({ status: 408, data: null });  // timeout
            }
        }, self.rxDelay * 1000);
    }).nodeify(callback);
};

NoraEndDeivce.prototype.observeReq = function (path, opt, callback) {
    // object id [MUST], object instance id , resource id [OPTIONAL]
    // path: '/object/object instance/resource'
    // opt: true: observe, false: cancel observe
    // rsp status: 204(changed), 400(bad request), 401(unauthorized), 404(not found), 405(method not allowed), 406(not acceptable)
    var self = this,
        result = { status: null, data: null },
        buf = [],
        pathContent,
        frmPayload = [];
    // [TODO] bootstrap check
    // path: '/object/object instance/resource'
    if (!_.isString(path))
        throw new TypeError('path should be a string.');
    // [TODO] judge path exist in nora or not, nora exist, register? so exist?
    if (!this._registered)
        throw new TypeError('device is not registerd yet.');
    if (!(this.so instanceof SmartObject))
        throw new Error('No smart object bound to this node.');
    // [TODO] return database information? remote to read end-device value?
    // command cluster? use in appSKey(FPort)?
    return Q.fcall(function () {
        // [TODO] rxDelay. class option(A, B, C), transmit message
        //  class A: need to record the next uplink timing.
        //  calss B: be transmited at pingSlot except beaconPeriod timing
        //  class C: be transmited at any time except beaconPeriod timing
        // if (self._option === 'A') {
        //     var nowTime = Math.floor(Date.now()/1000);
        //     if (self.nowTime)
        // } else if (self._option === 'B') {

        // } else if (self._option === 'C') {

        // }
        // check left time, if > 10 seconds, return error?
        buf.push(0xa0);
        // devAddr
        for (var i = 0;i < 4;i += 1)
            buf.push(((self.devAddr >> (8 * i)) & 0xff));
        // fctrl
        if (this.dataPendingCount) {
            buf.push(0x10);
            this.dataPendingCount -= 1;
        } else
            buf.push(0x00);
        // fport
        if (opt)
            buf.push(0x10); // observation
        else
            buf.push(0x11); // cancel observation
        pathContent = nutils.pathParserToArray(path);
        if (pathContent.length === 0 || pathContent.length > 3)
            throw new Error('path is incorrect.');
        // object ID, object instance ID, resource ID
        frmPayload.push(pathContent[0].value & 0xff); // number
        frmPayload.push((pathContent[0].value >> 8) & 0xff); // number
        if (pathContent.length > 1) {
            frmPayload.push(pathContent[1].length);    // string length
            for (var i = 0;i < pathContent[1].length;i += 1)
                frmPayload.push(pathContent[1][i].charCodeAt(0));   // string, ascii
        }
        if (pathContent.length > 2) {
            frmPayload.push(pathContent[2].value & 0xff); // number
            frmPayload.push((pathContent[2].value >> 8) & 0xff); // number
        }
        // encrypt frmPayload
        frmPayload = nutils.frmPayloadcrypto({ devAddr: self.info.devAddr, count: self.count }, 'downlink', frmPayload, self.appSKey);
        for (var i = 0;i < frmPayload.length;i += 1)
            buf.push(frmPayload[i]);
        // add mic
        buf = nutils.addMic(self, buf, 1);
        return buf;
    }).then(function (buf) {
        var data = new Buffer(buf);

        nora._hal.send(data);
        nora.on('observeRsp', function (noraEDMsg) {
            if (noraEDMsg.devAddr === self.info.devAddr) {
                nora.removeListener('observeRsp');
                reciveFlag = true;

                deferred.resolve({ status: noraEDMsg.data.status, data: noraEDMsg.data.data });
            }
        });

        setTimeout(function () {
            if (!reciveFlag) {
                nora.removeListener('observeRsp');
                deferred.resolve({ status: 408, data: null });  // timeout
            }
        }, self.rxDelay * 1000);
    }).nodeify(callback);
};

// Bootstrap
// NoraEndDeivce.prototype.bsDiscover = function (path, callback) {
//     // path: '/object/object instance/resource'
// };

// NoraEndDeivce.prototype.bsWrite = function (path, callback) {
//     // path: '/object/object instance/resource'
// };

// [TODO] SmartObject pull high layer to handle ?
// NoraEndDeivce.prototype.read = function (configName, callback) {
    // [TODO] read the value of end-device txPower, dataRate, cfList...
// };

// NoraEndDeivce.prototype.dump = function (callback) {
    // [TODO] dump the information of end-device(txPower, dataRate, cfList...)
// };
   

NoraEndDeivce.prototype.updateSoAndDevBox = function (path, data, callback) {
    var self = this,
        deferred = Q.defer(),
        iObjsUpdater = [],
        iidArray = [],
        dataType = nutils.pathDataType(path),
        dataObj = nutils.getSoKeyObj(path);

    switch(dataType) {
        case 'object':
            _.forEach(data, function (iObj, iid) {
                iObjsUpdater.push(self.updateObjectInstance(dataObj.oid, iid, iObj));
                iidArray.push(iid);
            });

            Q.all(iObjsUpdater).done(function (diffArray) {
                deferred.resolve(diffArray);
            }, function (err) {
                deferred.reject(err);
            });
            break;
        case 'instance':
            this.updateObjectInstance(dataObj.oid, dataObj.iid, data).done(function (diff) {
                deferred.resolve(diff);
            }, function (err) {
                deferred.reject(err);
            });
            break;
        case 'resource':
            this.updateResource(dataObj.oid, dataObj.iid, dataObj.rid, data).done(function (diff) {
                deferred.resolve(diff);
            }, function (err) {
                deferred.reject(err);
            });
            break;
        default:
            break;
    }
    return deferred.promise.nodeify(callback);
};

NoraEndDeivce.prototype.updateObjectInstance = function (oid, iid, data, callback) {
    var self = this,
        deferred = Q.defer(),
        path,
        dotPath,
        devBox = this.getDevBox();

    Q.fcall(function () {
        var chkErr = null,
            iObj = self.so.acquire(oid, iid);

        oid = nutils.oidKey(oid);
        path = nutils.createPath('/', 'so', oid, iid);
        dotPath = nutils.createPath('.', 'so', oid, iid);

        if (!iObj)
            chkErr = chkErr || new Error('No such oid or iid to update.');
        else if (!mqdb)
            chkErr = chkErr || new Error('No database. Is shepherd ready?');
        else if (!_.isPlainObject(data))
            chkErr = chkErr || new TypeError('data to update should be an object.');

        if (chkErr)
            throw chkErr;
        else
            return nutils.objectInstanceDiff(iObj, data);
    }).then(function (diff) {
        if (_.isEmpty(diff))
            return diff;
        else {
            self.devBoxModify(path, data, function () {
                var target = _.get(self, dotPath);
                if (target)
                    _.merge(target, diff);
                return diff;
            });
        }
    }).done(deferred.resolve, deferred.reject);

    return deferred.promise.nodeify(callback);
};

NoraEndDeivce.prototype.updateResource = function (oid, iid, rid, data, callback) {
    var self = this,
        deferred = Q.defer(),
        path,
        dotPath,
        target,
        devBox = this.getDevBox(),
        argumentsLen = arguments.length;

    Q.fcall(function () {
        var chkErr = null,
            resrc = self.so.acquire(oid, iid, rid);

        if (argumentsLen < 4)
            chkErr = chkErr || new Error('Bad Arguments. Data must be given.');
        else if (!devBox)
            chkErr = chkErr || new Error('No datastore.');
        if (_.isUndefined(resrc))
            chkErr = chkErr || new Error('No such oid, iid or rid  to update.');

        if (chkErr)
            throw chkErr;

        oid = nuitls.oidKey(oid);
        rid = nuitls.ridKey(oid, rid);

        path = nutils.createPath('/', 'so', oid, iid, rid);
        dotPath = nutils.createPath('.', 'so', oid, iid, rid);

        target = _.get(self, dotPath);
        // return different in resource
        return nutils.resourceDiff(target, data);
    }).then(function (diff) {
        if (_.isNil(diff))
            return;
        else if (typeof target !== typeof diff) {
            self.devBoxReplace(path, diff, function () {
                _.set(self, dotPath, diff);
                return diff;
            });
        } else if (_.isPlainObject(diff)) {
            self.devBoxModify(path, diff, function () {
                _.merge(target, diff);
                return diff;
            });
        } else {
            self.devBoxModify(path, diff, function () {
                _.set(self, dotPath, diff);
                return diff;
            });
        }
    }).done(deferred.resolve, deferred.reject);

    return deferred.promise.nodeify(callback);
};

NoraEndDeivce.prototype.updateAttrs = function (attrs, callback) {
    // attrs: devAddr, lifetime, version, objList
    var self = this,
        devBox = self.nora._devBox,
        deferred = Q.defer();

    Q.fcall(function () {
        var checkError;

        // console.log('_endDeviceBox');
        // console.log(self.nora._endDeviceBox);
        console.log('noraED');
        console.log('self.info.devAddr');
        console.log(self.info.devAddr);
        console.log('self._registered');
        console.log(self._registered);
        if (!self.nora)
            return new Error('This end-device did not register to the nora.');
        else if (!self._registered)
            return new Error('This end-device was deregistered.');
        else if (!(self.so instanceof SmartObject))
            return new Error('No smart object bound to this end-device.');
        else
            checkError = null;

        if (!_.isPlainObject(attrs))
            checkError = checkError || new TypeError('attrs to update should be an object.');
        else if (!devBox)
            checkError = checkError || new Error('No datastore.');
        if (checkError)
            throw checkError;

        return nutils.devAttrsDiff(self, attrs);
    }).then(function (diff) {
        if (_.isEmpty(diff)) {
            return diff;
        } else {
            return self.devBoxModify('/', diff);
            _.forEach(diff, function (val, key) {
                self[key] = val;
            });
            return diff;
        }
    }).done(deferred.resolve, deferred.reject);

    return deferred.promise.nodeify(callback);
};

module.exports = NoraEndDeivce;