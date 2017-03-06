var Nora_hal = require('./nora-hal.js'),
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
    //  

    // Event: joinReq, 
    hal.on('data', function (data) {
        self._parser(data).then(function (info) {
            // [TODO] judge mac command or application command
            self.on('_devData', function (devData) {

            });
        });
    });
}

util.inherits(Nora, EventEmitter);

Nora.prototype.joinAccept = function (info, appKey) {
    // [TODO] check MIC
    // cmac = aes128_cmac(AppKey, MHDR | AppNonce | NetID | DevAddr | DLSettings | RxDelay | CFList)
    // MIC = cmac[0..3]
    // [TODO] assign devAddr, generate AppSKey & NwkSKey
    // [TODO] store infomation in database
    // [TODO] send 
};

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

    if (phyPayload.MHDR.MType === MType.JOINREQUEST) {
        if (data.length !== 23)
            return;     // data is not LoRaWAN joinRequest format

        var joinInfo = {
            appEUI: {},
            devEUI: {},
            devNonce: {},
            mic: {}
        };

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
        }

        phyPayload.MIC = data.readUIntBE(i, 4).toString(16);
        i += 4;
        // [TODO] check MIC
        // cmac = aes128_cmac(NwkSKey, B0 | MHDR | FHDR | FPort | FRMPayload)
        // micCmac = cmac[0..3]
        // micCmac = aesCmac();
        if (phyPayload.MIC === micCmac) {
            return Q.fcall(function () {
                // self.emit('devData', FHDR);
                // return FHDR;
                self.emit('_devData', phyPayload);
                return phyPayload;
            }).nodeify(callback);
        } else {
            return; // do nothing
        }
        
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