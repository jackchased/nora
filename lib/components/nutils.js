'use strict';

var _ = require('busyman'),
    NoraEndDevice = require('../nora-end-device.js'),
    Q = require('q'),
    aesCmac = require('node-aes-cmac').aesCmac,
    CNST = require('../constants.json'),
    lwm2mId = require('lwm2m-id');

var nutils = {};

/*************************************************************************************************/
/*** path APIs                                                                                 ***/
/*************************************************************************************************/
nutils.pathParserToArray = function (path) {    // example: /8/6/4
    var pathArray = path.split('/'),
        pathNumber = [];

    if (pathArray[0] === '')
        pathArray = pathArray.slice(1);
    if (pathArray[pathArray.length - 1] === '')
        pathArray = pathArray.slice(0, pathArray.length - 1);

    _.forEach(pathArray, function (val, key) {
        if (key === 0)  // object id
            val = lwm2mId.getOid(val);
        else if (key === 2) // resource id
            val = lwm2mId.getRid(val);
        pathNumber.push(val);
    });

    return pathArray;
}

nutils.pathDataType = function (path) {
    var pathArray = this.pathParserToArray(path),
        dataType = [ 'so', 'object', 'instance', 'resource' ][pathArray.length];
    return dataType;
}

nutils.ridKey = function (oid, rid) {
    var ridItem = lwm2mId.getRid(oid, rid);

    if (_.isUndefined(rid))
        rid = oid;

    return ridItem ? ridItem.key : rid;
}

nutils.oidKey = function (oid) {
    var oidItem = lwm2mId.getOid(oid);

    return oidItem ? oidItem.key : oid;
};

nutils.turnSoToObj = function (path) {
    var pathArray = this.pathParserToArray(path),
        pathObj = {},
        oid,
        rid;

    if (pathArray[0]) { // oid
        oid = this.oidKey(pathArray[0]);
        pathObj.oid = oid;
    }

    if (pathArray[1])   // iid
        pathObj.iid = pathArray[1];

    if (pathArray[2]) { // rid
        rid = this.ridKey(oid, pathArray[2]);
        pathObj.rid = rid;
    }

    return pathObj;
}

nutils.createPath = function () {
    var connector = arguments[0],
        path = '';

    proving.string(connector, 'arguments[0] should be a string.');

    _.forEach(arguments, function (arg, i) {
        if (i > 0) path = path + arg + connector;
    });

    if (path[path.length-1] === connector)           
        path = path.slice(0, path.length-1);

    return path;
};

nutils.invalidPathOfTarget = function (target, objToUpdata) {
    var invalidPath = [];

    _.forEach(objToUpdata, function (n, p) {
        if (!_.has(target, p)) {
            invalidPath.push(p);
        }
    });

    return invalidPath;
};

nutils.buildPathValuePairs = function (rootPath, obj) {
    var result = {};

    rootPath = nutils.dotPath(rootPath);

    if (_.isObject(obj)) {
        if (rootPath !== '' && rootPath !== '.' && rootPath !== '/' && !_.isUndefined(rootPath))
            rootPath = rootPath + '.';

        _.forEach(obj, function (n, key) {
            // Tricky: objList is an array, don't buid its full path, or updating new list will fail
            if (_.isObject(n) && key !== 'objList')
                _.assign(result, nutils.buildPathValuePairs(rootPath + key, n));
            else
                result[rootPath + key] = n;
        });
    } else {
        result[rootPath] = obj;
    }

    return result;
};

nutils.objectInstanceDiff = function (oldInst, newInst) {
    var badPath = nutils.invalidPathOfTarget(oldInst, newInst);

    if (badPath.length !== 0)
        throw new Error('No such property ' + badPath[0] + ' in targeting object instance.');
    else
        return nutils.objectDiff(oldInst, newInst);
};

nutils.resourceDiff = function (oldVal, newVal) {
    var badPath;

    if (typeof oldVal !== typeof newVal) {
        return newVal;
    } else if (_.isPlainObject(oldVal)) {
        // object diff
        badPath = nutils.invalidPathOfTarget(oldVal, newVal);
        if (badPath.length !== 0) {
            _.forEach(badPath, function (p) {
                _.unset(newVal, p);    // kill bad property, they will not be updated
            });
        }

        return nutils.objectDiff(oldVal, newVal);
    } else if (oldVal !== newVal) {
        return newVal;
    } else {
        return null;
    }
};

nutils.objectDiff = function (oldObj, newObj) {
    var pvp = nutils.buildPathValuePairs('/', newObj),
        diff = {};

    _.forEach(pvp, function (val, path) {
        if (!_.has(oldObj, path) || _.get(oldObj, path) !== val)
            _.set(diff, path, val);
    });

    return diff;
};

nutils.resourceDiff = function (oldVal, newVal) {
    var badPath;

    if (typeof oldVal !== typeof newVal) {
        return newVal;
    } else if (_.isPlainObject(oldVal)) {
        // object diff
        badPath = nutils.invalidPathOfTarget(oldVal, newVal);
        if (badPath.length !== 0)
            throw new Error('No such property ' + badPath[0] + ' in targeting object.');
        else
            return nutils.objectDiff(oldVal, newVal);
    } else if (oldVal !== newVal) {
        return newVal;
    } else {
        return null;
    }
};
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
nutils.frmPayloadcrypto = function (noraED, data, key) {
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
        seq = buf.concat((0x01).toString(16), (0x00000000).toString(16), (0x00).toString(16), noraED.devAddr.toString(16), noraED.count.toString(16), (0x00).toString(16), i.toString(16));
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

nutils.devAttrsDiff = function (noraED, attrs) {
    // { devAddr, lifetime(opt), version(opt), objList(opt) }
    var diff = {};

    _.forEach(attrs, function (val, key) {
        var oList,
            isObjListDiff = false;

        if (!_.has(noraED, key))  // just ignore, no need to throw
            return;

        if (key === 'objList') {
            oList = val;

            _.forEach(oList, function (iids, oid) {
                var nodeIids = _.get(noraED.objList, oid);

                if (!nodeIids)
                    isObjListDiff = true;
                else if (!_.isEqual(iids.sort(), nodeIids.sort()))
                    isObjListDiff = true;
            });

            if (isObjListDiff)
                diff.objList = val;

        } else if (noraED[key] !== val) {
             diff[key] = val;
        }
    });

    return diff;
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
            Payload = phyPayload.macPayload.payload,
            Mic = phyPayload.mic,
            FCtrlByte;

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
            Payload = data.readUIntBE(i, (data.length - i - 4));
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

    function decryptPayload(device) {
        // decrypt FRMPayload
        if (device) {
            if (FPort === null) {
                // empty payload
                // deferred.resolve(null);
            } else if (FPort === 0x00) {  // Payload is MAC command
                // decrypt FRMPayload
                Payload = nutils.frmPayloadcrypto(device, Payload, device.info.nwkSKey);
            } else {    // Payload is application data, [TODO] use different interface? lwm2m...
                Payload = nutils.frmPayloadcrypto(device, Payload, device.info.appSKey);
            }
            data.macPayload.payload = Payload;
            deferred.resolve(data);
        }
        return deferred.promise.nodeify(callback);
    }

    function checkDevEUIAndAppEUI(otaaRegData) {
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
                // return otaaRegData;
            } else {
                otaaRegData = null;
            }
        } else {
            otaaRegData = null;
        }

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
        return deferred.promise.nodeify(callback);
    }

    function checkMic(device) {
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
            msg = msg.concat((0x00.toString(16)), (data.phyPayloadLength - 4).toString(16));
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
            decryptPayload(device);
        } else {
        }
    }

    if (data.mhdr.mType === CNST.MType.JOINREQUEST) {
        // search devNonce in database(objectbox)
        nora._devBox.findFromDb({devNonce: data.devNonce}, function (err, dev) {    // dev is array
            if (dev.length === 0) { // devNonce do not exist in database
                // search OTAA register box
                nora._regBox.find(function (otaaRegData) {
                    checkDevEUIAndAppEUI(otaaRegData);
                });
            }
        });
    } else {    // other message type
        var FHDR = data.macPayload.fhdr,
            FPort = data.macPayload.fPort,
            Payload = data.macPayload.payload,
            Mic = data.mic,
            cmac;

        // check join procedure
        nora._joinBox.find(function (joinData) {
            var end_device,
                len = -1;
            if (joinData.devAddr === FHDR.devAddr) {
                // create end-device instance
                end_device = new NoraEndDevice(nora, joinData);
                len = nora._joinBox.indexOf(joinData);
                if (len > -1)
                    nora._joinBox.splice(len, 1);   // delete this joinData content
                len = nora._regBox.indexOf(joinData);
                if (len > -1)
                    nora._regBox.splice(len, 1);   // delete this regData content
            } else {
                // search devAddr in database(objectbox)
                end_device = nora.find(FHDR.devAddr);
                if (!end_device)
                    deferred.reject('End-device 0x' + FHDR.devAddr + ' does not exist.');
            }
            checkMic(end_device);
        });
    }
}

// if (FHDR.fCtrl.fOptsLen === 0) {    // FOpts not existed
//                 if (FPort === null) {
//                     // empty payload
//                     deferred.resolve(null);
//                 } else if (FPort === 0x00) {  // Payload is MAC command
//                     // decrypt FRMPayload
//                     Payload = nutils.frmPayloadcrypto(end_device, Payload, end_device.nwkSKey);
//                     if (Payload[0] === 0x02)    // automatic response linkCheckAns(cmdId:0x02)
//                         nora.macReq(FHDR.devAddr, 0x02);
//                     // [TODO] Class B MAC command
//                     else if (Payload[0] === 0x10)   // pingSlotInfoAns
//                         nora.macReq(FHDR.devAddr, 0x10);
//                     else if (Payload[0] === 0x12)   // beaconTimingAns
//                         nora.macReq(FHDR.devAddr, 0x12);
//                 } else {    // Payload is application data, [TODO] use different interface? lwm2m...
//                     // decrypt FRMPayload
//                     // [TODO] fire event with different FPort(example: bootstrapReq, readRsp, ...)
//                     // event: 'register'. devIncoming should be fire after device registered successful.
//                     // register info: devAddr, lifetime, lwm2m version, objects & object instances [MUST], binding mode, SMS number [OPTIONAL]
//                     // update info: lifetime binding mode SMS number objects & object instances [OPTIONAL]
//                     // de-register info: none
//                     // notify info: update value [MUST]
//                     var j = 0,
//                         msg = '',
//                         dataFormat;
//                         event = '',
//                     Payload = nutils.frmPayloadcrypto(end_device, Payload, end_device.appSKey);
//                     // data format & [TODO] message continue or not?(need to be queued)
//                     dataFormat = Payload.readUInt8(j);
//                     j += 1;
//                     // data format transfer
//                     if ((dataFormat & 0x30) === 0x30) { // JSON format
//                         for (i = 1;i < Payload.length - 1;i += 1) {
//                             Payload[i] = Payload[i].toString();
//                             msg = msg.concat(String.fromCharCode(Payload[i]));
//                         }
//                         Payload = JSON.parse(msg);
//                     }


//                     if (FPort === 0x01) {   // bootstrap request
//                         // [TODO] 
//                     } else if (FPort === 0x02) {    // bootstrap finish
//                         // [TODO] 
//                     } else if (FPort === 0x03) {    // bootstrap write
//                         // [TODO] 
//                     } else if (FPort === 0x04) {    // bootstrap discover
//                         // [TODO] 
//                     } else if (FPort === 0x05) {    // bootstrap delete
//                         // [TODO] 
//                     } else if (FPort === 0x06) {    // register
//                         // devAddr, lifetime, lwm2m version, objList. (add in future: binding mode, sms number)
//                         // fire register?{data: {devAddr: , lifetime: , version: , objList: }}
//                         event = 'register';
//                         // [TODO] response register command
//                         var buf = [];
//                         // MType: unconfirm data down
//                         buf.push(0x60);
//                         for (var i = 0;i < 4;i += 1)
//                             buf.push((end_device.info.devAddr >> (8 * i) & 0xff));
//                         // fctrl
//                         buf.push(0x20);
//                         buf.push(device.count & 0xff);
//                         buf.push((device.count >> 8) & 0xff);
//                         buf.push(0x06);
//                         // frmPayload: none?
//                         // generate mic
//                         buf = nutils.generateMic(device, buf, 1);
//                         return Q.fcall(function () {
//                             hal.send(buf);
//                         }).then(function () {
//                             self.emit('devIncoming', end_device);
//                         }).done();
//                     } else if (FPort === 0x07) {    // update
//                         // lifetime, binding mode, sms number, objList
//                         event = 'update';
//                     } else if (FPort === 0x08) {    // de-register
//                         event = 'de_register';
//                         // [TODO] response de-register command
//                         nora.remove(end_device.info.devAddr);
//                     } else if (FPort === 0x09) {    // read response
//                         event = 'readRsp';
//                     } else if (FPort === 0x0a) {    // write response
//                         event = 'writeRsp';
//                     } else if (FPort === 0x0b) {    // execute response
//                         event = 'executeRsp';
//                     } else if (FPort === 0x0c) {    // create response
//                         event = 'createRsp';
//                     } else if (FPort === 0x0d) {    // delete response
//                         event = 'deleteRsp';
//                     } else if (FPort === 0x0e) {    // discover response
//                         event = 'discoverRsp';
//                     } else if (FPort === 0x0f) {    // write-attributes response
//                         event = 'writeAttrsRsp';
//                     } else if (FPort === 0x10) {    // observation response
//                         event = 'observeRsp';
//                     } else if (FPort === 0x11) {    // cancel observation response
//                         event = 'cObserveRsp';
//                     } else if (FPort === 0x12) {    // notify
//                         event = 'notify';
//                     }
//                     // this.emit(event, Payload);
//                 }
//             } else {    // FOpts existed, MAC Command
//                 if (FHDR.fOpts[0] === 0x02)    // automatic response linkCheckAns(cmdId:0x02)
//                     nora.macReq(FHDR.devAddr, 0x02);
//                 // [TODO] Class B MAC command
//             }

module.exports = nutils;