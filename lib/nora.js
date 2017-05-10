var Objectbox = require('objectbox'),
    _ = require('busyman'),
    fs = require('fs'),
    crypto = require('crypto'),
    util = require('util'),
    init = require('./init.js'),
    nutils = require('./components/nutils.js'),
    aesCmac = require('node-aes-cmac').aesCmac,
    EventEmitter = require('events').EventEmitter,
    msgHandler = require('./components/msgHandler.js'),
    Nora_hal = require('./nora-hal.js'),
    Q = require('q');

var CNST = require('./constants.json');

var hal = new Nora_hal();
// var Fake_Hal = function () {};

// var fake_hal = new Fake_Hal();
// util.inherits(fake_hal, EventEmitter);

function Nora(config, options) {
    var self = this;

    // members:
    //  this._state
    hal.config(config);
    options = options || {};
    this._dbPath = options.dbPath;

    // hardware driver
    this._hal = hal;
    // this._hal = fake_hal;   // fake hal
    this._startTime = 0;
    this._enabled = false;
    this._joinable = false;
    this._permitJoinTime = 0;
    this._permitJoinCountdown;
    // [TODO] class b & c multicast address, default: 0x00000000?
    // this.multicastAddr = options.multicastAddr || 0x00000000;
    // [TODO] class B & c multicast key
    // this.multicastKey = options.multicastKey;
    // [TODO] beacon option: true or falseacta
    this._bOpt = options.beacon || false;
    if (this._bOpt) {
        this._beaconTime;
        this._beaconPeriod = 128;   // unit: second
        // beaconGuardTime, reserveTime?
        this._nextBeaconTime;
    }
    // prepare to join
    this._joinBox = [];
    // otaa register box
    this._otaaRegBox = [];
    // devEUI & devNonce box
    this._pastDevBox = [];

    this.permitJoin = permitJoin.bind(this);

    if (!this._dbPath) {
        this._dbPath = __dirname + '/database/device.db';
        // create default database folder if not there
        try {
            fs.statSync(__dirname + '/databse');
        } catch (e) {
            // fs.mkdirSync(__dirname + '/database');
        }
    }
    // end-device instance
    this._endDeviceBox = {};

    this._devBox = new Objectbox(this._dbPath);

    // Event: ready, pemitJoining, ind, error

    this.on('_ready', function () {
        self._startTime = Math.floor(Date.now()/1000);
        setImmediate(function () {
            self.emit('ready');
            // [TODO] nora need to continue until nora.stop or force close?
            setInterval(function () {}, 30000);
        });
    });

    hal.on('data', function (orginalData) {
        if (self._enabled) {
            console.log('nora got data');
            msgHandler._msgDispatch(self, nutils.parser(orginalData)).then(function (data) {
                msgHandler.dispatchEvent(self, data);
            });
            // nutils.uplinkCheck(self, nutils.parser(orginalData), function (err, data) {
            //     if (!err)
            //         msgHandler.divideEvent(self, data);
            // });
        }
    });

    hal.on('data:client:tx', function (orginalData) {
        if (self._enabled) {
            console.log('nora got cilent data');
            msgHandler._msgDispatch(self, nutils.parser(orginalData)).then(function (data) {
                // console.log('dispatchEvent');
                msgHandler.dispatchEvent(self, data);
            });
            // nutils.uplinkCheck(self, nutils.parser(orginalData), function (err, data) {
            //     if (!err)
            //         msgHandler.divideEvent(self, data);
            // });
        }
    });

    // fake_hal.on('data', function (data) {
    //     if (self._enabled) {
    //         var objPayload = nutils.parser(data);
    //         nutils.uplinkCheck(self, objPayload, function (err, data) {
    //             if (!err)
    //                 msgHandler.divideEvent(self, data);
    //         });
    //     }
    // });

    _eventsHandler(this);
}

util.inherits(Nora, EventEmitter);

Nora.prototype.activate = function (joinWay, config, callback) {
    var deferred = Q.defer();

    if (!_.isString(joinWay))
        throw new TypeError('joinWay should be a String.');

    if (joinWay !== 'OTAA' & joinWay !== 'ABP')
        throw new Error('joinWay should be OTAA or ABP.');

    // OTAA config: appEUI, devEUI, devNonce, appKey. After join: appNonce, netId, devAddr, rx1DROffset, rx2DR, rxDelay, cfList
    // ABP config: devAddr, nwkSKey, appSKey. Other info: netId, rx1DROffset, rx2DR, rxDelay, cfList
    // [TODO] search if there have the same devEUI/devAddr exist
    if (joinWay === 'ABP') {
        if (config.devAddr === undefined | config.nwkSKey === undefined | config.appSKey === undefined | config.netId === undefined) {
            deferred.reject('devAddr, nwkSKey, appSKey or netId can not be undefined, please assign value to those parameters.');
        } else if (!_.isString(config.nwkSKey) | !_.isString(config.appSKey)) {
            throw new TypeError('nwkSKey and appSKey should be a String.');
        } else {  // push ABP config
            config.devAddr = parseInt(config.devAddr);
            // nwkSKey & appSKey should be ASCII
            this._joinBox.push(config);
        }
    } else if (joinWay === 'OTAA') {
        if (config.appEUI === undefined | config.devEUI === undefined | config.appKey === undefined | config.netId === undefined | config.devAddr === undefined | config.appNonce === undefined) {
            deferred.reject('appEUI, devEUI, appKey, netId, devAddr or appNonce can not be undefined, please assign value to those parameters.');
        }  else if (!_.isString(config.appEUI) | !_.isString(config.devEUI) | !_.isString(config.appKey)) {
            throw new TypeError('appEUI, devEUI and appKey should be a String.');
        } else {  // push OTAA conifg
            config.appEUI = parseInt(config.appEUI);
            config.devEUI = parseInt(config.devEUI);
            config.netId = parseInt(config.netId);
            config.devAddr = parseInt(config.devAddr);
            config.appNonce = parseInt(config.appNonce);
            // nwkSKey & appSKey should be ASCII
            this._otaaRegBox.push(config);
        }
    }

    return deferred.promise.nodeify(callback);
};

Nora.prototype._joinAccept = function (devEUI, config, appKey, callback) {
    // config: appNonce, netId, devAddr, rx1DROffset, rx2DR, rxDelay, cfList
    // record joinReq information
    // if record have joinAccept's devEUI, send response & record end-device information
    // after record information, delete information on the record
    // automatic clear record every ? time ? or use permitJoin to set join time ?
    config = config || {};
    config.rx1DROffset = config.rx1DROffset || 0;
    config.rx2DR = config.rx2DR || 0;
    config.rxDelay = config.rxDelay || 1;
    if (!_.isNumber(devEUI))
        throw new TypeError('devEUI should be a number.');
    else if (devEUI < 0 || devEUI > 0xffffffffffffffff)
        throw new RangeError('devEUI should be an integer between 0x0000000000000000 and 0xffffffffffffffff.');
    if (!_.isNumber(config.appNonce))
        throw new TypeError('appNonce should be a number.');
    else if (config.appNonce < 0 || config.appNonce > 16777215)
        throw new RangeError('appNonce should be an integer between 0 and 16777215.');
    if (!_.isNumber(config.netId))
        throw new TypeError('netId should be a number.');
    else if (config.netId < 0 || config.netId > 16777215)
        throw new RangeError('netId should be an integer between 0 and 16777215.');
    if (!_.isNumber(config.devAddr))
        throw new TypeError('devAddr should be a number.');
    else if (config.devAddr < 0 || config.devAddr > 4294967295)
        throw new RangeError('devAddr should be an integer between 0 and 4294967295.');
    if (!_.isNumber(config.rx1DROffset))
        throw new TypeError('rx1DROffset should be a number.');
    else if (config.rx1DROffset < 0 || config.rx1DROffset > 7)
        throw new RangeError('rx1DROffset should be an integer between 0 and 7.');
    if (!_.isNumber(config.rx2DR))
        throw new TypeError('rx2DR should be a number.');
    else if (config.rx2DR < 0 || config.rx2DR > 15)
        throw new RangeError('rx2DR should be an integer between 0 and 15.');
    if (!_.isNumber(config.rxDelay))
        throw new TypeError('rxDelay should be a number.');
    else if (config.rxDelay < 1 || config.rxDelay > 15)
        throw new RangeError('rxDelay should be an integer between 1 and 15.');

    var self = this,
        deferred = Q.defer(),
        settings = {
            devEUI: devEUI,
            appEUI: config.appEUI,
            devNonce: config.devNonce,
            appKey: appKey,
            appNonce: config.appNonce,
            netId: config.netId,
            devAddr: config.devAddr || Math.random() * (0xffffffff - 0 + 1) + 0,// config value or random value
            rx1DROffset: config.rx1DROffset,
            rx2DR: config.rx2DR,
            rxDelay: config.rxDelay
            // cfList: {} // implement single channel, it is not neccessary?
        },
        dev,
        mic,
        dataArray = [],
        dataBuf,
        buf = [],
        data,
        encryptedBuf,
        mhdr,
        acceptMic = '',
        msg = '',
        decipher,
        end_device;
    // search devAddr
    dev = this.find(settings.devAddr);
    // [TODO] devAddr exist or not, if got joinReq?
    // if (!dev)    // devAddr existed
    //     deferred.reject('End-device ' + settings.devAddr + ' exist.');
    // else {  // devAddr does not exist
        var dlSettings = settings.rx2DR | (settings.rx1DROffset << 4);

        return Q.fcall(function () {
            // joinAccept information: appEUI(8 bytes), devEUI(8 bytes), devNonce(2 bytes)
            // info: appNonce(3 bytes), netId(3 bytes), devAddr(4 bytes), dlSettings(1 byte), rxDelay(1 byte), cfList(16 bytes, optional)
            // prepare joinAccept message
            mhdr = 0 | (0 << 2) | (CNST.MType.JOINACCEPT << 5);
            // mhdr
            dataArray.push(mhdr);
            // appNonce
            for (var i = 0;i < 3;i += 1)
                dataArray.push(((settings.appNonce >> (i * 8)) & 0xff));
            // netId
            for (var i = 0;i < 3;i += 1)
                dataArray.push(((settings.netId >> (i * 8)) & 0xff));
            // devAddr
            for (var i = 0;i < 4;i += 1)
                dataArray.push(((settings.devAddr >> (i * 8)) & 0xff));
            dataArray.push(dlSettings);
            dataArray.push(settings.rxDelay);
            // [TODO] cfList use or not
            // Generate MIC
            // cmac = aes128_cmac(AppKey, MHDR | AppNonce | NetID | DevAddr | DLSettings | RxDelay | CFList)
            // MIC = cmac[0..3]
            // data = new Buffer(dataArray);
            mic = aesCmac(appKey, new Buffer(dataArray),  { returnAsBuffer: true });
            for (var i = 0;i < 4;i += 1)
                dataArray.push(mic[i]);

            // [TODO] CFList use or not
            // encrypt with appKey
            // aes128_decrypt(AppKey, AppNonce | NetID | DevAddr | DLSettings | RxDelay | CFList | MIC)
            // appNonce: 3bytes, netId: 3 bytes, devAddr: 4 bytes
            decipher = crypto.createDecipher('aes128', appKey);
            // in order to produce data
            decipher.setAutoPadding(false);
            // delete mhdr
            buf = new Buffer(dataArray.slice(1));
            buf = decipher.update(buf);
            // it does not need to use .final()
            // buf = cipher.final();
            data = new Buffer(buf.length + 1);
            buf.copy(data, 1, 0, buf.length);
            data[0] = mhdr;
            return data;
        }).then(function (buf) {
            // [TODO] wait for join delay: default: rx1: 5 seconds, rx2: 6 seconds
            // fake data
            setTimeout(function () {
                console.log('joinAccept buf');
                console.log(buf);
                self.serverFakeTxData(buf);
            }, 5000);
            
            // hal.send(buf);  // response joinRequest message
        }).done();
    // }
    return deferred.promise.nodeify(callback);
};

Nora.prototype.start = function(callback) {
    var self = this;
    // [TODO] restore information which end-device join before?
    return hal.start().then(function () {
        return init.setupNora(self);
    }).then(function () {
        self._enabled = true;
        self.emit('_ready');
    }).nodeify(callback);
};

Nora.prototype.stop = function(callback) {
    var self = this;

    return hal.idle().then(function () {
        if (!this._enabled)
            return '';
        else {
            self.permitJoin(0);
        }
    }).then(function () {
        self._enabled = false;
        // [TODO] clear all setInterval?
    }).nodeify(callback);
};
// nora -> end-device
Nora.prototype._realRequest = function (cmdId, devAddr, reqObj, callback) {
    if (!_.isString(cmdId))
        throw new TypeError('cmdId should be a string.');

    
};

Nora.prototype.reset = function(mode, callback) {
    var self = this,
        devBox = this._devBox,
        deferred = Q.defer();
    // hard/soft reset?
    // hard: reset all, include database(clear), soft: only reset chip
    // hard: true, soft: false
    // default mode: soft(false)
    if (_.isFunction(mode)) {
        callback = mode;
        mode = false;
    }
    if (mode === true) {
        if (devBox.isEmpty()) {
            devBox = new Objectbox(this._dbPath);
        } else {    // clear database
            var id = devBox.exportAllIds();
            _.forEach(id, function (val, key) {
                devBox.remove(val);
            });
        }
    }
    hal.reset(function (err) {
        if (err)
            deferred.reject(err);
        setImmediate(function () {
            self.stop().then(function () {
                return self.start();
            }).done(deferred.resolve, deferred.reject);
        });
    });

    return deferred.promise.nodeify(callback);
};

Nora.prototype.find = function(devAddr) {
    if (!_.isNumber(devAddr))
        throw new TypeError('devAddr should be a number.');

    return this._endDeviceBox[devAddr];
};

Nora.prototype.list = function(devAddrs) {
    var self = this,
        devList;

    if (!_.isNumber(devAddrs))
        throw new TypeError('devAddr should be a number.');
    else if (!devAddrs)
        devAddrs = _.keys(this._endDeviceBox);

    devList = _.map(devAddrs, function (devAddr) {

    });
    // return devList = this._devBox.exportAllObjs();
};

Nora.prototype.info = function() {
    return {
        enabled: this._enabled,
        devNum: _.size(this._endDeviceBox),
        startTime: this._startTime,
        joinTimeLeft: this._permitJoinTime,
        nextBeaconTime: this._nextBeaconTime,
        beaconPeriod: this._beaconPeriod
    };
};

Nora.prototype.remove = function(devAddr, callback) {
    if (!_.isNumber(devAddr))
        throw new TypeError('devAddr should be a number.');

    var self = this,
        end_device = this.find(devAddr),
        deferred = Q.defer();

    if (!end_device) {
        deferred.reject('End-device 0x' + devAddr + ' does not exist.');
    } else {
        this._devBox.findFromDb({devAddr: devAddr}, function (err, dev) {
            self._devBox.remove(dev[0].id, function (err) {
                if (err)
                    deferred.reject(err);
                else {
                    self._endDeviceBox[devAddr] = null;
                    delete self._endDeviceBox[devAddr];
                    setImmediate(function () {
                        // [TODO] need to response to device?, lwm2m delete?
                        self.emit('ind', {type: 'devLeaving', data: devAddr});
                    });
                    deferred.resolve('Device remove successful.');
                }
            });
        });
    }
    return deferred.promise.nodiefy(callback);
};
/*************************************************************************************************/
/*** MAC Command Functions                                                                     ***/
/*** 0x02 ~ 0x0a: Class A mac command, 0x10 ~ 0x13: Class B mac command                        ***/
/*************************************************************************************************/
Nora.prototype.macReq = function(devAddr, cmdId, config, callback) {
    if (!_.isNumber(devAddr))
        throw new TypeError('devAddr should be a number.');
    if (!_.isNumber(cmdId))
        throw new TypeError('cmdId should be a number.');

    if (devAddr < 0 || devAddr > 4294967295)    // 0x00000000~0xffffffff
        throw new RangeError('devAddr should be an integer in between 0 and 4294967295.');
    if (cmdId < 0 || cmdId > 255)    // 0x00~0xff
        throw new RangeError('cmdId should be an integer in between 0 and 255.');

    var deferred = Q.defer();

    var REG = CNST.REG,
        MType = CNST.MType;

    var self = this,
        fOpts = [],
        outputData,
        mhdr,
        fCtrl,
        fCnt,
        cmac,
        device,
        nowTime = Math.floor(Date.now()/1000);

    // avoid beacon time, the thing which no other data need to be transmit needs to be checked
    if (nowTime === this._nextBeaconTime) {
        setTimeout(function () {
            self.macReq(devAddr, cmdId, config);
        }, 100);
    } else {

    }

    if (cmdId === 0x02)
        callback = config;

    // check devAddr
    device = this.find(devAddr);
    if (!device) {
        deferred.reject('Device address 0x' + devAddr.toString(16) + ' do not existed.');
        return deferred.promise.nodeify(callback);
    }
    device.count = device.count + 1;
    // [Problem] MAC command parameters use in FRMPayload?
    // Command ID
    if (cmdId === 0x02) {
        var margin;

        mhdr = 0x00 | (MType.UNCONFIRMDATADOWN << 5);
        fCtrl = 3 | (0 << 4) | (1 << 5) | (0 << 7) ;
        // [TODO] deal with problem, async function, how should i do
        hal.read(REG.PKTSNRVALUE).then(function (pktSnr) {
            margin = (255 - pktSnr + 1) / 4;
            fOpts.push(margin);
            device._gwCnt = device._gwCnt + 1;
            fOpts.push(device._gwCnt);
        });
    } else if (cmdId === 0x03) {  // linkADRReq
        // data: dataRate, txPower, chMask, redundancy
        if (data.dataRate > 15 || data.dataRate < 0)
            throw new RangeError('DataRate should be in between 0 to 15 if it is a number.');
        if (data.txPower > 15 || data.txPower < 0)
            throw new RangeError('TxPower should be in between 0 to 15 if it is a number.');
        if (data.chMask > 65535 || data.chMask < 0)
            throw new RangeError('ChMask should be in between 0 to 65535 if it is a number.');
        if (data.redundancy > 255 || data.redundancy < 0)
            throw new RangeError('Redundancy should be in between 0 to 255 if it is a number.');

        var dataRate_Power,
            chMask,
            redundancy;
        // set MHDR. MType: confirm data down, Major: LoRaWAN R1(0)
        mhdr = 0x00 | (MType.CONFIRMDATADOWN << 5);
        // set FCtl. FOptsLen, FPending, ACK, ADR
        fCtrl = 5 | (0 << 4) | (0 << 5) | (1 << 7) ;
        // set FOpts. DataRate_Power(1 byte) & ChMask(2 byte) & Redundancy(1 byte)
        dataRate_Power = data.txPower | (data.dataRate << 4);
        fOpts.push(dataRate_Power);
        fOpts.push(data.chMask & 0xff);
        fOpts.push((data.chMask >> 8) & 0xff);
        fOpts.push(data.redundancy);
    } else if (cmdId === 0x04) {  // dutyCycleReq
        // data: dutyCyclePL
        if (data.dutyCyclePL > 15 || data.dutyCyclePL < 0)
            throw new RangeError('MaxDCycle should be in between 0 to 15 if it is a number.');
        // set MHDR. MType: confirm data down, Major: LoRaWAN R1(0)
        mhdr = 0x00 | (MType.CONFIRMDATADOWN << 5);
        // set FCtl. FOptsLen, FPending, ACK, ADR
        fCtrl = 2 | (0 << 4) | (0 << 5) | (0 << 7) ;
        // set FOpts. DutyCyclePL(1 byte): RFU, MaxDCycle
        fOpts.push(data.maxDCycle);
    } else if (cmdId === 0x05) {  // rxParamSetupReq
        // data: rx1DROffset, rx2DR, frequency
        //       dlSettings
        if (data.rx1DRoffset > 7 || data.rx1DRoffset < 0)
            throw new RangeError('rx1DRoffset should be in between 0 to 7 if it is a number.');
        if (data.rx2DR > 15 || data.rx2DR < 0)
            throw new RangeError('rx2DR should be in between 0 to 15 if it is a number.');
        if (data.frequency > 16777215 || data.frequency < 0)
            throw new RangeError('frequency should be in between 0 to 16777215 if it is a number.');

        var dlSettings;
        // set MHDR. MType: confirm data down, Major: LoRaWAN R1(0)
        mhdr = 0x00 | (MType.CONFIRMDATADOWN << 5);
        // set FCtl. FOptsLen, FPending, ACK, ADR
        fCtrl = 5 | (0 << 4) | (0 << 5) | (0 << 7) ;
        // set FOpts. DLSettings(1 byte): RFU, RX1DRoffset, RX2DataRate. Frequency(3 bytes)
        dlSettings = data.rx2DR | (data.rx1DRoffset << 4);
        fOpts.push(data.dlSettings);
        for (var i = 0;i < 3;i += 1)
            fOpts.push((data.frequency >> (8 * i)) & 0xff);
    } else if (cmdId === 0x06) {  // devStatusReq
        // data: none
        // set MHDR. MType: confirm data down, Major: LoRaWAN R1(0)
        mhdr = 0x00 | (MType.CONFIRMDATADOWN << 5);
        // set FCtl. FOptsLen, FPending, ACK, ADR
        fCtrl = 1 | (0 << 4) | (0 << 5) | (0 << 7) ;
        // set FOpts.
    } else if (cmdId === 0x07) {  // newChannelReq
        // data: chIndex, frequency, maxDataRate, MinDataRate.drRange
        if (data.chIndex > 255 || data.chIndex < 0)
            throw new RangeError('ChIndex should be in between 0 to 255 if it is a number');
        if (data.frequency > 16777215 || data.frequency < 0)
            throw new RangeError('Frequency should be in between 0 to 16777215 if it is a number');
        if (data.maxDr > 15 || data.maxDr < 0)
            throw new RangeError('MaxDataRate should be in between 0 to 15 if it is a number');
        if (data.minDr > 15 || data.minDr < 0)
            throw new RangeError('MinDataRate should be in between 0 to 15 if it is a number');

        var drRange;
        // set MHDR. MType: confirm data down, Major: LoRaWAN R1(0)
        mhdr = 0x00 | (MType.CONFIRMDATADOWN << 5);
        // set FCtl. FOptsLen, FPending, ACK, ADR
        // [TODO] check ADR is modified or not.
        fCtrl = 6 | (0 << 4) | (0 << 5) | (0 << 7) ;
        // set FOpts. ChIndex(1 byte), Frequency(3 byte), DrRange(1 byte)
        fOpts.push(data.chIndex);
        for (var i = 0;i < 3;i += 1)
            fOpts.push((data.frequency >> (8 * i)) & 0xff);
        drRange = data.MinDataRate | (params.MaxDataRate << 4);
        fOpts.push(data.drRange);
    } else if (cmdId === 0x08) {  // rxTimingSetupReq
        // data: delay(unit: second)
        if (data.delay > 15 || data.delay < 0)
            throw new RangeError('Delay should be in between 0 to 15 if it is a number');

        // set MHDR. MType: confirm data down, Major: LoRaWAN R1(0)
        mhdr = 0x00 | (MType.CONFIRMDATADOWN << 5);
        // set FCtl. FOptsLen, FPending, ACK, ADR
        // [TODO] check ADR is modified or not.
        fCtrl = 2 | (0 << 4) | (0 << 5) | (0 << 7) ;
        // set FOpts. Settings(1 byte): RFU, Delay
        fOpts.push(data.delay);
    } else if (cmdId === 0x09) {  // txParamSetupReq
        // data: downlinkDwellTime, uplinkDwellTime, maxEIRP
        // Dwell Time: 0: no limit, 1 : 400 ms
        // [TODO] downlinkDwellTime, uplinkDwellTime should be set true or false
        if (data.maxEIRP > 15 || data.maxEIRP < 0)
            throw new RangeError('MaxEIRP should be in between 0 to 15 if it is a number.');

        var eirp_dwellTime;
        // set MHDR. MType: confirm data down, Major: LoRaWAN R1(0)
        mhdr = 0x00 | (MType.CONFIRMDATADOWN << 5);
        // set FCtl. FOptsLen, FPending, ACK, ADR
        // [TODO] check ADR is modified or not.
        fCtrl = 2 | (0 << 4) | (0 << 5) | (0 << 7) ;
        // set FOpts. EIRP_DwellTime: MaxEIRP, uplinkDwellTime, downlinkDwellTime
        eirp_dwellTime = data.maxEIRP | (data.uplinkDwellTime << 4) | (data.dwonlinkDwellTime << 5);
        fOpts.push(eirp_dwellTime);
    } else if (cmdId === 0x0a) {  // DIChannelReq
        // data: chIndex, frequency
        if (data.chIndex > 255 || data.chIndex < 0)
            throw new RangeError('ChIndex should be in between 0 to 255 if it is a number');
        if (data.frequency > 16777215 || data.frequency < 0)
            throw new RangeError('Frequency should be in between 0 to 16777215 if it is a number');

        // set MHDR. MType: confirm data down, Major: LoRaWAN R1(0)
        mhdr = 0x00 | (MType.CONFIRMDATADOWN << 5);
        // set FCtl. FOptsLen, FPending, ACK, ADR
        // [TODO] check ADR is modified or not.
        fCtrl = 5 | (0 << 4) | (0 << 5) | (0 << 7) ;
        // set FOpts. ChIndex(1 byte), Frequency(3 byte), DrRange(1 byte)
        fOpts.push(data.chIndex);
        // [TODO] frequency channel is 100 * frequency ?
        for (var i = 0;i < 3;i += 1)
            fOpts.push((data.frequency >> (8 * i)) & 0xff);
        // [TODO] Class B MAC Command implement(MAC command can not transmit by multicast)
        // [TODO] check device is class B or not
        // [TODO] if device has not any uplink before device ping slot coming,
        //        Class B MAC command should be transmit at device ping slot.(do not send at beacon period time, it is for beacon.)
    } else if (cmdId === 0x10) {  // pingSlotInfoAns
        // data: none?
    } else if (cmdId === 0x11) {  // pingSlotChannelReq
        // data: frequency, drRange: maxDR, minDR
        if (data.frequency > 16777215 || data.frequency < 0)
            throw new RangeError('frequency should be in between 0 to 16777215 if it is a number');
        if (data.maxDR > 15 || data.maxDR < 0)
            throw new RangeError('maxDR should be in between 0 to 15 if it is a number');
        if (data.minDR > 15 || data.minDR < 0)
            throw new RangeError('minDR should be in between 0 to 15 if it is a number');
        var drRange;
        // set MHDR. MType: confirm data down, Major: LoRaWAN R1(0)
        mhdr = 0x00 | (MType.CONFIRMDATADOWN << 5);
        // set FCtl. FOptsLen, FPending, ACK, ADR
        // [TODO] check ADR is modified or not.
        fCtrl = 5 | (0 << 4) | (0 << 5) | (0 << 7) ;
        // [TODO] frequency channel is 100 * frequency ?
        for (var i = 0;i < 3;i += 1)
            fOpts.push((data.frequency >> (8 * i)) & 0xff);
        drRange = minDR | (maxDR << 4);
        fOpts.push(drRange);
    } else if (cmdId === 0x12) {  // beaconTimingAns
        // data: none?
    } else if (cmdId === 0x13) {  // beaconFreqReq
        // data: frequency
        // data: frequency
        if (data.frequency > 16777215 || data.frequency < 0)
            throw new RangeError('frequency should be in between 0 to 16777215 if it is a number');
        if (data.maxDR > 15 || data.maxDR < 0)
            throw new RangeError('maxDR should be in between 0 to 15 if it is a number');
        if (data.minDR > 15 || data.minDR < 0)
            throw new RangeError('minDR should be in between 0 to 15 if it is a number');
        // set MHDR. MType: confirm data down, Major: LoRaWAN R1(0)
        mhdr = 0x00 | (MType.CONFIRMDATADOWN << 5);
        // set FCtl. FOptsLen, FPending, ACK, ADR
        // [TODO] check ADR is modified or not.
        fCtrl = 4 | (0 << 4) | (0 << 5) | (0 << 7) ;
        // [TODO] frequency channel is 100 * frequency ?
        for (var i = 0;i < 3;i += 1)
            fOpts.push((data.frequency >> (8 * i)) & 0xff);
    }
    return Q.fcall(function () {
        var buf = [];
        // mhdr
        buf.push(mhdr);
        return buf;
    }).then(function (buf) {
        // devAddr
        for (var i = 0;i < 4;i += 1)
            buf.push((devAddr >> (8 * i)) & 0xff);
        return buf;
    }).then(function (buf) {
        // FCtrl
        buf.push(fCtrl);
        return buf;
    }).then(function (buf) {
        // FCnt
        buf.push(device.count & 0xff);
        buf.push((device.count >> 8) & 0xff);
        return buf;
    }).then(function (buf) {
        // FOpts, 0x02 have async function
        for (var i = 0;i < fOpts.length;i += 1)
            buf.push(fOpts[i]);
        return buf;
    }).then(function (buf) {
        buf = nutils.addMic(device, buf, 1);
        return buf;
    }).then(function (data) {
        // [TODO] delay need to be check, if the device is class b or c, delay time need to be modify. ping slot?
        if (device._option === 'A') {
            // [TODO] get wakeup time?
        } else if (device._option === 'B') {
            // [TODO] ping slot?
            setTimeout(function () {
                outputData = new Buffer(data);
                return hal.send(outputData);
            }, device.rxDelay * 1000);  // should be beacon time transmitted, but not beacon period time
        } else if (device._option === 'C') {
            // send any time but beacon period time
            outputData = new Buffer(data);
            return hal.send(outputData);
        }
    }).fail(function (err) {
        deferred.reject(err);
    }).done(function () {
        deferred.resolve(outputData.length);
    });
    return deferred.promise.nodeify(callback);
};
// multicast is not ready yet
Nora.prototype.multicast = function (data, callback) {
    if (!_.isBuffer(data))
        throw new TypeError('data must be a buffer.');
    // [TODO] does it need to calculate every end-device ping slot time?or just sending right now?
    // there is no any response from any end-device, callback implemention need to be waited.
    var self = this,
        buf = [],
        msg = '',
        cmac,
        payload,
        outputData,
        mhdr,
        // multicastAddr, // this.multicastAddr
        nowTime = Math.floor(Date.now()/1000);
    // var deferred = Q.defer();
    // avoid beacon time
    if (nowTime === this._nextBeaconTime) {
        // delay?
        setTimeout(function () {
            self.multicast(msg);
        }, 1000);
    } else {
        // [TODO] all gateway should be transmited at the same time.
        // [TODO] multicast key = one of appSKey?
        // [TODO] multicast does not have any mac command
        // MHDR: MTpe: unConfirmed data down
        mhdr = 0 | (0 << 2) | (CNST.UNCONFIRMDATADOWN << 5);
        buf.push(mhdr);
        // [TODO] boradcastDevAddr?
        for (var i = 0;i < 4;i += 1)
            buf.push((this.multicastAddr >> (8 * i)) & 0xff);
        // [TODO] FCtrl: ACK/ADRACKReq must be 0, FOptsLen equal to 0. FPending bit implement?
        fCtrl = 0 | (fPendingBit << 4) | (0 << 5) | (0 << 7);
        buf.push(fCtrl);
        // [TODO] FCnt set? multicastCount?
        buf.push(this.multicastCount & 0xff);
        buf.push((this.multicastCount >> 8) & 0xff);
        // [TODO] FPort can not be set to 0. FPort value: application specific? the same fPort value or have different value?
        buf.push(fPort);
        // [TODO] data(frmPayload), encrypt frmPayload
        // device.devAddr -> device.multicastAddr, device.count -> multicastCount?
        payload = nutils.frmPayloadcrypto(device, data, device.multicastKey);
        for (var i = 0;i < payload.length;i += 1)
            buf.push(payload[i]);
        // [TODO] Generate MIC
        // cmac = aes128_cmac(NwkSKey, B0 | msg)
        // MIC = cmac[0..3]
        // msg = MHDR | FHDR | FPort | FRMPayload
        // B0: 0x49 | 0x00000000 | Dir | DevAddr | FCntUp/FCntDown | 0x00 | len(msg)
        // Dir: 0: uplink, 1: downlink
        // [TODO] check FCnt(4/2 bytes)?
        msg = msg.concat((0x49).toString(16), (0x00000000).toString(16), (0x01).toString(16), this.multicastAddr.toString(16), /*FHDR.FCnt.toString(16), */(0x00).toString(16), buf.length.toString(16));
        // concat msg
        msg = msg.concat(mhdr.toString(16), this.multicastAddr.toString(16), fCtrl.toString(16), device.multicastCount.toString(16));
        nwkSKey = device.nwkSKey;
        cmac = aesCmac(nwkSKey, msg);
        for (var i = 3;i > -1;i -= 1)
            buf.push(cmac[i]);
        // [TODO] what time is transmition timing?
        outputData = new Buffer(buf);
        return hal.send(outputData);
    }
};
// beacon is not ready yet
Nora.prototype._beacon = function (netId, callback) {
    // netId(3 bytes), time(4 bytes), crc(1/2 bytes), gwSpecific(7 bytes), rfu(0/1 bytes), crc(2 bytes)
    // timeStamp
    // gwSpecific: infoDesc(1 byte), info(6 bytes)
    // info: lat(3 bytes), lng(3 bytes)
    // config: netId
    // if (_.isBoolean(opt))
    //     throw new TypeError('opt should be a boolean.');
    if (_.isNumber(netId))
        throw new TypeError('netId should be a number.');

    if (netId < 0 || netId > 16777215)
        throw new RangeError('netId should be an integer in between 0 and 16777215.');

    var self = this,
        timeStamp,
        beaconPeriod = 128,
        lat,
        lng,
        data = [],
        buf;
    var deferred = Q.defer();

    // [TODO] grard time, reserve time?
    if (this._bOpt === true) {
        this._beaconTime = Math.floor(Date.now()/1000);
        this._nextBeaconTime = this._beaconTime + 128;
        // beacon information do not encrypt
        for (var i = 0;i < 3;i += 1)
            data.push((netId >> (8 * i)) & 0xff);
        for (var i = 0;i < 3;i += 1)
            data.push((this._beaconTime >> (8 * i)) & 0xff);
        // [TODO] Generate CRC(1/2 bytes). it is for netId & time
        // [TODO] infoDesc: GPS coordinate of the gateway first antenna
        // [TODO] get lat and lng. how?
        // [TODO] rfu is used or not? if rfu used, rfu should be 0x00(0)
        // [TODO] generate CRC. it is for infoDesc, lat, lng & rfu
        // [TODO] temperature fix?
        buf = new Buffer(data);
        hal.send(buf);
        setTimeout(function () {    // after 128 seconds
            self._beacon(netId);
        }, beaconPeriod * 1000);
        deferred.resolve('Beacon start.');
    } else {
        deferred.resolve('Beacon do not start.');
    }
    return deferred.promise.nodeify(callback);
};
/*************************************************************************************************/
/*** Protected APIs                                                                            ***/
/*************************************************************************************************/
Nora.prototype.sendMessage = function (devAddr, confirm, ack, pending, cmdId, payload, callback) {
    var noraED = this.find(devAddr);

    if (!noraED)
        return;

    // mhdr
    return Q.fcall(function () {
        var buf = [];
        // mhdr
        if (confirm)
            buf.push(0xa0);
        else
            buf.push(0x60);
        return buf;
    }).then(function (buf) {
        // devAddr
        for (var i = 0;i < 4;i += 1)
            buf.push((devAddr >> (8 * i)) & 0xff);
        return buf;
    }).then(function (buf) {
        // fctrl
        ack = ack ? 1 : 0;
        pending = pending ? 1 : 0;
        buf.push((ack << 5) | (pending << 4));
    }).then(function (buf) {
        // count
        buf.push(noraED.count & 0xff);
        buf.push((noraED.count >> 8) & 0xff);
    }).then(function (buf) {
        // fport
        buf.push(cmdId);
    }).then(function (buf) {
        // frmPayload
        // encrypted payload
        payload = nutils.frmPayloadcrypto(noraED, payload, noraED.appSKey);
        for (var i = 0;i < payload.length;i += 1)
            buf(payload[i]);
    }).then(function (buf) {
        // generate mic
        buf = nutils.addMic(noraED, buf, 1);
        return buf;
    }).then(function () {
        // [TODO] according to class A, B, C
        setTimeout(function () {
            return hal.send(buf);
        }, noraED.rxDelay * 1000);
    }).nodeify(callback);
};

Nora.prototype._request = function (noraEd, cmdId, reqObj, callback) {

};

/*************************************************************************************************/
/*** Private Functions                                                                         ***/
/*************************************************************************************************/
function permitJoin(time) {
    // if time is minus integer?
    if (!_.isNil(time) && !_.isNumber(time))
        throw new TypeError('time should be a number if given.');
    var self = this;

    if (!this._enabled) {
        this._permitJoinTime = 0;
        return false;
    }

    time = time || 0;
    this._permitJoinTime = Math.floor(time);

    if (!time) {
        this._joinable = false;
        this._permitJoinTime = 0;

        this.emit('permitJoining', this._permitJoinTime);
        // why permitJoinCountDown clearInterval? avoid something happen?
        if (this._permitJoinCountDown) {
            clearInterval(this._permitJoinCountDown);
            this._permitJoinCountDown = null;
        }
        return true;
    }

    this._joinable = true;
    this.emit('permitJoining', this._permitJoinTime);

    this._permitJoinCountDown = setInterval(function () {
        self._permitJoinTime -= 1;

        if (self._permitJoinTime === 0) {
            self._joinable = false;
            clearInterval(self._permitJoinCountDown);
            self._permitJoinCountDown = null;
            // celar joinBox & regBox
            self._joinBox.length = 0;
            self._otaaRegBox.length = 0;
        }

        self.emit('permitJoining', self._permitJoinTime);
    }, 1000);

    return true;
}

function _eventsHandler(nora) {
    nora.on('macCmd', function (noraEDMsg) {
        if (noraEDMsg.cmd === 'linkCheckReq') {
            nora.macReq(noraEDMsg.devAddr, 0x02);
        }
    });

    nora.on('lwm2mCmd', function (noraEDMsg) {
        if (noraEDMsg.cmd === 'register') {
            msgHandler._registerHandler(nora, noraEDMsg.msg)
        } else if (noraEDMsg.cmd === 'update') {
            msgHandler._updateHandler(nora, noraEDMsg.msg);
        } else if (noraEDMsg.cmd === 'deregister') {
            msgHandler._deregisterHandler(nora, noraEDMsg.msg);
        } else if (noraEDMsg.cmd === 'notify') {
            msgHandler._notifyHandler(nora, noraEDMsg.msg);
        } else {
            nora.emit(noraEDMsg.cmd, noraEDMsg);
        }
    });
}
/*************************************************************************************************/
/*** Test Functions                                                                         ***/
/*************************************************************************************************/
Nora.prototype.serverFakeRxData = function (data) {
    if (!_.isBuffer(data))
        throw new TypeError('data must be a buffer.');
    hal.emit('data:server:rx', data);
};

Nora.prototype.serverFakeTxData = function (data) {
    if (!_.isBuffer(data))
        throw new TypeError('data must be a buffer.');
    hal.emit('data:server:tx', data);
};

Nora.prototype.cilentFakeRxData = function (data) {
    if (!_.isBuffer(data))
        throw new TypeError('data must be a buffer.');
    hal.emit('data:client:rx', data);
};

Nora.prototype.cilentFakeTxData = function (data) {
    if (!_.isBuffer(data))
        throw new TypeError('data must be a buffer.');
    hal.emit('data:client:tx', data);
};

Nora.prototype._fakeSendMessage = function (interface, devAddr, msg) {

};

module.exports = Nora;