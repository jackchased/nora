'use strict';

var _ = require('busyman'),
    CNST = require('./constants.json'),
    lwm2mid = require('lwm2m-id');

var nutils = {};

/*************************************************************************************************/
/*** path APIs                                                                                 ***/
/*************************************************************************************************/
nutils.pathParserToArray = function (path) {
    var pathArray = path.split('/'),
        pathNumber = [];

    if (pathArray[0] === '')
        pathArray = pathArray.slice(1);
    if (pathArray[pathArray.length - 1] === '')
        pathArray = pathArray.slice(0, pathArray.length - 1);

    _.forEach(pathArray, function (val, key) {
        if (key === 0)  // object id
            val = lwm2mid.getOid(val);
        else if (key === 2) // resource id
            val = lwm2mid.getRid(val);
        pathNumber.push(val);
    });

    return pathArray;
}
/*************************************************************************************************/
/*** LoRaWAN APIs                                                                              ***/
/*************************************************************************************************/
// It is for normal data, not for join-request/join-accept message
nutils.generateMic = function (device, data, dir) {
    if (!_.isBuffer(data))
        throw new TypeError('data should be a buffer.');
    var msg = '';
    // cmac = aes128_cmac(NwkSKey, B0 | msg)
    // MIC = cmac[0..3]
    // msg = MHDR | FHDR | FPort | FRMPayload
    // B0: 0x49 | 0x00000000 | Dir | DevAddr | FCntUp/FCntDown | 0x00 | len(msg)
    // Dir: 0: uplink, 1: downlink
    // [TODO] check FCnt(4/2 bytes)?
    msg = msg.concat((0x49).toString(16), (0x00000000).toString(16), (dir).toString(16));
    // devAddr
    for (var i = 0;i < 4;i += 1)
        msg = msg.concat(((device.devAddr >> (8 * i)) & 0xff).toString(16));
    // FCnt(up/down)
    for (var i = 0;i < 4;i += 1)
        msg = msg.concat(((device.count >> (8 * i)) & 0xff).toString(16));
    msg = msg.concat((0x00.toString(16)), data.length.toString(16));
    // concat msg
    // mhdr & fhdr & fport & frmPayload
    for (var i = 0;i < data.length;i += 1)
        msg = msg.concat(data[i]);
    nwkSKey = device.nwkSKey;
    cmac = aesCmac(nwkSKey, msg);
    for (var i = 3;i > -1;i -= 1)
        data.push(parseInt(cmac[i * 2] + cmac[i * 2 + 1], 16));

    return data;
}

// To encrypt/decrypt FRMPayload
nutils.frmPayloadcrypto = function (device, data, key) {
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
        seq = buf.concat((0x01).toString(16), (0x00000000).toString(16), (0x00).toString(16), device.devAddr.toString(16), device.count.toString(16), (0x00).toString(16), i.toString(16));
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

// LoRaWAN
nutils.parser = function (data) {
    // [TODO] according to header mode(implicit, explicit), beacon is in implicit mode
    var self = this,
        deferred = Q.defer();

    var i = 0,
        mhdrByte = data.readUInt8(i),
        mType = CNST.MType,
        phyPayload = {
            mhdrByte: mhdrByte,
            phyPayloadLength: data.length,
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

    if (phyPayload.mhdr.mType === mType.JOINREQUEST) {  // join-request
        // OTAA join-procedure
        if (data.length !== 23) {
            return;
        }

        var info = {
                mhdrByte: mhdrByte,
                mhdr: phyPayload.mhdr,
                appEUI: {},
                devEUI: {},
                devNonce: {},
                mic: {}
            },
            micCheck = '',
            joinMic = '';

        info.appEUI = data.readUIntLE(i, 8);
        i += 8;
        info.devEUI = data.readUIntLE(i, 8);
        i += 8;
        info.devNonce = data.readUInt16LE(i);
        i += 2;
        info.mic = data.readUIntLE(i, 4).toString(16);
        i += 4;

        return info;
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
            Payload = data.readUInt(i, (data.length - i - 4));
            i += (data.length - i - 4);
        } else {
            FPort = null;
        }

        Mic = data.readUIntLE(i, 4);
        i += 4;

        return phyPayload;
    }
}

nutils.checkMicAndDecryptPayload = function (nora, data, callback) {
    var deferred = Q.defer(),
        joinMic = '',
        micCheck = '';

    if (data.mhdr.mType === CNST.MType.JOINREQUEST) {
        return Q.fcall(function () {
            // search devNonce in database(objectbox)
            nora._devBox.findFromDb({devNonce: devNonce}, function (err, dev) {    // dev is array
                if (err)
                    deferred.reject(err);
                else
                    return dev;
            });
        }).then(function (dev) {
            if (dev.length === 0) { // devNonce do not exist in database
                // search OTAA register box
                nora._regBox.find(function (otaaRegData) {
                    return otaaRegData;
                });
            }
        }).then(function (otaaRegData) {
            if ((data.devEUI === otaaRegData.devEUI) & (data.appEUI === otaaRegData.appEUI)) {  // check devEUI & appEUI
                // Generate & check MIC
                // cmac = aes128_cmac(AppKey, MHDR | AppEUI | DevEUI | DevNonce)
                // MIC = cmac[0..3]
                joinMic = joinMic.concat(data.mhdrByte.toString(16), data.appEUI.toString(16), data.devEUI.toString(16), data.devNonce.toString(16));
                joinMic = aesCmac(otaaRegData.appKey, joinMic);
                micCheck = micCheck.concat(joinMic[0], joinMic[1], joinMic[2], joinMic[3], joinMic[4], joinMic[5], joinMic[6], joinMic[7]);
                if (data.mic === micCheck) {    // MIC correct
                    // OTAA join-procedure
                    // add devNonce & mhdr to joinData
                    otaaRegData.mhdr = data.mhdr;
                    otaaRegData.devNonce = data.devNonce;
                    return otaaRegData;
                } else {
                    return null;
                }
            } else {
                return null;
            }
        }).then(function (otaaRegData) {
            if (otaaRegData) {
                // add to prepare-join-list
                nora._joinBox.push(otaaRegData);
                // [TODO] if end-device do not receive joinAccept message?
                // [TODO] delay rxDelay? send joinAccept message
                nora._joinAccept(otaaRegData.devEUI, otaaRegData, otaaRegData.appKey, function (err) {
                    if (err)
                        deferred.reject(err);
                });
            }
        }).done();
    } else {    // other message type
        var FHDR = data.macPayload.fhdr,
            FPort = data.macPayload.fPort,
            Payload = data.macPayload.payload,
            Mic = data.mic,
            cmac;

        return Q.fcall(function () {
            // check join procedure
            nora._joinBox.find(function (joinData) {
                return joinData;
            });
        }).then(function (joinBoxData) {
            var end_device,
                len = -1;
            if (joinBoxData.devAddr === FHDR.devAddr) {
                // create end-device instance
                end_device = new NoraEndDevice(nora, joinBoxData);
                len = nora._joinBox.indexOf(joinBoxData);
                if (len > -1)
                    nora._joinBox.splice(len, 1);   // delete this joinData content
                len = nora._regBox.indexOf(joinBoxData);
                if (len > -1)
                    nora._regBox.splice(len, 1);   // delete this regData content
            } else {
                // search devAddr in database(objectbox)
                end_device = nora.find(FHDR.devAddr);
                if (!end_device)
                    deferred.reject('End-device 0x' + FHDR.devAddr + ' does not exist.');
            }
            return end_device;
        }).then(function (device) {
            // Generate  & check MIC
            // cmac = aes128_cmac(NwkSKey, B0 | msg)
            // MIC = cmac[0..3]
            // msg = MHDR | FHDR | FPort | FRMPayload
            // B0: 0x49 | 0x00000000 | Dir | DevAddr | FCntUp/FCntDown | 0x00 | len(msg)
            var msg = '',
                mic = '';

            if (device) {
                // devAddr
                for (var i = 0;i < 4;i += 1)
                    msg = msg.concat(((FHDR.devAddr >> (8 * i)) & 0xff).toString(16));
                // FCnt(up/down)
                for (var i = 0;i < 4;i += 1)
                    msg = msg.concat(((FHDR.fCnt >> (8 * i)) & 0xff).toString(16));
                msg = msg.concat((0x00.toString(16)), (data.phyPayload.length - 4).toString(16));
                // concat msg
                msg = msg.concat(data.mhdrByte.toString(16));
                // devAddr
                for (var i = 0;i < 4;i += 1)
                    msg = msg.concat(((FHDR.devAddr >> (8 * i)) & 0xff).toString(16));
                // FCtrl
                msg = msg.concat(FHDR.fCtrl.toString(16));
                // FCnt(up/down)
                for (var i = 0;i < 4;i += 1)
                    msg = msg.concat(((FHDR.fCnt >> (8 * i)) & 0xff).toString(16));
                if (FHDR.fCtrl.fOptsLen !== 0)
                    msg = msg.concat(FHDR.fOpts.toString(16));
                if (FPort !== null)
                    msg = msg.concat(FPort.toString(16), Payload.toString(16));
                cmac = aesCmac(device.info.nwkSKey, msg);
                mic = mic.concat(cmac[0], cmac[1], cmac[2], cmac[3], cmac[4], cmac[5], cmac[6], cmac[7]);
            } else
                mic = null;
            // check mic correction
            if (mic === Mic) {
                if ((device.count + 1) === FHDR.fCnt) // check frame counter, fix counter
                    device.count = FHDR.fCnt;
                // [TODO] if count > 0xffffffff?
                return device;
            } else {
                return null;
            }
        }).then(function (device) {
            // decrypt FRMPayload
            if (device) {
                if (FPort === null) {
                    // empty payload
                    // deferred.resolve(null);
                } else if (FPort === 0x00) {  // Payload is MAC command
                    // decrypt FRMPayload
                    Payload = nutils.frmPayloadcrypto(device, Payload, device.nwkSKey);
                } else {    // Payload is application data, [TODO] use different interface? lwm2m...
                    Payload = nutils.frmPayloadcrypto(device, Payload, device.appSKey);
                }
                data.macPayload.payload = Payload;
                deferred.resolve(data);
            }
        }).done();
    }
    return deferred.nodeify.promise(callback);
}

nutils.divideEvent = function (self, data) {
    var FHDR = data.macPayload.fhdr,
        FPort = data.macPayload.fPort,
        Payload = data.macPayload.payload,
        cmd = '',
        data,
        j = 0,
        eventName;

    if (FHDR.fCtrl.fOptsLen === 0) {    // FOpts not existed
        if (FPort === null) {
            // empty payload
        } else if (FPort === 0x00) {  // Payload is MAC command
            // [TODO] Payload need to decrease Payload[0]
            var cmdId = Payload.readUInt8(j);
            j += 1;
            eventName = 'macCmd';
            switch(cmdId) {
                case 2:  // 0x02
                    cmd = 'linkCheckReq';
                break;
                case 3:  // 0x03
                    cmd = 'linkAdrAns';
                break;
                case 4:  // 0x04
                    cmd = 'dutyCycleAns';
                break;
                case 5:  // 0x05
                    cmd = 'rxParamSetupAns';
                break;
                case 6:  // 0x06
                    cmd = 'devStatusAns';
                break;
                case 7:  // 0x07
                    cmd = 'newChannelAns';
                break;
                case 8:  // 0x08
                    cmd = 'rxTimingSetupAns';
                break;
                case 9:  // 0x09
                    cmd = 'txParamSetupAns';
                break;
                case 10: // 0x0a
                    cmd = 'diChannelAns';
                break;
            }
        } else {    // Payload is application data
            // [TODO] fire event with different FPort(example: bootstrapReq, readRsp, ...)
            // event: 'register'. devIncoming should be fire after device registered successful.
            // register info: devAddr, lifetime, lwm2m version, objects & object instances [MUST], binding mode, SMS number [OPTIONAL]
            // update info: lifetime binding mode SMS number objects & object instances [OPTIONAL]
            // de-register info: none
            // notify info: update value [MUST]
            // data format & [TODO] message continue or not?(need to be queued)
            // [TODO] according to data format, payload need to be parsed to different format
            var dataFormat = Payload.readUInt8(j);
            j += 1;
            eventName = 'lwm2mCmd';
            if ((dataFormat & 0x30) === 0x30) { // JSON format
                for (i = 1;i < Payload.length - 1;i += 1) {
                    Payload[i] = Payload[i].toString();
                    msg = msg.concat(String.fromCharCode(Payload[i]));
                }
                Payload = JSON.parse(msg);
            }
            switch(FPort) {
                case 1:  // 0x01
                    cmd = 'bootstrapReq';
                break;
                case 2:  // 0x02
                    cmd = 'bootstrapFinishRsp';
                break;
                case 3:  // 0x03
                    cmd = 'bootstrapWriteRsp';
                break;
                case 4:  // 0x04
                    cmd = 'bootstrapDiscoverRsp';
                break;
                case 5:  // 0x05
                    cmd = 'bootstrapDeleteRsp';
                break;
                case 6:  // 0x06
                    cmd = 'register';
                break;
                case 7:  // 0x07
                    cmd = 'update';
                break;
                case 8:  // 0x08
                    cmd = 'deregister';
                break;
                case 9:  // 0x09
                    cmd = 'readRsp';
                break;
                case 10: // 0x0a
                    cmd = 'writeRsp';
                break;
                case 11: // 0x0b
                    cmd = 'executeRsp';
                break;
                case 12: // 0x0c
                    cmd = 'createRsp';
                break;
                case 13: // 0x0d
                    cmd = 'deleteRsp';
                break;
                case 14: // 0x0e
                    cmd = 'discoverRsp';
                break;
                case 15: // 0x0f
                    cmd = 'writeAttrsRsp';
                break;
                case 16: // 0x10
                    cmd = 'observationRsp';
                break;
                case 17: // 0x11
                    cmd = 'cancelObervationRsp';
                break;
                case 18: // 0x12
                    cmd = 'notify';
                break;
            }
       }
    } else {    // FOpts existed, MAC Command
        var cmdId = Payload.readUInt8(j);
        j += 1;
        eventName = 'macCmd';
        switch(cmdId) {
            case 2:  // 0x02
                cmd = 'linkCheckReq';
            break;
            case 3:  // 0x03
                cmd = 'linkAdrAns';
            break;
            case 4:  // 0x04
                cmd = 'dutyCycleAns';
            break;
            case 5:  // 0x05
                cmd = 'rxParamSetupAns';
            break;
            case 6:  // 0x06
                cmd = 'devStatusAns';
            break;
            case 7:  // 0x07
                cmd = 'newChannelAns';
            break;
            case 8:  // 0x08
                cmd = 'rxTimingSetupAns';
            break;
            case 9:  // 0x09
                cmd = 'txParamSetupAns';
            break;
            case 10: // 0x0a
                cmd = 'diChannelAns';
            break;
        }
    }
    setImmediate(function () {
        // [TODO] according to different cmdId, display different data contructor
        self.emit(eventName, { devAddr: FHDR.devAddr, cmd: cmd, data: data });
    });
}

if (FHDR.fCtrl.fOptsLen === 0) {    // FOpts not existed
                if (FPort === null) {
                    // empty payload
                    deferred.resolve(null);
                } else if (FPort === 0x00) {  // Payload is MAC command
                    // decrypt FRMPayload
                    Payload = nutils.frmPayloadcrypto(end_device, Payload, end_device.nwkSKey);
                    if (Payload[0] === 0x02)    // automatic response linkCheckAns(cmdId:0x02)
                        nora.macReq(FHDR.devAddr, 0x02);
                    // [TODO] Class B MAC command
                    else if (Payload[0] === 0x10)   // pingSlotInfoAns
                        nora.macReq(FHDR.devAddr, 0x10);
                    else if (Payload[0] === 0x12)   // beaconTimingAns
                        nora.macReq(FHDR.devAddr, 0x12);
                } else {    // Payload is application data, [TODO] use different interface? lwm2m...
                    // decrypt FRMPayload
                    // [TODO] fire event with different FPort(example: bootstrapReq, readRsp, ...)
                    // event: 'register'. devIncoming should be fire after device registered successful.
                    // register info: devAddr, lifetime, lwm2m version, objects & object instances [MUST], binding mode, SMS number [OPTIONAL]
                    // update info: lifetime binding mode SMS number objects & object instances [OPTIONAL]
                    // de-register info: none
                    // notify info: update value [MUST]
                    var j = 0,
                        msg = '',
                        dataFormat;
                        event = '',
                    Payload = nutils.frmPayloadcrypto(end_device, Payload, end_device.appSKey);
                    // data format & [TODO] message continue or not?(need to be queued)
                    dataFormat = Payload.readUInt8(j);
                    j += 1;
                    // data format transfer
                    if ((dataFormat & 0x30) === 0x30) { // JSON format
                        for (i = 1;i < Payload.length - 1;i += 1) {
                            Payload[i] = Payload[i].toString();
                            msg = msg.concat(String.fromCharCode(Payload[i]));
                        }
                        Payload = JSON.parse(msg);
                    }


                    if (FPort === 0x01) {   // bootstrap request
                        // [TODO] 
                    } else if (FPort === 0x02) {    // bootstrap finish
                        // [TODO] 
                    } else if (FPort === 0x03) {    // bootstrap write
                        // [TODO] 
                    } else if (FPort === 0x04) {    // bootstrap discover
                        // [TODO] 
                    } else if (FPort === 0x05) {    // bootstrap delete
                        // [TODO] 
                    } else if (FPort === 0x06) {    // register
                        // devAddr, lifetime, lwm2m version, objList. (add in future: binding mode, sms number)
                        // fire register?{data: {devAddr: , lifetime: , version: , objList: }}
                        event = 'register';
                        // [TODO] response register command
                        var buf = [];
                        // MType: unconfirm data down
                        buf.push(0x60);
                        for (var i = 0;i < 4;i += 1)
                            buf.push((end_device.info.devAddr >> (8 * i) & 0xff));
                        // fctrl
                        buf.push(0x20);
                        buf.push(device.count & 0xff);
                        buf.push((device.count >> 8) & 0xff);
                        buf.push(0x06);
                        // frmPayload: none?
                        // generate mic
                        buf = nutils.generateMic(device, buf, 1);
                        return Q.fcall(function () {
                            hal.send(buf);
                        }).then(function () {
                            self.emit('devIncoming', end_device);
                        }).done();
                    } else if (FPort === 0x07) {    // update
                        // lifetime, binding mode, sms number, objList
                        event = 'update';
                    } else if (FPort === 0x08) {    // de-register
                        event = 'de_register';
                        // [TODO] response de-register command
                        nora.remove(end_device.info.devAddr);
                    } else if (FPort === 0x09) {    // read response
                        event = 'readRsp';
                    } else if (FPort === 0x0a) {    // write response
                        event = 'writeRsp';
                    } else if (FPort === 0x0b) {    // execute response
                        event = 'executeRsp';
                    } else if (FPort === 0x0c) {    // create response
                        event = 'createRsp';
                    } else if (FPort === 0x0d) {    // delete response
                        event = 'deleteRsp';
                    } else if (FPort === 0x0e) {    // discover response
                        event = 'discoverRsp';
                    } else if (FPort === 0x0f) {    // write-attributes response
                        event = 'writeAttrsRsp';
                    } else if (FPort === 0x10) {    // observation response
                        event = 'observeRsp';
                    } else if (FPort === 0x11) {    // cancel observation response
                        event = 'cObserveRsp';
                    } else if (FPort === 0x12) {    // notify
                        event = 'notify';
                    }
                    // this.emit(event, Payload);
                }
            } else {    // FOpts existed, MAC Command
                if (FHDR.fOpts[0] === 0x02)    // automatic response linkCheckAns(cmdId:0x02)
                    nora.macReq(FHDR.devAddr, 0x02);
                // [TODO] Class B MAC command
            }

module.exports = nutils;