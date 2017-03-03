var Nora_hal = require('./nora-hal.js'),
    _ = require('busyman'),
    util = require('util'),
    aesCmac = require('node-aes-cmac').aesCmac,
    EventEmitter = require('events').EventEmitter,
    Q = require('q');

var hal = new Nora_hal();


function Nora() {
    var self = this;

    // members:
    //  

    hal.on('data', function (data) {
        self._parser(data).then(function (info) {
            // [TODO] judge mac command or application command
            self.on('devData', function (devData) {

            });
        });
    });
}


Nora.prototype.joinAccept = function (info, appKey) {

}

Nora.prototype.start = function() {

};

Nora.prototype.stop = function() {

};

Nora.prototype.reset = function() {

};

// Nora.prototype.macCmd = function(cId, params) {

// };


/*************************************************************************************************/
/*** MAC Command Functions                                                                     ***/
/*************************************************************************************************/


/*************************************************************************************************/
/*** Private Functions                                                                         ***/
/*************************************************************************************************/
function _parser(data, callback) {

    var i = 0,
        mhdrByte = data.readUInt8(i);
        MHDR = {
            Major: (mhdrByte & 0x03),
            RFU: ((mhdrByte >> 2 ) & 0x07),
            MType: ((mhdrByte >> 5 ) & 0x07)
        };
    i += 1;

    if (MHDR.MType === MType.JOINREQUEST) {
        if (data.length !== 23)
            return;     // data is not LoRaWAN joinRequest format

        var joinInfo = {
            appEUI: {},
            devEUI: {},
            devNonce: {}
            mic: {}
        };
        // mic = {};

        joinInfo.appEUI = data.readUIntBE(i, 8).toString(16);
        i += 8;
        joinInfo.devEUI = data.readUIntBE(i, 8).toString(16);
        i += 8;
        joinInfo.devNonce = data.readUInt16BE(i).toString(16);
        i += 2;
        joinInfo.mic = data.readUIntBE(i, 4).toString(16);
        i += 4;
        // [TODO] check infomation correction or not ?
        // [TODO] database check & store information
        return Q.fcall(function () {
            self.emit('joinReq', joinInfo);
            return joinInfo;
        }).nodeify(callback);
        // macCmd.linkCheckAns(setting.appNonce, setting.netId, setting.devAddr, setting.dlSettings, setting.rxDelay, setting.cFList);
    } else {
        if (data.length < 12)
            return;     // data is not LoRaWAN format

        var FHDR = {
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
            FOpts: {},
            FPort: {},
            Payload: {},
            MIC: {}
        };

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
            FHDR.FPort = data.readUInt8(i);
            i += 1;
            FHDR.Payload = data.readUIntBE(i, (data.length - i - 4)).toString(16);
            i += (data.length - i - 4);
        }

        FHDR.MIC = data.readUIntBE(i, 4).toString(16);
        i += 4;

        return Q.fcall(function () {
            self.emit('devData', FHDR);
            return FHDR;
        }).nodeify(callback);
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