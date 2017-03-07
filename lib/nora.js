var Nora_hal = require('./nora-hal.js'),
    NoraEndDevice = require('./nora-end-device.js'),
    _ = require('busyman'),
    util = require('util'),
    aesCmac = require('node-aes-cmac').aesCmac,
    EventEmitter = require('events').EventEmitter,
    Q = require('q');

var CNST = require('./constants.json');

var hal = new Nora_hal();


function Nora() {
    var self = this;

    // members:
    //  this._state

    // Event: ready, ind, error
    hal.on('data', function (data) {
        self._parser(data).then(function (info) {
            var FHDR = info.MACPayload.FHDR,
                FPort = info.MACPayload.FPort,
                Payload = info.MACPayload.Payload,
                cmac,
                buf = [],
                data;
            // [TODO] find devAddr on database, to se if equal to info.devAddr
            // [TODO] check mic correction
            // get nwkSKey from database
            buf.push(0x49);
            for (var i = 0;i < 4;i += 1)
                buf.push(0x00);
            buf.push(1); // 0: uplink, 1: downlink
            buf.push((FHDR.devAddr >> 24) && 0xff);
            buf.push((FHDR.devAddr >> 16) && 0xff);
            buf.push((FHDR.devAddr >> 8) && 0xff);
            buf.push(FHDR.devAddr && 0xff);
            // [TODO] check FCnt(4/2 bytes) ?
            buf.push();

            buf.push(0x00);
            buf.push((info.MHDR.length + FHDR.length + FPort.length + Payload.length));
            // [TODO] push MHDR | FHDR | FPort | FRMPayload
            buf.push();
            cmac = aesCmac(nwkSKey, data);
            if (FHDR.FCtrl.FOptsLen === 0) {
                if (FPort !== null) {
                    // Payload = info.MACPayload.Payload;
                    if (FPort === 0) {  // Payload is MAC command

                    } else {            // Payload is application data

                    }
                } else {
                    // empty payload
                }
            }
            // get appSKey/nwkSKey
            // var cmac = aesCmac();
            // [TODO] judge mac command or application command
            self.on('_devData', function (devData) {

            });
        });
    });
}

util.inherits(Nora, EventEmitter);

Nora.prototype.joinAccept = function (devEUI, config, appKey, callback) {
    // [TODO] how to get appEUI & devNonce ?
    // record joinReq information
    // if record have joinAccept's devEUI, send response & record end-device information
    // after record information, delete information on the record
    // automatic clear record every ? time ? or use permitJoin to set join time ?
    var settings = {
        devEUI: devEUI,
        // appEUI: , // get from joinReq
        // devNonce: , // get from joinReq
        appKey: appKey,
        appNonce: config.appNonce,
        netId: config.netId,
        devAddr: config.devAddr
    },
    end_device;
    // joinAccept infomation: appEUI(8 bytes), devEUI(8 bytes), devNonce(2 bytes)
    // info: appNonce(3 bytes), netId(3 bytes), devAddr(4 bytes), dlSettings(1 byte), rxDelay(1 byte), cfList(16 bytes, optional)
    // [TODO] check MIC
    // cmac = aes128_cmac(AppKey, MHDR | AppNonce | NetID | DevAddr | DLSettings | RxDelay | CFList)
    // MIC = cmac[0..3]
    // check all & create new nora-end-device
    end_device = new NoraEndDevice(settings);
    // end-device store in noraDatabase?
    // [TODO] assign devAddr, generate AppSKey & NwkSKey
    // [TODO] store infomation in database
    // [TODO] send

    return end_device;
};

Nora.prototype.start = function(callback) {
    return hal.srart();
};

Nora.prototype.stop = function(callback) {
    return hal.idle();
};

// Nora.prototype.reset = function(callback) {

// };

Nora.prototype.find = function(devAddr, callback) {
    // [TODO] find devAddr in database
};

Nora.prototype.list = function(callback) {
    // [TODO] list all end-device information in database
};

Nora.prototype.remove = function(devAddr, callback) {
    // [TODO] remove information relatived devAddr & end-device instance
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
                FPort: {},
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
        mic;

        joinInfo.appEUI = data.readUIntBE(i, 8).toString(16);
        i += 8;
        joinInfo.devEUI = data.readUIntBE(i, 8).toString(16);
        i += 8;
        joinInfo.devNonce = data.readUInt16BE(i).toString(16);
        i += 2;
        // joinInfo.mic = data.readUIntBE(i, 4).toString(16);
        mic = data.readUIntBE(i, 4).toString(16);
        i += 4;

        // [TODO] database check & store information devNonce?
        return Q.fcall(function () {
            // [TODO] record joinInfo & mic
            self.emit('joinReq', joinInfo);
            return joinInfo;
        }).nodeify(callback);
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
        // [TODO] check MIC
        // cmac = aes128_cmac(NwkSKey, B0 | MHDR | FHDR | FPort | FRMPayload)
        // micCmac = cmac[0..3]
        // micCmac = aesCmac();
        // if (phyPayload.MIC === micCmac) {
            return Q.fcall(function () {
                // self.emit('devData', FHDR);
                // return FHDR;
                // only emit payload?
                self.emit('_devData', phyPayload);
                return phyPayload;
            }).nodeify(callback);
        // } else {
            // return; // do nothing
        // }
        
    }
}

function dealWithData(FHDR) {
    // var data = data.FHDR;
    if (FHDR.FCtrl.FOptsLen !== 0) {
        // deal with mac command
        // FHDR.FOpts
    } else {

    }
}

function _micCheck() {
    // aesCmac
}

module.exports = Nora;