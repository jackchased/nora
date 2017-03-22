var Nora_hal = require('./nora-hal.js'),
    NoraEndDevice = require('./nora-end-device.js'),
    Objectbox = require('objectbox'),
    _ = require('busyman'),
    fs = require('fs'),
    crypto = require('crypto'),
    util = require('util'),
    aesCmac = require('node-aes-cmac').aesCmac,
    EventEmitter = require('events').EventEmitter,
    Q = require('q');

var CNST = require('./constants.json');

var hal = new Nora_hal();


function Nora(config, options) {
    var self = this;

    // members:
    //  this._state
    hal.config(config);
    options = options || {};
    this._dbPath = options.dbPath;

    // hardware driver
    this._hal = hal;
    this._startTime = 0;
    this._enabled = false;
    this._joinable = false;
    this._permitJoinTime = 0;
    this._permitJoinCountdown;
    // class b & c multicast address, default: 0x00000000?
    this.multicastAddr = options.multicastAddr || 0x00000000;
    // class B & c multicast key
    this.multicastKey = options.multicastKey;
    // beacon option: true or false
    this._bOpt = options.beacon || false;
    this._beaconTime;
    this._beaconPeriod = 128;   // unit: second
    // beaconGuardTime, reserveTime?
    this._nextBeaconTime;
    // _joinBox unreadable?, prepare to join
    this._joinBox = [];
    // register box
    this._regBox = [];

    this.permitJoin = permitJoin.bind(this);

    if (!this._dbPath) {
        this._dbPath = __dirname + '/database/device.db';
        // create default database folder if not there
        try {
            fs.statSync(__dirname + '/databse');
        } catch (e) {
            fs.mkdirSync(__dirname + '/database');
        }
    }

    this._devBox = new Objectbox(this._dbPath);

    // Event: ready, pemitJoining, ind, error

    this.on('_ready', function () {
        self._startTime = Math.floor(Date.now()/1000);
        setImmediate(function () {
            self.emit('ready');
        });
    });
    hal.on('data', function (data) {
        self._parser(data);
    });
}

util.inherits(Nora, EventEmitter);

Nora.prototype.activate = function (joinWay, config, callback) {
    var deferred = Q.defer();

    if (!_.isString(joinWay))
        throw new TypeError('joinWay should be a String.');

    if (joinWay !== 'OTAA' & joinWay !== 'ABP')
        throw new Error('joinWay should be OTAA or ABP.');

    // [TODO] check config, if there is any important information is not assigned, throw error.
    // OTAA config: appEUI, devEUI, devNonce, appKey. After join: appNonce, netId, devAddr, rx1DROffset, rx2DR, rxDelay, cfList
    // ABP config: devAddr, nwkSKey, appSKey. Other info: netId, rx1DROffset, rx2DR, rxDelay, cfList
    // [TODO] search if there have the same devEUI/devAddr exist
    if (joinWay === 'ABP') {
        if (config.devAddr === undefined | config.nwkSKey === undefined | config.appSKey === undefined | config.netId === undefined)
            deferred.reject('devAddr, nwkSKey, appSKey or netId can not be undefined, please assign value to those parameters.');
        else {  // push ABP config
            config.devAddr = parseInt(config.devAddr);
            // nwkSKey & appSKey should be ASCII
            this._joinBox.push(config);
        }
    } else if (joinWay === 'OTAA') {
        if (config.appEUI === undefined | config.devEUI === undefined | config.appKey === undefined | config.netId === undefined | config.devAddr === undefined | config.appNonce === undefined)
            deferred.reject('appEUI, devEUI, appKey, netId, devAddr or appNonce can not be undefined, please assign value to those parameters.');
        else {  // push OTAA conifg
            config.appEUI = parseInt(config.appEUI);
            config.devEUI = parseInt(config.devEUI);
            config.netId = parseInt(config.netId);
            config.devAddr = parseInt(config.devAddr);
            config.appNonce = parseInt(config.appNonce);
            // nwkSKey & appSKey should be ASCII
            this._regBox.push(config);
            // this._joinBox.push(config);
        }
    }

    return deferred.promise.nodeify(callback);
};

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
        payload = this._frmPayloadcrypto(device, data, device.multicastKey);
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

    var deferred = Q.defer(),
        settings = {
            devEUI: devEUI,
            appEUI: config.appEUI,
            devNonce: config.devNonce,
            appKey: appKey,
            // nwkSKey: null,
            // appSKey: null,
            appNonce: config.appNonce,
            netId: config.netId,
            devAddr: config.devAddr || Math.random() * (0xffffffff - 0 + 1) + 0,// config value or random value
            rx1DROffset: config.rx1DROffset || 0,
            rx2DR: config.rx2DR || 2,
            rxDelay: config.rxDelay || 1
            // cfList: {} // implement single channel, it is not neccessary
        },
        dev,
        mic,
        mhdr,
        acceptMic = '',
        buf = [],
        msg = '',
        cipher,
        end_device;
    // search devAddr
    dev = this.find(settings.devAddr);
    if (dev === 'error')
        deferred.reject('error');
    else if (dev === undefined) {   // devAddr does not exist
        var dlSettings = settings.rx2DR | (settings.rx1DROffset << 4);
        // joinAccept information: appEUI(8 bytes), devEUI(8 bytes), devNonce(2 bytes)
        // info: appNonce(3 bytes), netId(3 bytes), devAddr(4 bytes), dlSettings(1 byte), rxDelay(1 byte), cfList(16 bytes, optional)
        // prepare joinAccept message
        mhdr = 0 | (0 << 2) | (CNST.JOINACCEPT << 5);
        // Generate MIC
        // cmac = aes128_cmac(AppKey, MHDR | AppNonce | NetID | DevAddr | DLSettings | RxDelay | CFList)
        // MIC = cmac[0..3]
        acceptMic = acceptMic.concat(mhdr.toString(16), settings.appNonce.toString(16), settings.netId.toString(16), settings.devAddr.toString(16), dlSettings.toString(16), settings.rxDelay.toString(16));
        mic = aesCmac(appKey, acceptMic);
        // [UNCHECK] CFList use or not
        for (var i = 3; i > -1;i -= 1)
            buf.push(mic[i]);
        // encrypt with appKey
        // aes128_decrypt(AppKey, AppNonce | NetID | DevAddr | DLSettings | RxDelay | CFList | MIC)
        msg.concat(settings.appNonce.toString(16), settings.netId.toString(16), settings.devAddr.toString(16), dlSettings.toString(16), settings.rxDelay.toString(16)/*, settings.cfList.toString(16)*/, buf.toString(16));
        cipher = crypto.createCipher('aes128', appKey.toString(16));
        cipher.update(msg);
        buf = cipher.final();
        // [TODO] wait for join delay: default: rx1: 5 seconds, rx2: 6 seconds
        hal.send(buf);  // response joinAccept message
        // create end-device instance
        // end_device = new NoraEndDevice(this, settings);
        // deferred.resolve(end_device);
    } else {    // devAddr existed
        deferred.reject('Device address 0x' + settings.devAddr.toString(16) + ' existed.');
    }
    return deferred.promise.nodeify(callback);
};

Nora.prototype.start = function(callback) {
    var self = this;

    return hal.start().then(function () {
        self._enabled = true;
        self.emit('_ready');
    }).nodeify(callback);
};

Nora.prototype.stop = function(callback) {
    var self = this;

    // [TODO] clear all setInterval or other thing?
    return hal.idle().then(function () {
        // self.emit('stop');
    }).nodeify(callback);
};

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
    this._devBox.findFromDb({devAddr: devAddr}, function (err, device) {
        if (err)
            return 'error';
        else {
            if (device === [])
                return undefined;
            else
                return device;
        }
    });
};

Nora.prototype.list = function() {
    var devList;
    return devList = this._devBox.exportAllObjs();
};

Nora.prototype.info = function() {
    return {
        enabled: this._enabled,
        devNum: _.size(this._devBox),
        startTime: this._startTime,
        joinTimeLeft: this._permitJoinTime,
        nextBeaconTime: this._nextBeaconTime,
        beaconPeriod: this._beaconPeriod
    };
};

Nora.prototype.remove = function(devAddr, callback) {
    var self = this,
        deferred = Q.defer();

    this.find({devAddr: devAddr}, function (err, device) {
        if (device !== undefined) {
            self._devBox.remove(device.id, function (err) {
                if (err)
                    deferred.reject(err);
                else
                    deferred.resolve('Device remove successful.');
            });
        } else {
            deferred.reject('Device does not exist.');
        }
    });
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
        buf = [],
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
    if (device === undefined) {
        deferred.reject('Device address 0x' + devAddr.toString(16) + ' do not existed.');
        return deferred.promise.nodeify(callback);
    }
    fCnt = device.count + 1;
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
            // [TODO] this device is not instance, just in database information
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
        // mhdr
        return buf.push(mhdr);
    }).then(function () {
        // devAddr
        for (var i = 0;i < 4;i += 1)
            fOpts.push((devAddr >> (8 * i)) & 0xff);
        return buf;
    }).then(function () {
        // FCtrl
        return buf.push(fCtrl);
    }).then(function () {
        // FCnt
        buf.push(fCnt & 0xff);
        buf.push((fCnt >> 8) & 0xff);
        return buf;
    }).then(function () {
        // FOpts, 0x02 have async function
        for (var i = 0;i < fOpts.length;i += 1)
            buf.push(fOpts[i]);
        return buf;
    }).then(function () {
        // MIC
        // cmac = aes128_cmac(NwkSKey, B0 | msg)
        // MIC = cmac[0..3]
        // msg = MHDR | FHDR | FPort | FRMPayload
        // B0: 0x49 | 0x00000000 | Dir | DevAddr | FCntUp/FCntDown | 0x00 | len(msg)
        // Dir: 0: uplink, 1: downlink
        // [TODO] check FCnt(4/2 bytes)?
        msg = msg.concat((0x49).toString(16), (0x00000000).toString(16), (0x01).toString(16), devAddr.toString(16), /*FHDR.FCnt.toString(16), */(0x00).toString(16), buf.length.toString(16));
        // concat msg
        msg = msg.concat(mhdr.toString(16), devAddr.toString(16), fCtrl.toString(16), device.count.toString(16));
        // FOpts content
        msg = msg.concat(margin.toString(16), device._gwCnt.toString(16));
        nwkSKey = device.nwkSKey;
        cmac = aesCmac(nwkSKey, msg);
        for (var i = 3;i > -1;i -= 1)
            buf.push(parseInt(cmac[i * 2] + cmac[i * 2 + 1], 16));
        return buf;
    }).then(function () {
        // [TODO] delay need to be check, if the device is class b or c, delay time need to be modify. ping slot?
        if (device._option === 'A') {
            // [TODO] get wakeup time?
        } else if (device._option === 'B') {
            // [TODO] ping slot?
            setTimeout(function () {
                outputData = new Buffer(buf);
                return hal.send(outputData);
            }, device.rxDelay * 1000);  // should be beacon time transmitted, but not beacon period time
        } else if (device._option === 'C') {
            // send any time but beacon period time
            outputData = new Buffer(buf);
            return hal.send(outputData);
        }
    }).fail(function (err) {
        deferred.reject(err);
    }).done(function () {
        deferred.resolve(outputData.length);
    });
    return deferred.promise.nodeify(callback);
};
/*************************************************************************************************/
/*** Protected APIs                                                                            ***/
/*************************************************************************************************/
Nora.prototype._parser = function (data, callback) {
    // according to header mode(implicit, explicit), beacon is in implicit mode
    var self = this,
        deferred = Q.defer();

    var i = 0,
        mhdrByte = data.readUInt8(i),
        mType = CNST.MType,
        phyPayload = {
            mhdr: {
                major: (mhdrByte & 0x03),
                rfu: ((mhdrByte >> 2 ) & 0x07),
                mType: ((mhdrByte >> 5 ) & 0x07)
            },
            macPayload: {
                fhdr: {
                    devAddr: {},
                    fCtrl: {
                        adr: false,
                        rfu: {},
                        adrAckReq: false,
                        ack: {},
                        fPending: false,
                        fOptsLen: {}
                    },
                    fCnt: {},
                    fOpts: {}
                },
                fPort: null,
                payload: {}
            },
            mic: {}
        };
    i += 1;

    if (phyPayload.mhdr.mType === mType.JOINREQUEST) {      // join-request
        // OTAA join-procedure
        if (data.length !== 23) {
            return;
        }

        var joinInfo = {
            mhdr: phyPayload.mhdr,
            appEUI: {},
            devEUI: {},
            devNonce: {},
            mic: {}
        },
        micCheck = '',
        joinMic = '';

        joinInfo.appEUI = data.readUIntLE(i, 8);
        i += 8;
        joinInfo.devEUI = data.readUIntLE(i, 8);
        i += 8;
        joinInfo.devNonce = data.readUInt16LE(i);
        i += 2;
        joinInfo.mic = data.readUIntLE(i, 4).toString(16);
        i += 4;

        // search devNonce in database(objectbox)
        this._devBox.findFromDb({devNonce: joinInfo.devNonce}, function (err, dev) {    // dev is array
            if (err)
                deferred.reject(err);// console.log(err);
            else {
                if (dev.length === 0) {   // devNonce do not exist in database
                    // var len = -1;
                    self._regBox.find(function (joinData) {
                        // check devEUI & appEUI equal to regBox's
                        if ((joinInfo.devEUI === joinData.devEUI) & (joinInfo.appEUI === joinData.appEUI)) {
                            // check MIC
                            // cmac = aes128_cmac(AppKey, MHDR | AppEUI | DevEUI | DevNonce)
                            // MIC = cmac[0..3]
                            joinMic = joinMic.concat(mhdrByte.toString(16), joinInfo.appEUI.toString(16), joinInfo.devEUI.toString(16), joinInfo.devNonce.toString(16));
                            joinMic = aesCmac(joinData.appKey, joinMic);
                            micCheck = micCheck.concat(joinMic[0], joinMic[1], joinMic[2], joinMic[3], joinMic[4], joinMic[5], joinMic[6], joinMic[7]);
                            if (joinInfo.mic === micCheck) {    // MIC correct
                                // OTAA join-procedure
                                // add devNonce & mhdr to joinData
                                joinData.mhdr = joinInfo.mhdr;
                                joinData.devNonce = joinInfo.devNonce;
                                // add to prepare-join-list
                                self._joinBox.push(joinData);
                                // [TODO] server should be fire devIncoming when device is trnasform to devAddr infornation.
                                //        after fire joinAccept, do not emit devIncoming event & end-device instance
                                // [TODO] need one register box & one prepare devIncoming box?
                                // if end-device do not receive joinAccept message
                                // send joinAccept message
                                self._joinAccept(joinData.devEUI, joinData, joinData.appKey, function (err) {
                                    if (err)
                                        deferred.reject(err);
                                    // self.emit('devIncoming', device);
                                });
                                // this._regBox.push();
                                // len = self._regBox.indexOf(joinData);
                            }
                        }
                    });
                    // if (len > -1)
                    //     self._regBox.splice(len, 1);
                } else {
                    deferred.reject('devNonce ' + joinInfo.devNonce + ' is already existed.');
                    // [TODO] return this devNonce existed, this joinReq should be ignored ---show by message?
                }
            }
        });
    } else {    // other message type
        if (data.length < 12) {     // data is not LoRaWAN format
            return;
        }
        // ignore downlink message(joinAccept, unconfirmed data down & confirmed data down)
        if (phyPayload.mhdr.mType === mType.JOINACCEPT | phyPayload.mhdr.mType === mType.UNCONFIRMDATADOWN | phyPayload.mhdr.mType === mType.CONFIRMDATADOWN)
            return;

        var FHDR = phyPayload.macPayload.fhdr,
            FPort = phyPayload.macPayload.fPort,
            Payload = phyPayload.macPayload.payload;
            Mic = phyPayload.mic;

        FHDR.devAddr = data.readUInt32LE(i);
        i += 4;

        FCtrlByte = data.readUInt8(i);
        FHDR.fCtrl.fOptsLen = FCtrlByte & 0x0f;
        // FHDR.FCtrl.FPending = (FCtrlByte >> 4) & 0x01;      // use in downlink
        FHDR.fCtrl.rfu = (FCtrlByte >> 4) & 0x01;        // use in uplink: if RFU = 1 means device is class b
        FHDR.fCtrl.ack = (FCtrlByte >> 5) & 0x01;
        // FHDR.FCtrl.RFU = (FCtrlByte >> 6) & 0x01;           // use in downlink
        FHDR.fCtrl.adrAckReq = (FCtrlByte >> 6) & 0x01;  // use in uplink
        FHDR.fCtrl.adr = (FCtrlByte >> 7) & 0x01;
        i += 1;

        FHDR.FCnt = data.readUInt16LE(i);
        i += 2;

        if (FHDR.fCtrl.fOptsLen !== 0) {
            var buf = new Buffer(FHDR.fCtrl.fOptsLen);
            for(var j = 0;j < FHDR.fCtrl.fOptsLen;j += 1) {
                buf[j] = data.readUInt8(i);
                i += 1;
            }
            FHDR.fOpts = buf;
        }
        // FRMPayload existed or not
        if (data.length - i - 4 > 1) {
            FPort = data.readUInt8(i);
            i += 1;
            Payload = data.readUIntLE(i, (data.length - i - 4));
            i += (data.length - i - 4);
        } else {
            // FPort = null, FRMPayload existed
            FPort = null;
        }

        Mic = data.readUIntLE(i, 4);
        i += 4;

        var end_device,
            msg = '',
            mic = '',
            cmac;
        // check join procedure
        this._joinBox.find(function (joinData) {
            if (joinData.devAddr === FHDR.devAddr) {
                // create end-device instance
                end_device = new NoraEndDevice(self, joinData);
                // [TODO] before fire devIncoming, mic need to be check to insure information correction
                self.emit('devIncoming', end_device);
                len = self._joinBox.indexOf(joinData);
                if (len > -1)
                    self._joinBox.splice(len, 1);   // delete this joinData content
                len = self._regBox.indexOf(joinData);
                if (len > -1)
                    self._regBox.splice(len, 1);   // delete this regData content
            } else {
                // search devAddr in database(objectbox)
                end_device = self.find(FHDR.devAddr);
                if (end_device === 'error')
                    deferred.reject('error');
            }
        });

        // Generate MIC
        // cmac = aes128_cmac(NwkSKey, B0 | msg)
        // MIC = cmac[0..3]
        // msg = MHDR | FHDR | FPort | FRMPayload
        // B0: 0x49 | 0x00000000 | Dir | DevAddr | FCntUp/FCntDown | 0x00 | len(msg)
        // [TODO] check FCnt(4 or 2 bytes)?
        if (end_device !== undefined) {
            msg = msg.concat((0x49).toString(16), (0x00000000).toString(16), (0x01).toString(16), FHDR.devAddr.toString(16), /*FHDR.fCnt.toString(16), */(0x00).toString(16), (data.length - 4).toString(16));
            // concat msg
            msg = msg.concat(mhdrByte.toString(16), FHDR.devAddr.toString(16), FHDR.fCtrl.toString(16), FHDR.fCnt.toString(16));
            if (FHDR.fCtrl.fOptsLen !== 0)
                msg = msg.concat(FHDR.fOpts.toString(16));
            if (FPort !== null)
                msg = msg.concat(Payload.toString(16));
            // nwkSKey = end_device.nwkSKey;
            cmac = aesCmac(end_device.nwkSKey, msg);
            mic = mic.concat(cmac[0], cmac[1], cmac[2], cmac[3], cmac[4], cmac[5], cmac[6], cmac[7]);
        } else
            mic = null;
        // check mic correction
        if (mic === Mic) {
            if (end_device.count !== FHDR.fCnt) // check frame counter, fix counter
                end_device.count = FHDR.fCnt;
            if (FHDR.fCtrl.fOptsLen === 0) {    // FOpts not existed
                if (FPort === null) {
                    // empty payload
                    deferred.resolve(null);
                } else if (FPort === 0) {  // Payload is MAC command
                    // decrypt FRMPayload
                    Payload = this._frmPayloadcrypto(device, Payload, device.info.nwkSKey);
                    // key = device.info.nwkSKey;
                    if (Payload[0] === 0x02)    // automatic response linkCheckAns(cmdId:0x02)
                        this.macReq(FHDR.devAddr, 0x02);
                    // [TODO] Class B MAC command
                    else if (Payload[0] === 0x10)   // pingSlotInfoAns
                        this.macReq(FHDR.devAddr, 0x10);
                    else if (Payload[0] === 0x12)   // beaconTimingAns
                        this.macReq(FHDR.devAddr, 0x12);
                } else {    // Payload is application data
                    // decrypt FRMPayload
                    Payload = this._frmPayloadcrypto(device, Payload, device.info.appSKey);
                    // key = device.info.appSKey;
                }
            } else {    // FOpts existed, MAC Command
                if (FHDR.fOpts[0] === 0x02)    // automatic response linkCheckAns(cmdId:0x02)
                    this.macReq(FHDR.devAddr, 0x02);
                // [TODO] Class B MAC command
            }
            // return decrypted payload
            // [TODO] according to devAddr, payload & fCnt should be stored in database & device instance value
            deferred.resolve(Payload);
            // return Payload;
        } else {    // mic incorrect
            deferred.reject('mic is not correct.');
        }

        // this._payloadCheck(phyPayload, function (err, data) {
        //     // [TODO] FRMPayload(application data) is not designed yet.
        //     if (err)
        //         deferred.reject(err);
        //     else
        //         deferred.resolve(data);
        // });
        return deferred.promise.nodeify(callback);
    }
}

Nora.prototype._payloadCheck = function (info, callback) {
    // info is not join-request
    var self = this,
        deferred = Q.defer();

    var FHDR = info.MACPayload.FHDR,
        FPort = info.MACPayload.FPort,
        Payload = info.MACPayload.Payload,
        payloadMic = info.MIC,
        len = -1,
        nwkSKey,
        device,
        end_device,
        msg ='',
        // key,
        cmac,
        mic = '';

    // check join procedure
    this._joinBox.find(function (joinData) {
        if (joinData.devAddr === FHDR.DevAddr) {
            // create end-device instance
            end_device = new NoraEndDevice(self, joinData);
            // [TODO] before fire devIncoming, mic need to be check to insure information correction
            self.emit('devIncoming', end_device);
            len = self._joinBox.indexOf(joinData);
            if (len > -1)
                self._joinBox.splice(len, 1);   // delete this joinData content
            len = self._regBox.indexOf(joinData);
            if (len > -1)
                self._regBox.splice(len, 1);   // delete this regData content
        } else {
            // search devAddr in database(objectbox)
            device = self.find(FHDR.DevAddr);
            if (device === 'error')
                deferred.reject('error');
        }
    });

    // Generate MIC
    // cmac = aes128_cmac(NwkSKey, B0 | msg)
    // MIC = cmac[0..3]
    // msg = MHDR | FHDR | FPort | FRMPayload
    // B0: 0x49 | 0x00000000 | Dir | DevAddr | FCntUp/FCntDown | 0x00 | len(msg)
    // [TODO] check FCnt(4 or 2 bytes)?
    if (device !== undefined) {
        msg = msg.concat((0x49).toString(16), (0x00000000).toString(16), (0x01).toString(16), FHDR.devAddr.toString(16), /*FHDR.FCnt.toString(16), */(0x00).toString(16), info.length.toString(16));
        // concat msg
        msg = msg.concat(info.MHDR.toString(16), FHDR.devAddr.toString(16), FHDR.FCtrl.toString(16), FHDR.FCnt.toString(16));
        if (FHDR.FCtrl.FOptsLen !== 0)
            msg = msg.concat(FHDR.FOpts.toString(16));
        if (FPort !== null)
            msg = msg.concat(Payload.toString(16));
        nwkSKey = device.nwkSKey;
        cmac = aesCmac(nwkSKey, msg);
        mic = mic.concat(cmac[0], cmac[1], cmac[2], cmac[3], cmac[4], cmac[5], cmac[6], cmac[7]);
    } else
        mic = null;
    // check mic correction
    if (mic === payloadMic) {
        if (device.count !== FHDR.FCnt) // check frame counter, fix counter
            device.count = FHDR.FCnt;
        if (FHDR.FCtrl.FOptsLen === 0) {    // FOpts not existed
            if (FPort !== null) {
                // Payload = info.MACPayload.Payload;
                if (FPort === 0) {  // Payload is MAC command
                    // decrypt FRMPayload
                    Payload = this._frmPayloadcrypto(device, Payload, device.info.nwkSKey);
                    // key = device.info.nwkSKey;
                    if (Payload[0] === 0x02)    // automatic response linkCheckAns(cmdId:0x02)
                        this.macReq(FHDR.DevAddr, 0x02);
                    // [TODO] Class B MAC command
                    else if (Payload[0] === 0x10)   // pingSlotInfoAns
                        this.macReq(FHDR.DevAddr, 0x10);
                    else if (Payload[0] === 0x12)   // beaconTimingAns
                        this.macReq(FHDR.DevAddr, 0x12);
                } else {    // Payload is application data
                    // decrypt FRMPayload
                    Payload = this._frmPayloadcrypto(device, Payload, device.info.appSKey);
                    // key = device.info.appSKey;
                }
            } else {
                // empty payload
                deferred.resolve(null);
                // return null;
            }
        } else {    // FOpts existed, MAC Command
            if (FHDR.FOpts[0] === 0x02)    // automatic response linkCheckAns(cmdId:0x02)
                this.macReq(FHDR.DevAddr, 0x02);
            // [TODO] Class B MAC command
        }
        // return decrypted payload
        // [TODO] according to devAddr, payload & fCnt should be stored in database & device instance value
        deferred.resolve(Payload);
        // return Payload;
    } else {    // mic incorrect
        deferred.reject('mic is not correct.');
    }
    return deferred.promise.nodeify(callback);
}

// Nora.prototype._generateMic = function (device, data) {
//     var buf,
//         msg = '',
//         cmac;
//     // MIC
//     // cmac = aes128_cmac(NwkSKey, B0 | msg)
//     // MIC = cmac[0..3]
//     // msg = MHDR | FHDR | FPort | FRMPayload
//     // B0: 0x49 | 0x00000000 | Dir | DevAddr | FCntUp/FCntDown | 0x00 | len(msg)
//     // Dir: 0: uplink, 1: downlink
//     // [TODO] check FCnt(4/2 bytes)?
//     msg = msg.concat((0x49).toString(16), (0x00000000).toString(16), (0x01).toString(16), devAddr.toString(16), /*FHDR.FCnt.toString(16), */(0x00).toString(16), buf.length.toString(16));
//     // concat msg
//     msg = msg.concat(mhdr.toString(16), devAddr.toString(16), fCtrl.toString(16), device.count.toString(16));
//     // FOpts content
//     msg = msg.concat(margin.toString(16), device._gwCnt.toString(16));
//     nwkSKey = device.nwkSKey;
//     cmac = aesCmac(nwkSKey, msg);
//     for (var i = 3;i > -1;i -= 1)
//         buf.push(cmac[i]);
//     return buf;
// };
// To encrypt/decrypt FRMPayload
Nora.prototype._frmPayloadcrypto = function (device, data, key) {
    if (!_.isBuffer(data))
        throw new TypeError('data must be a buffer.');
    var cipher,
        seq,
        seqSum = '',
        buf = '';
    // FPort: 0: NwkSKey, 1~255: AppSKey, K: NwkSKey/AppSKey
    // Ai = (0x01 | 0x00000000 | Dir | DevAddr | FCnt(Up/Down) | 0x00 | i)
    // Dir: 0: uplink, 1: downlink, pld = FRMPayload
    // Si = aes128_encrypt(K, Ai), i = 1..k, k = ceill(len(pld)/16)
    // S = S1 | S2 | .. | Sk
    // Encryption and decryption of the payload is done by truncating
    // (pld | pad16) xor S to the first len(pld) octets
    for (var i = 1;i < (data.length / 16);i += 1) {
        cipher = crypto.createCipher('aes128', key.toString(16));
        seq = buf.concat((0x01).toString(16), (0x00000000).toString(16), (0x00).toString(16), device.devAddr.toString(16), device.count.toString(16)/*FCnt(Up/Down)*/, (0x00).toString(16), i.toString(16));
        buf = '';
        cipher.update(seq);
        seq = cipher.final();
        seqSum = seqSum.concat(seq, 16);
    }
    // [TODO] Correction need to be checked
    for (var i = 0;i < (data.length - data.length % 16); i += 1)
        data[i] = data[i] ^ seqSum[i].charCodeAt(0);
    return data;
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
            self._regBox.length = 0;
        }

        self.emit('permitJoining', self._permitJoinTime);
    }, 1000);

    return true;
}
/*************************************************************************************************/
/*** Test Functions                                                                         ***/
/*************************************************************************************************/
Nora.prototype.fakeRxData = function (data) {
    if (!_.isBuffer(data))
        throw new TypeError('data must be a buffer.');
    hal.emit('data', data);
};
module.exports = Nora;