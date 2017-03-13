var Nora_hal = require('./nora-hal.js'),
    NoraEndDevice = require('./nora-end-device.js'),
    _ = require('busyman'),
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

    this._dbPath = options.dbPath;

    if (!this._dbPath) {
        this._dbPath = __dirname + '/database/device.db';
        // create default database folder if not there
        try {
            fs.statSync(__dirname + '/databse');
        } catch (e) {
            fs.mkdirSync(__dirname + '/database');
        }
    }
    this._joinBox = [];

    this._devBox = new Objectbox(this._dbPath);

    // Event: ready, ind, error
    hal.on('data', function (data) {
        self._parser(data);
    });

    this.on('_devData', function (devData) {
        this._payload(devData);
    });
}

util.inherits(Nora, EventEmitter);

Nora.prototype.joinAccept = function (devEUI, config, appKey, callback) {
    // record joinReq information
    // if record have joinAccept's devEUI, send response & record end-device information
    // after record information, delete information on the record
    // automatic clear record every ? time ? or use permitJoin to set join time ?

    var deferred = Q.defer(),
        settings = {
            devEUI: devEUI,
            appEUI: {},
            devNonce: {},
            appKey: appKey,
            appNonce: config.appNonce,
            netId: config.netId,
            devAddr: config.devAddr// [TODO] random or use config value
            rx1DROffset: {},
            rx2DR: {},
            rxDelay: {}
            // cfList: {} // implement single channel, it is not neccessary
        },
        mic,
        mhdr,
        micCheck,
        joinMic = '',
        acceptMic = '',
        buf = [],
        end_device;

    this._joinBox.find(function (joinReqData) {
        if (devEUI === joinReqData.devEUI) {    // get appEUI & devNonce
            mhdr = joinReqData.mhdr;
            settings.appEUI = joinReqData.appEUI;
            settings.devNonce = joinReqData.devNonce;
            mic = joinReqData.mic;
        }
    });
    // joinReq information
    // check MIC
    // cmac = aes128_cmac(AppKey, MHDR | AppEUI | DevEUI | DevNonce)
    // MIC = cmac[0..3]
    joinMic = joinMic.concat(mhdr.toString(16), settings.appEUI.toString(16), settings.devEUI.toString(16), settings.devNonce.toString(devNonce));
    joinMic = aesCmac(appKey, joinMic);
    micCheck = joinMic.concat(joinMic[0], joinMic[1], joinMic[2], joinMic[3]);
    if (micCheck === mic) { // MIC correct
        this._devBox.findFromDb({devAddr: settings.devAddr}, function (err, docs) {
            if (err)
                console.log(err);
            else {
                // check devAddr
                if (docs === []) {  // devAddr does not exist
                    var dlSettings;
                    // [TODO] implement crypto part
                    // joinAccept information: appEUI(8 bytes), devEUI(8 bytes), devNonce(2 bytes)
                    // info: appNonce(3 bytes), netId(3 bytes), devAddr(4 bytes), dlSettings(1 byte), rxDelay(1 byte), cfList(16 bytes, optional)
                    // encrypt with appKey
                    // aes128_decrypt(AppKey, AppNonce | NetID | DevAddr | DLSettings | RxDelay | CFList | MIC)
                    // Generate MIC
                    // cmac = aes128_cmac(AppKey, MHDR | AppNonce | NetID | DevAddr | DLSettings | RxDelay | CFList)
                    // MIC = cmac[0..3]
                    acceptMic = acceptMic.concat(mhdr.toString(16), settings.appNonce.toString(16), settings.netId.toString(16), settings.devAddr.toString(devNonce), dlSettings.toString(16), settings.rxDelay.toString(16));
                    mic = aesCmac(appKey, acceptMic);

                    mhdr = 0 | (0 << 2) | (CNST.JOINACCEPT << 5);
                    buf.push(mhdr);
                    for (var i = 2;i > -1;i -= 1)
                        buf.push((settings.appNonce >> (i * 8)) && 0xff);
                    for (var i = 2;i > -1;i -= 1)
                        buf.push((settings.netId >> (i * 8)) && 0xff);
                    for (var i = 3;i > -1;i -= 1)
                        buf.push((settings.devAddr >> (i * 8)) && 0xff);
                    dlSettings = settings.rx2DR | (settings.rx1DROffset << 4)
                    buf.push(dlSettings);
                    buf.push(settings.rxDelay);
                    // [UNCHECK] CFList use or not
                    for (var i = 0; i < 4;i += 1)
                        buf(mic[i]);
                    hal.send(buf);  // response joinAccept message
                    // create end-device instance
                    return end_device = new NoraEndDevice(this, settings);
                } else {
                    deferred.reject(new Error('Device address ' + settings.devAddr ' existed.'));
                }
            }
        });
    } else {
        deferred.reject(new Error('MIC is not correct. Please check appkey and send this packet again'));
    }
    return deferred.promise.nodify(callback);
};

Nora.prototype.start = function(callback) {
    var self = this;

    return hal.start().then(function () {
        return hal.on('ready', function () {
            self.emit('ready');
        });
    }).done();
};

Nora.prototype.stop = function(callback) {
    return hal.idle().then(function () {

    }).done();
};

    // [TODO] increase reset pin
Nora.prototype.reset = function(mode, callback) {
    // hard/soft reset?
    // hard: reset all, include database(clear), soft: only reset chip
};
// MAC Command
Nora.prototype.macReq = function(devAddr, cId, config, callback) {
        if (!_.isNumber(data.cId))
            throw new TypeError('Command ID should be a number');
    var buf = [],
        outputData,
        mhdr,
        // devAddr = this.info.devAddr,
        fCtrl,
        fCnt = this.count + 1,
        fOpts,
        fPort,
        payload,
        mic;
        // MHDR ()
        // DevAddr
        // FCtrl ()
        // FCnt
        // FOpts ()
        // Command ID ()
        // params ()

    // if (cId === 0x02) {
    //     // [TODO] linkCheckAns should be automatic response when end-device sned linkCheckReq ?
    //     // set MHDR. MType: unconfirm data down, Major: LoRaWAN R1(0)
    //     mhdr = 0x00 | (MType.UNCONFIRMDATADOWN << 5);
    //     fCtrl = 2 | (0 << 4) | (1 << 5) | (0 << 7) ;
    // } else if (cId === 0x03) {

    // } else if (cId === 0x04) {
        
    // } else if (cId === 0x05) {
        
    // } else if (cId === 0x06) {
        
    // } else if (cId === 0x07) {
        
    // } else if (cId === 0x08) {
        
    // } else if (cId === 0x09) {
        
    // } else if (cId === 0x0a) {
        
    // }

    // // set devAddr
    // buf.push((this.devAddr >> 24) && 0xff);
    // buf.push((this.devAddr >> 16) && 0xff);
    // buf.push((this.devAddr >> 8) && 0xff);
    // buf.push(this.devAddr && 0xff);

    // // set FCnt
    // buf.push((fCnt >> 8) && 0xff);
    // buf.push(fCnt && 0xff);
        // [WAIT_DECIDE] MAC command parameters use in FRMPayload?
        // Command ID
        buf.push(data.cId);
        if (data.cId === 0x02) {         // linkCheckAns
            var margin,
                gwCnt;

            callback = data;
            // [TODO] linkCheckAns should be automatic response when end-device sned linkCheckReq ?
            // set MHDR. MType: unconfirm data down, Major: LoRaWAN R1(0)
            mhdr = 0x00 | (MType.UNCONFIRMDATADOWN << 5);
            buf.push(mhdr);
            // set devAddr
            buf.push((devAddr >> 24) && 0xff);
            buf.push((devAddr >> 16) && 0xff);
            buf.push((devAddr >> 8) && 0xff);
            buf.push(devAddr && 0xff);
            // set FCtl. FOptsLen, FPending, ACK, ADR
            fCtrl = 2 | (0 << 4) | (1 << 5) | (0 << 7) ;
            buf.push(fCtrl);
            // set FCnt
            buf.push((fCnt >> 8) && 0xff);
            buf.push(fCnt && 0xff);
            // set FOpts. Margin(1 byte) & GwCnt(1 byte)
            hal.read(REG.PKTSNRVALUE).then(function (pktSnr) {
                margin = (255 - pktSnr + 1) / 4;
                return buf.push(margin);
            }).then(function () {
                this._gwCnt = this._gwCnt + 1;
                return buf.push(this._gwCnt);
            }).then(function () {
                // set MIC
                // [TODO] MIC generated with ?

            }).then(function () {
                // [TODO] delay?
                outputData = new Buffer(buf);
                return hal.send(outputData);
            }).nodeify(callback);
        } else if (data.cId === 0x03) {  // linkADRReq
            // data: dataRate, txPower, chMask, redundancy
            if (data.dataRate > 15 || data.dataRate < 0)
                throw new RangeError('DataRate should be in between 0 to 15 if it is a number');
            if (data.txPower > 15 || data.txPower < 0)
                throw new RangeError('TxPower should be in between 0 to 15 if it is a number');
            if (data.chMask > 65535 || data.chMask < 0)
                throw new RangeError('ChMask should be in between 0 to 65535 if it is a number');
            if (data.redundancy > 255 || data.redundancy < 0)
                throw new RangeError('Redundancy should be in between 0 to 255 if it is a number');

            var dataRate_Power,
                chMask,
                redundancy;
            // [TODO] linkADRReq
            // set MHDR. MType: confirm data down, Major: LoRaWAN R1(0)
            mhdr = 0x00 | (MType.CONFIRMDATADOWN << 5);
            buf.push(mhdr);
            // set devAddr
            buf.push((this.devAddr >> 24) && 0xff);
            buf.push((this.devAddr >> 16) && 0xff);
            buf.push((this.devAddr >> 8) && 0xff);
            buf.push(this.devAddr && 0xff);
            // set FCtl. FOptsLen, FPending, ACK, ADR
            fCtrl = 4 | (0 << 4) | (0 << 5) | (1 << 7) ;
            buf.push(fCtrl);
            // set FCnt
            buf.push((fCnt >> 8) && 0xff);
            buf.push(fCnt && 0xff);
            // set FOpts. DataRate_Power(1 byte) & ChMask(2 byte) & Redundancy(1 byte)
            dataRate_Power = data.txPower | (data.dataRate << 4);
            buf.push(dataRate_Power);
            buf.push((data.chMask) && 0xff);
            buf.push(data.chMask && 0xff);
            buf.push(data.redundancy);
            // [TODO] Redundancy: ChMaskCntl, NbTrans implement

            // set MIC
            // [TODO] MIC generated with ?
            // [TODO] delay?
            outputData = new Buffer(buf);
            return hal.send(outputData);
        } else if (data.cId === 0x04) {  // dutyCycleReq
            // data: dutyCyclePL
            if (data.dutyCyclePL > 15 || data.dutyCyclePL < 0)
                throw new RangeError('MaxDCycle should be in between 0 to 15 if it is a number');

            // var MaxDCycle;
            // [TODO] dutyCycleReq
            // set MHDR. MType: confirm data down, Major: LoRaWAN R1(0)
            mhdr = 0x00 | (MType.CONFIRMDATADOWN << 5);
            buf.push(mhdr);
            // set devAddr
            buf.push((this.devAddr >> 24) && 0xff);
            buf.push((this.devAddr >> 16) && 0xff);
            buf.push((this.devAddr >> 8) && 0xff);
            buf.push(this.devAddr && 0xff);
            // set FCtl. FOptsLen, FPending, ACK, ADR
            fCtrl = 1 | (0 << 4) | (0 << 5) | (0 << 7) ;
            buf.push(fCtrl);
            // set FCnt
            buf.push((fCnt >> 8) && 0xff);
            buf.push(fCnt && 0xff);
            // set FOpts. DutyCyclePL(1 byte): RFU, MaxDCycle
            buf.push(data.maxDCycle);
            // set MIC
            // [TODO] MIC generated with ?
            // [TODO] delay?
            outputData = new Buffer(buf);
            return hal.send(outputData);
        } else if (data.cId === 0x05) {  // rxParamSetupReq
            // data: rx1DROffset, rx2DR, frequency
            //         dlSettings
            if (data.rx1DRoffset > 7 || data.rx1DRoffset < 0)
                throw new RangeError('RX1DRoffset should be in between 0 to 7 if it is a number');
            if (data.rx2DR > 15 || data.rx2DR < 0)
                throw new RangeError('RX2DataRate should be in between 0 to 15 if it is a number');
            if (data.frequency > 16777215 || data.frequency < 0)
                throw new RangeError('DLSettings should be in between 0 to 16777215 if it is a number');

            var dlSettings;
            // [TODO] rxParamSetupReq
            // set MHDR. MType: confirm data down, Major: LoRaWAN R1(0)
            mhdr = 0x00 | (MType.CONFIRMDATADOWN << 5);
            buf.push(mhdr);
            // set devAddr
            buf.push((this.devAddr >> 24) && 0xff);
            buf.push((this.devAddr >> 16) && 0xff);
            buf.push((this.devAddr >> 8) && 0xff);
            buf.push(this.devAddr && 0xff);
            // set FCtl. FOptsLen, FPending, ACK, ADR
            fCtrl = 4 | (0 << 4) | (0 << 5) | (0 << 7) ;
            buf.push(fCtrl);
            // set FCnt
            buf.push((fCnt >> 8) && 0xff);
            buf.push(fCnt && 0xff);
            // set FOpts. DLSettings(1 byte): RFU, RX1DRoffset, RX2DataRate. Frequency(3 bytes)
            dlSettings = data.rx2DR | (data.rx1DRoffset << 4);
            buf.push(data.dlSettings);
            buf.push((data.frequency >> 16) && 0xff);
            buf.push((data.frequency >> 8) && 0xff);
            buf.push(data.frequency && 0xff);
            // set MIC
            // [TODO] MIC generated with ?
            // [TODO] delay?
            outputData = new Buffer(buf);
            return hal.send(outputData);
        } else if (data.cId === 0x06) {  // devStatusReq
            // data: none
            // [TODO] devStatusReq
            // set MHDR. MType: confirm data down, Major: LoRaWAN R1(0)
            mhdr = 0x00 | (MType.CONFIRMDATADOWN << 5);
            buf.push(mhdr);
            // set devAddr
            buf.push((this.devAddr >> 24) && 0xff);
            buf.push((this.devAddr >> 16) && 0xff);
            buf.push((this.devAddr >> 8) && 0xff);
            buf.push(this.devAddr && 0xff);
            // set FCtl. FOptsLen, FPending, ACK, ADR
            fCtrl = 0 | (0 << 4) | (0 << 5) | (0 << 7) ;
            buf.push(fCtrl);
            // set FCnt
            buf.push((fCnt >> 8) && 0xff);
            buf.push(fCnt && 0xff);
            // set FOpts.
            // set MIC
            // [TODO] MIC generated with ?
            // [TODO] delay?
            outputData = new Buffer(buf);
            return hal.send(outputData);
        } else if (data.cId === 0x07) {  // newChannelReq
            // data: chIndex, frequency, maxDataRate, MinDataRate.drRange
            // [TODO] newChannelReq
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
            buf.push(mhdr);
            // set devAddr
            buf.push((this.devAddr >> 24) && 0xff);
            buf.push((this.devAddr >> 16) && 0xff);
            buf.push((this.devAddr >> 8) && 0xff);
            buf.push(this.devAddr && 0xff);
            // set FCtl. FOptsLen, FPending, ACK, ADR
            // [TODO] check ADR is modified or not.
            fCtrl = 5 | (0 << 4) | (0 << 5) | (0 << 7) ;
            buf.push(fCtrl);
            // set FCnt
            buf.push((fCnt >> 8) && 0xff);
            buf.push(fCnt && 0xff);
            // set FOpts. ChIndex(1 byte), Frequency(3 byte), DrRange(1 byte)
            buf.push(data.chIndex);
            buf.push((data.frequency >> 16) && 0xff);
            buf.push((data.frequency >> 8) && 0xff);
            buf.push(data.frequency && 0xff);
            drRange = data.MinDataRate | (params.MaxDataRate << 4);
            buf.push(data.drRange);
            // set MIC
            // [TODO] MIC generated with ?
            // [TODO] delay?
            outputData = new Buffer(buf);
            return hal.send(outputData);
        } else if (data.cId === 0x08) {  // rxTimingSetupReq
            // data: delay(unit: second)
            // [TODO] rxTimingSetupReq
            if (data.delay > 15 || data.delay < 0)
                throw new RangeError('Delay should be in between 0 to 15 if it is a number');

        // set MHDR. MType: confirm data down, Major: LoRaWAN R1(0)
        mhdr = 0x00 | (MType.CONFIRMDATADOWN << 5);
        buf.push(mhdr);
        // set devAddr
        buf.push((this.devAddr >> 24) && 0xff);
        buf.push((this.devAddr >> 16) && 0xff);
        buf.push((this.devAddr >> 8) && 0xff);
        buf.push(this.devAddr && 0xff);
        // set FCtl. FOptsLen, FPending, ACK, ADR
        // [TODO] check ADR is modified or not.
        fCtrl = 1 | (0 << 4) | (0 << 5) | (0 << 7) ;
        buf.push(fCtrl);
        // set FCnt
        buf.push((fCnt >> 8) && 0xff);
        buf.push(fCnt && 0xff);
        // set FOpts. Settings(1 byte): RFU, Delay
        buf.push(data.delay);
        // set MIC
        // [TODO] MIC generated with ?
        // [TODO] delay?
        outputData = new Buffer(buf);
        return hal.send(outputData);
    } else if (data.cId === 0x09) {  // txParamSetupReq
        // data: downlinkDwellTime, uplinkDwellTime, maxEIRP
        // Dwell Time: 0: no limit, 1 : 400 ms
        // [TODO] txParamSetupReq
        // [TODO] downlinkDwellTime, uplinkDwellTime should be set true or false
        if (data.maxEIRP > 15 || data.maxEIRP < 0)
            throw new RangeError('MaxEIRP should be in between 0 to 15 if it is a number');

        var eirp_dwellTime;
        // set MHDR. MType: confirm data down, Major: LoRaWAN R1(0)
        mhdr = 0x00 | (MType.CONFIRMDATADOWN << 5);
        buf.push(mhdr);
        // set devAddr
        buf.push((this.devAddr >> 24) && 0xff);
        buf.push((this.devAddr >> 16) && 0xff);
        buf.push((this.devAddr >> 8) && 0xff);
        buf.push(this.devAddr && 0xff);
        // set FCtl. FOptsLen, FPending, ACK, ADR
        // [TODO] check ADR is modified or not.
        fCtrl = 1 | (0 << 4) | (0 << 5) | (0 << 7) ;
        buf.push(fCtrl);
        // set FCnt
        buf.push((fCnt >> 8) && 0xff);
        buf.push(fCnt && 0xff);
        // set FOpts. EIRP_DwellTime: MaxEIRP, uplinkDwellTime, downlinkDwellTime
        eirp_dwellTime = data.maxEIRP | (data.uplinkDwellTime << 4) | (data.dwonlinkDwellTime << 5);
        buf.push(eirp_dwellTime);
        // set MIC
        // [TODO] MIC generated with ?
        // [TODO] delay?
        outputData = new Buffer(buf);
        return hal.send(outputData);
    } else if (data.cId === 0x0a) {  // DIChannelReq
        // data: chIndex, frequency
        // [TODO] DIChannelReq
        if (data.chIndex > 255 || data.chIndex < 0)
            throw new RangeError('ChIndex should be in between 0 to 255 if it is a number');
        if (data.frequency > 16777215 || data.frequency < 0)
            throw new RangeError('Frequency should be in between 0 to 16777215 if it is a number');

        // set MHDR. MType: confirm data down, Major: LoRaWAN R1(0)
        mhdr = 0x00 | (MType.CONFIRMDATADOWN << 5);
        buf.push(mhdr);
        // set devAddr
        buf.push((this.devAddr >> 24) && 0xff);
        buf.push((this.devAddr >> 16) && 0xff);
        buf.push((this.devAddr >> 8) && 0xff);
        buf.push(this.devAddr && 0xff);
        // set FCtl. FOptsLen, FPending, ACK, ADR
        // [TODO] check ADR is modified or not.
        fCtrl = 4 | (0 << 4) | (0 << 5) | (0 << 7) ;
        buf.push(fCtrl);
        // set FCnt
        buf.push((fCnt >> 8) && 0xff);
        buf.push(fCnt && 0xff);
        // set FOpts. ChIndex(1 byte), Frequency(3 byte), DrRange(1 byte)
        buf.push(data.chIndex);
        // [TODO] frequency channel is 100 * frequency ?
        buf.push((data.frequency >> 16) && 0xff);
        buf.push((data.frequency >> 8) && 0xff);
        buf.push(data.frequency && 0xff);
        // set MIC
        // [TODO] MIC generated with ?
        // [TODO] delay?
        outputData = new Buffer(buf);
        return hal.send(outputData);
    }
    // [TODO] Class B MAC Command implement
   
};

// mqtt-shepherd use bind
// this.permitJoin = permitJoin.bind(this);
Nora.prototype.permitJoin = function(timeLeft, callback) {
    // [TODO] set timeup for join-request,
    // To understand others implement way
};

Nora.prototype.find = function(devAddr, callback) {
    var deferred = Q.defer();
    // [TODO] find devAddr in database
    this._devBox.findFromDb({devAddr: devAddr}, function (err, device) {
        if (err)
            deferred.reject(err);
        else
            deferred.resolve(device);

        return device;
    });

    return deferred.promise.nodify(callback);
};

Nora.prototype.list = function() {
    // [TODO] list all end-device information in database
    this._devBox.findFromDb({}, function (err, devList) {
        return devList;
    });
};

Nora.prototype.remove = function(devAddr, callback) {
    var deferred = Q.defer();
    // [TODO] remove information relatived devAddr & end-device instance
    this._devBox.find({devAddr: devAddr}, function (device) {
        if (device !== []) {
            this._devBox.remove(device.id, function (err) {
                if (err)
                    deferred.reject(err);
                else
                    deferred.resolve('Device remove');
            });
        } else {
            deferred.resolve('Device unexisted');
        }
    });
    return deferred.promise.nodify(callback);
    
};

/*************************************************************************************************/
/*** MAC Command Functions                                                                     ***/
/*************************************************************************************************/


/*************************************************************************************************/
/*** Private Functions                                                                         ***/
/*************************************************************************************************/
Nora.prototype._parser = function (data, callback) {

    var self = this;

    var i = 0,
        mhdrByte = data.readUInt8(i),
        MType = CNST.MType,
        phyPayload = {
            MHDR: {
                Major: (mhdrByte & 0x03),
                RFU: ((mhdrByte >> 2 ) & 0x07),
                MType: ((mhdrByte >> 5 ) & 0x07)
            },
            MACPayload: {
                FHDR: {
                    DevAddr: {},
                    FCtrl: {
                        ADR: false,
                        RFU: {},
                        // ADRACKReq: false,
                        ACK: {},
                        FPending: false,
                        FOptsLen: {}
                    },
                    FCnt: {},
                    FOpts: {}
                },
                FPort: null,
                Payload: {}
            },
            MIC: {}
        };
    i += 1;
    // [TODO] ignore downlink message(joinAccept, unconfirmed data down & confirmed data down)
    if (phyPayload.MHDR.MType === MType.JOINREQUEST) {      // join-request
        // [TODO] ABP(Activation By Personalization)
        // information: devAddr, nwkSKey, appSKey
        // OTAA
        if (data.length !== 23) {
            return Q.fcall(function () {     // data is not LoRaWAN joinRequest format
                return;
            }).nodeify(callback);
        }

        var joinInfo = {
            appEUI: {},
            devEUI: {},
            devNonce: {}
            // mic: {}
        },
        joinRecord = {
            mhdr: phyPayload.MHDR,
            appEUI: {},
            devEUI: {},
            devNonce: {}
            mic: {}
        },
        mic;

        joinRecord.appEUI = joinInfo.appEUI = data.readUIntBE(i, 8).toString(16);

        i += 8;
        joinRecord.devEUI = joinInfo.devEUI = data.readUIntBE(i, 8).toString(16);
        i += 8;
        joinRecord.devNonce = joinInfo.devNonce = data.readUInt16BE(i).toString(16);
        i += 2;
        // joinInfo.mic = data.readUIntBE(i, 4).toString(16);
        joinRecord.mic = mic = data.readUIntBE(i, 4).toString(16);
        i += 4;

        // [TODO] database check & store information devNonce?
        this._devBox.findFromDb({devNonce: joinInfo.devNonce, function (err, docs) {
            if (err)
                console.log(err);
            else {
                if (docs === []) {
                    return Q.fcall(function () {
                        // record joinInfo & mic, use array to store this information
                        this._joinBox.push(joinRecord);
                        self.emit('devIncoming', joinInfo);
                        return joinInfo;
                    }).nodeify(callback);
                } else {
                    // [TODO] return this devNonce existed, this joinReq should be ignored
                }
            }
                
                
        }});
        
    } else {        // other message type
        if (data.length < 12) {
            return Q.fcall(function () {     // data is not LoRaWAN format
                return;
            }).nodeify(callback);
        }

        var FHDR = phyPayload.MACPayload.FHDR,
            micCmac;

        FHDR.DevAddr = data.readUInt32BE(i);
        i += 4;
        // NwkID & NwkAddr
        // [TODO] check database devAddr information


        FCtrlByte = data.readUInt8(i);
        FHDR.FCtrl.FOptsLen = FCtrlByte & 0x0f;
        FHDR.FCtrl.FPending = (FCtrlByte >> 4) & 0x01;      // use in downlink
        // FHDR.FCtrl.RFU = (FCtrlByte >> 4) & 0x01;      // use in uplink
        FHDR.FCtrl.ACK = (FCtrlByte >> 5) & 0x01;
        FHDR.FCtrl.RFU = (FCtrlByte >> 6) & 0x01;           // use in downlink
        // FHDR.FCtrl.ADRACKReq = (FCtrlByte >> 6) & 0x01;  // use in uplink
        FHDR.FCtrl.ADR = (FCtrlByte >> 7) & 0x01;
        i += 1;

        FHDR.FCnt = data.readUInt16BE(i);
        i += 2;

        if (FHDR.FCtrl.FOptsLen !== 0) {
            var buf = new Buffer(FHDR.FCtrl.FOptsLen);
            for(var j = 0;j < FHDR.FCtrl.FOptsLen;j += 1) {
                buf[j] = data.readUInt8(i);
                i += 1;
            }
            FHDR.FOpts = buf;
        }

        if (data.length - i - 4 > 1) {
            phyPayload.MACPayload.FPort = data.readUInt8(i);
            i += 1;
            phyPayload.MACPayload.Payload = data.readUIntBE(i, (data.length - i - 4)).toString(16);
            i += (data.length - i - 4);
        } else {
            phyPayload.MACPayload.FPort = null;
        }

        phyPayload.MIC = data.readUIntBE(i, 4).toString(16);
        i += 4;
        return Q.fcall(function () {
            self.emit('_devData', phyPayload);
            return phyPayload;
        }).nodeify(callback);
    }
}

function _payload(info) {
    // [TODO] info is not join-request
            var FHDR = info.MACPayload.FHDR,
                FPort = info.MACPayload.FPort,
                Payload = info.MACPayload.Payload,
                payloadMic = info.MIC,
                cmac,
                mic = '',
                micCheck,
                buf = [],
                data;
            // [TODO] find devAddr on database, to se if equal to info.devAddr
            // [TODO] check mic correction
            // cmac = aes128_cmac(NwkSKey, B0 | msg)
            // MIC = cmac[0..3]
            // msg = MHDR | FHDR | FPort | FRMPayload
            // B0: 0x49 | 0x00000000 | Dir | DevAddr | FCntUp/FCntDown | 0x00 | len(msg)
            // [TODO] check FCnt(4/2 bytes)?
            mic = mic.concat((0x49).toString(16), (0x00000000).toString(16), (0x01).toString(16), FHDR.devAddr.toString(16), /*FHDR.FCnt.toString(16), */(0x00).toString(16), info.length.toString(16));
            // concat msg
            mic = mic.concat(info.MHDR.toString(16), FHDR.devAddr.torString(16), FHDR.FCtrl.toString(16), FHDR.FCnt.toString(16));
            if (FHDR.FCtrl.FOptsLen !== 0)
                mic = mic.concat(FHDR.FOpts.toString(16));
            if (FPort !== null)
                mic = mic.concat(Payload.toString(16));
            // [TODO] get nwkSKey from database
            micCheck = aesCmac(nwkSKey, mic);
            // cmac = aesCmac(nwkSKey, data);
            // check mic correction
            if (mic === payloadMic) {
                // [TODO] decrypt FRMPayload
                // FPort: 0: NwkSKey, 1~255: AppSKey
                if (FHDR.FCtrl.FOptsLen === 0) {    // FOpts not existed
                    if (FPort !== null) {
                        // Payload = info.MACPayload.Payload;
                        if (FPort === 0) {  // Payload is MAC command

                        } else {            // Payload is application data

                        }
                    } else {
                        // empty payload
                    }
                } else {    // FOpts existed, MAC Command
                    // push FOpts
                    // for (var i = 0;i < FHDR.FCtrl.FOptsLen;i += 1)
                    //     buf.push(FHDR.FOpts[i]);
                    // if (FPort !== null) {
                    //     buf.push(FPort);
                    //     for (var j = 0;j < Payload.length;j += 1)
                    //         buf.push(Payload[j]);
                    // }
                }
            } else {
                // return none
            }

}

function _micCheck() {
    // aesCmac
}

module.exports = Nora;