'use strict';

var _ = require('busyman'),
    Q = require('q'),
    crypto = require('crypto'),
    aesCmac = require('node-aes-cmac').aesCmac,
    CNST = require('../constants.json'),
    lwm2mId = require('lwm2m-id');

var nutils = {};
/*************************************************************************************************/
/*** Shim for Buffer API (new Buffer() is deprecated since node v6.0.0)                        ***/
/*************************************************************************************************/
if (!_.isFunction(Buffer.alloc)) {
    Buffer.alloc = function (size) {
        return new Buffer(size);
    };
}

if (!_.isFunction(Buffer.from)) {
    Buffer.from = function (array) {
        return new Buffer(array);
    };
}
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
};

nutils.pathDataType = function (path) {
    var pathArray = this.pathParserToArray(path),
        dataType = [ 'so', 'object', 'instance', 'resource' ][pathArray.length];
    return dataType;
};

nutils.ridKey = function (oid, rid) {
    var ridItem = lwm2mId.getRid(oid, rid);

    if (_.isUndefined(rid))
        rid = oid;

    return ridItem ? ridItem.key : rid;
};

nutils.oidKey = function (oid) {
    var oidItem = lwm2mId.getOid(oid);

    return oidItem ? oidItem.key : oid;
};

nutils.oidNum = function (oid) {
    var oidItem = lwm2mId.getOid(oid);

    oidItem = oidItem ? oidItem.value : parseInt(oid);

    if (_.isNaN(oidItem))
        oidItem = oid;

    return oidItem;
};

nutils.getSoValPath = function (path) {
    var pathArray = this.pathParserToArray(path),   // '/1/2/3'
        soPath = '',
        oid,
        rid;

    if (pathArray[0]) { //oid
        oid = this.oidNumber(pathArray[0]);
        soPath += '/' + oid;

        if (pathArray[1]) { //iid
            soPath += '/' + pathArray[1]; 

            if (pathArray[2]) { //rid
                rid = this.ridNumber(oid, pathArray[2]);
                soPath +=  '/' + rid;
            } 
        }
    }

    return soPath;  // '/1/2/3'
};

nutils.getSoKeyObj = function (path) {
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
};

nutils.getSoTurnToLwm2mTlv = function (so, callback) {
    var deferred = Q.defer(),
        oidsArray = [],
        objsArray = [],
        oidStr;

    so.dump(function (err, data) {
        _.forEach(data, function (oVal, oid) {
            objsArray.push(oVal);
            oidStr = '/' + lwm2mId.getOid(oid).value;
            oidsArray.push(oidStr);
        });
        deferred.resolve({ oids: oidsArray, objs: objsArray });
    });

    return deferred.promise.nodeify(callback);
};

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
nutils.addMic = function (device, data, dir) {
    if (!_.isBuffer(data))
        throw new TypeError('data should be a buffer.');
    // cmac = aes128_cmac(NwkSKey, B0 | msg)
    // MIC = cmac[0..3]
    // msg = MHDR | FHDR | FPort | FRMPayload
    // B0: 0x49 | 0x00000000 | Dir | DevAddr | FCntUp/FCntDown | 0x00 | len(msg)
    // Dir: 0: uplink, 1: downlink
    // [TODO] check FCnt(4/2 bytes)?
    var msgArray = [],
        msgBuf,
        cmac;

    msgArray.push(0x49);
    for (var i = 0;i < 4;i += 1)
        msgArray.push(0x00);
    // dir
    msgArray.push(dir);
    // devAddr
    for (var i = 0;i < 4;i += 1)
        msgArray.push(((device.info.devAddr >> (8 * i)) & 0xff));
    // FCnt(up/down)
    for (var i = 0;i < 4;i += 1)
        msgArray.push(((device.count >> (8 * i)) & 0xff));
    msgArray.push(0x00);
    msgArray.push(data.length);
    // msg
    msgBuf = new Buffer(msgArray);
    msgBuf = Buffer.concat([msgBuf, data]);
    cmac = aesCmac((new Buffer(device.info.nwkSKey)), msgBuf, { returnAsBuffer: true });
    msgBuf = Buffer.concat([data, (new Buffer([cmac[0], cmac[1], cmac[2], cmac[3]]))]);

    return msgBuf;
};

nutils.createSKey = function (key, device) {
    var skey = crypto.createCipher('aes128', device.info.appKey),
        skeyArray = [],
        skeyBuf;
    // Generate NwkSKey & AppSKey with AppKey, Check AES128 which way is used?
    // NwkSKey = aes128_encrypt(AppKey, 0x01 | AppNonce | NetID | DevNonce | pad16)
    // AppSKey = aes128_encrypt(AppKey, 0x02 | AppNonce | NetID | DevNonce | pad16)
    // AppNonce: 3bytes, NetID: 3 bytes, DevNonce: 2bytes, pad16: 16bytes(optional)

    if (!_.isString(key))
        throw new TypeError('key must be a string.');
    else if (key !== 'nwkSKey' & key !== 'appSKey')
        throw new Error('key should be appSkey or nwmSKey.');

    (key === 'nwkSKey') ? skeyArray.push(0x01) : skeyArray.push(0x02);
    // appNonce
    for (var i = 2;i > -1;i -= 1)
        skeyArray.push((device.info.appNonce >> (i * 8)) & 0xff);
    for (var i = 2;i > -1;i -= 1)
        skeyArray.push((device.info.netId >> (i * 8)) & 0xff);
    for (var i = 1;i > -1;i -= 1)
        skeyArray.push((device.info.devNonce >> (i * 8)) & 0xff);
    // pad16(chList(optional))
    if (device.cfList) {
        for (var i = 15;i > -1;i -= 1)
            skeyArray.push((device.cfList >> (i * 8)) & 0xff);
    }

    skeyBuf = new Buffer(skeyArray);
    skey.update(skeyBuf);
    skey = skey.final();

    return skey.toString('ascii');
};

// encrypt/decrypt FRMPayload
nutils.frmPayloadcrypto = function (noraED, dir, data, key) {
    if (!_.isBuffer(data))
        throw new TypeError('data must be a buffer.');
    if (!_.isString(dir))
        throw new TypeError('dir must be a string.');
    if (!_.isString(key))
        throw new TypeError('key must be a string.');

    if (dir !== 'up' && dir !== 'down')
        throw new Error('dir should be up or down.');

    var cipher,
        seqArray = [],
        seqBuf,
        seqSumBuf = [];
    // FPort: 0: NwkSKey, 1~255: AppSKey, K: NwkSKey/AppSKey
    // Ai = (0x01 | 0x00000000 | Dir | DevAddr | FCnt(Up/Down) | 0x00 | i)
    // Dir: 0: uplink, 1: downlink, pld = FRMPayload
    // Si = aes128_encrypt(K, Ai), i = 1..k, k = ceill(len(pld)/16)
    // S = S1 | S2 | .. | Sk
    // Encryption and decryption of the payload is done by truncating
    // (pld | pad16) xor S to the first len(pld) octets
    // all data crypto
    for (var i = 1;i < ((data.length / 16) + 1);i += 1) {
        cipher = crypto.createCipher('aes128', key);
        seqArray.push(0x01);
        for (var i = 0;i < 4;i += 1)
            seqArray.push(0x00);
        (dir === 'up') ? seqArray.push(0x00) : seqArray.push(0x01);
        for (var i = 3;i < -1;i -= 1)
            seqArray.push((noraED.info.devAddr >> (i * 8)) & 0xff);
        for (var i = 3;i < -1;i -= 1)   // 4 bytes
            seqArray.push((noraED.count >> (i * 8)) & 0xff);
        seqArray.push(0x00);
        seqArray.push(i);

        seqBuf = new Buffer(seqArray);
        cipher.update(seqBuf);
        seqBuf = cipher.final();
        seqSumBuf = Buffer.concat(seqSumBuf, seqBuf);
    }

    // [TODO] Correction need to be checked
    // XOR data
    // [TODO] last data does it need to encrypt? if encrypt, the last data will be 16 bytes
    for (var i = 0;i < (data.length  - (data.length % 16) + (data.length % 16) ? 16 : 0);i += 1)
        data[i] = data[i] ^ seqSumBuf[i];

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

// LoRaWAN data parse
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
                    fCtrlByte: null,
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
                appEUI: null,
                devEUI: null,
                devNonce: null,
                mic: null
            };

        info.appEUI = data.readUIntLE(i, 8);
        i += 8;
        info.devEUI = data.readUIntLE(i, 8);
        i += 8;
        info.devNonce = data.readUInt16LE(i);
        i += 2;
        info.mic = data.readUIntBE(i, 4);
        i += 4;

        return info;
    } else if (phyPayload.mhdr.mType === mType.JOINACCEPT) {  // join-accept
        if (data.length !== 17 & data.length !== 33) {
            return;
        }
        var info = {
                mhdrByte: mhdrByte,
                mhdr: phyPayload.mhdr,
                appNonce: null,
                netId: null,
                devAddr: null,
                dlSettings: null,
                rxDelay: null,
                cfList: null
            };

        info.appNonce = data.readUIntLE(i, 3);
        i += 3;
        info.netId = data.readUIntLE(i, 3);
        i += 3;
        info.devAddr = data.readUIntLE(i, 4);
        i += 4;
        info.dlSettings = data.readUInt8(i);
        i += 1;
        info.rxDelay = data.readUInt8(i);
        i += 1;
        if (data.length === 33) {
            info.cfList = data.readUIntLE(i, 16);
            i += 16;
        }
        info.mic = data.readUIntBE(i, 4);
        i += 4;

        return info;
    } else {    // other message type
        if (data.length < 12) {     // data is not LoRaWAN format
            return;
        }


        var FHDR = phyPayload.macPayload.fhdr,
            FPort = phyPayload.macPayload.fPort,
            Payload = phyPayload.macPayload.payload,
            Mic = phyPayload.mic;
            // FCtrlByte;

        FHDR.devAddr = data.readUInt32LE(i);
        i += 4;

        FHDR.fCtrlByte = data.readUInt8(i);
        // FCtrlByte = data.readUInt8(i);
        FHDR.fCtrl.fOptsLen = FHDR.fCtrlByte & 0x0f;
        // FHDR.FCtrl.FPending = (FHDR.fCtrlByte >> 4) & 0x01;      // use in downlink
        FHDR.fCtrl.rfu = (FHDR.fCtrlByte >> 4) & 0x01;        // use in uplink: if RFU = 1 means device is class b
        FHDR.fCtrl.ack = (FHDR.fCtrlByte >> 5) & 0x01;
        // FHDR.FCtrl.RFU = (FHDR.fCtrlByte >> 6) & 0x01;           // use in downlink
        FHDR.fCtrl.adrAckReq = (FHDR.fCtrlByte >> 6) & 0x01;  // use in uplink
        FHDR.fCtrl.adr = (FHDR.fCtrlByte >> 7) & 0x01;
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
            var payload = new Buffer(data.length - i - 4);
            data.copy(payload, 0, i, (data.length - 4));
            Payload = payload;
            i += (data.length - i - 4);
        } else {
            FPort = null;
        }

        Mic = data.readUIntLE(i, 4);
        i += 4;

        phyPayload.macPayload.fhdr = FHDR;
        phyPayload.macPayload.fPort = FPort;
        phyPayload.macPayload.payload = Payload;
        phyPayload.mic = Mic;

        return phyPayload;
    }
};
// this is for joinAccept or uplink message
nutils.downlinkCheck = function (device, data) {
    var joinAcptMic,
        joinAcptMicArray = [],
        joinAcptMicBuf,
        micCheck = '',
        Payload;

    if (data.mhdr.mType === CNST.MType.JOINACCEPT) {
        // check mic
        // cmac = aes128_cmac(AppKey, MHDR | AppNonce | NetID | DevAddr | DLSettings | RxDelay | CFList)
        // MIC = cmac[0..3]
        joinAcptMicArray.push(data.mhdrByte);
        for (var i = 0;i < 3;i += 1)
            joinAcptMicArray.push(data.appNonce[i]);
        for (var i = 0;i < 3;i += 1)
            joinAcptMicArray.push(data.netId[i]);
        for (var i = 0;i < 3;i += 1)
            joinAcptMicArray.push(data.devAddr[i]);
        joinAcptMicArray.push(data.dlSettings);
        joinAcptMicArray.push(data.rxDelay);
        if (data.cfList) {
            for (var i = 0;i < 3;i += 1)
                joinAcptMicArray.push(data.cfList[i]);
        }
        joinAcptMicBuf = new Buffer(joinAcptMicArray);
        // appKey must be a string
        joinAcptMic = aesCmac((new Buffer(device.appKey)), joinAcptMicBuf);
        micCheck = ((joinAcptMic[0] << 24) | (joinAcptMic[1] << 16) | (joinAcptMic[2] << 8) | (joinAcptMic[3] << 0));
        if (data.mic === micCheck) {    // MIC correct
            device.info.appNonce = data.appNonce;
            device.info.netId = data.netId;
            device.info.devAddr = data.devAddr;
            device.dlSettings = data.dlSettings;
            device.rxDelay = data.rxDelay;
            if (data.cfList)
                device.cfList = data.cfList;

            device._connectedStatus = 'connected';
            device.count = 0;
            setImmediate(function () {
                device.emit('joinAccept', device.info.devAddr);
            });
        } else {

        }
    } else {    // other message type
        // ignore uplink message(joinAccept, unconfirmed data down & confirmed data down)
        if (data.mhdr.mType === CNST.MType.JOINREQUEST | phyPayload.mhdr.mType === CNST.MType.UNCONFIRMDATAUP | phyPayload.mhdr.mType === CNST.MType.CONFIRMDATAUP)
            return;

        var FHDR = data.macPayload.fhdr,
            FPort = data.macPayload.fPort,
            Mic = data.mic;

        Payload = data.macPayload.payload;
        // Generate & check MIC
        // cmac = aes128_cmac(NwkSKey, B0 | msg)
        // MIC = cmac[0..3]
        // msg = MHDR | FHDR | FPort | FRMPayload
        // B0: 0x49 | 0x00000000 | Dir | DevAddr | FCntUp/FCntDown | 0x00 | len(msg)
        // Dir: 0: uplink, 1: downlink
        var msgArray = [],
            msgBuf,
            cmac,
            mic;

        msgArray.push(0x49);
        for (var i = 0;i < 4;i += 1)
            msgArray.push(0x00);
        // dir
        msgArray.push(0x01);
        // devAddr
        for (var i = 0;i < 4;i += 1)
            msgArray.push(((FHDR.devAddr >> (8 * i)) & 0xff));
        // FCnt(up/down)
        for (var i = 0;i < 4;i += 1)
            msgArray.push(((FHDR.fCnt >> (8 * i)) & 0xff));
        msgArray.push(0x00);
        msgArray.push(data.phyPayloadLength - 4);
        // msg
        // mhdr
        msgArray.push(data.mhdrByte);
        // devAddr
        for (var i = 0;i < 4;i += 1)
            msgArray.push(((FHDR.devAddr >> (8 * i)) & 0xff));
        // FCtrl
        msgArray.push(FHDR.fCtrlByte);
        // FCnt(up/down)
        for (var i = 0;i < 4;i += 1)
        msgArray.push(((FHDR.fCnt >> (8 * i)) & 0xff));
        if (FHDR.fCtrl.fOptsLen !== 0)
            msgArray.push(FHDR.fOpts);
        if (FPort !== null) {
            msgArray.push(FPort);
            for (var i = 0;i < Payload.length;i += 1)
                msgArray.push(Payload[i]);
        }
        msgBuf = new Buffer(msgArray);
        cmac = aesCmac((new Buffer(device.info.nwkSKey)), msgBuf, { returnAsBuffer: true });
        mic = ((cmac[0] << 24) | (cmac[1] << 16) | (cmac[2] << 8) | (cmac[3] << 0));
        // check mic correction
        if (mic === Mic) {
        //     if ((device.count + 1) === FHDR.fCnt) // check frame counter, fix counter
        //         device.count = FHDR.fCnt;
            // [TODO] if count > 0xffffffff?
            if (FPort === null) {
                    // empty payload
                    // deferred.resolve(null);
            } else if (FPort === 0x00) {  // Payload is MAC command
                // decrypt FRMPayload
                // Payload = nutils.frmPayloadcrypto(device, Payload, device.info.nwkSKey);
            } else {    // Payload is application data, [TODO] use different interface? lwm2m...
                // Payload = nutils.frmPayloadcrypto(device, Payload, device.info.appSKey);
            }
            data.macPayload.payload = Payload;
            return data;
            // [TODO]
        }
    }
};

nutils.checkMic = function (device, data, dir) {
    // Generate  & check MIC
    // cmac = aes128_cmac(NwkSKey, B0 | msg)
    // MIC = cmac[0..3]
    // msg = MHDR | FHDR | FPort | FRMPayload
    // B0: 0x49 | 0x00000000 | Dir | DevAddr | FCntUp/FCntDown | 0x00 | len(msg)
    // Dir: 0: uplink, 1: downlink
    var FHDR = data.macPayload.fhdr,
        FPort = data.macPayload.fPort,
        Mic = data.mic,
        Payload = data.macPayload.payload,
        cmac;

    var msgArray = [],
        msgBuf,
        mic;

    msgArray.push(0x49);
    for (var i = 0;i < 4;i += 1)
        msgArray.push(0x00);
    // dir
    msgArray.push(dir);
    // devAddr
    for (var i = 0;i < 4;i += 1)
        msgArray.push(((FHDR.devAddr >> (8 * i)) & 0xff));
    // FCnt(up/down)
    for (var i = 0;i < 4;i += 1)
        msgArray.push(((FHDR.fCnt >> (8 * i)) & 0xff));
    msgArray.push(0x00);
    msgArray.push(data.phyPayloadLength - 4);
    // msg
    // mhdr
    msgArray.push(data.mhdrByte);
    // devAddr
    for (var i = 0;i < 4;i += 1)
        msgArray.push(((FHDR.devAddr >> (8 * i)) & 0xff));
    // FCtrl
    msgArray.push(FHDR.fCtrlByte);
    // FCnt(up/down)
    for (var i = 0;i < 4;i += 1)
        msgArray.push(((FHDR.fCnt >> (8 * i)) & 0xff));
    if (FHDR.fCtrl.fOptsLen !== 0)
        msgArray.push(FHDR.fOpts);
    if (FPort !== null) {
        msgArray.push(FPort);
        for (var i = 0;i < Payload.length;i += 1)
            msgArray.push(Payload[i]);
    }
    msgBuf = new Buffer(msgArray);

    cmac = aesCmac(device.info.nwkSKey, msgBuf, { returnAsBuffer: true });
    mic = ((cmac[0] << 24) | (cmac[1] << 16) | (cmac[2] << 8) | (cmac[3] << 0));

    // return (mic === Mic) ? true : false;
    return true;
};

nutils.decryptPayload = function (device, data) {
    var FPort = data.macPayload.fPort,
        Payload = data.macPayload.payload;
    // decrypt FRMPayload
    if (FPort === null) {
        // empty payload
        // deferred.resolve(null);
    } else if (FPort === 0x00) {  // Payload is MAC command
        // decrypt FRMPayload
        // Payload = nutils.frmPayloadcrypto(device, Payload, device.info.nwkSKey);
    } else {    // Payload is application data, [TODO] use different interface? lwm2m...
        // Payload = nutils.frmPayloadcrypto(device, Payload, device.info.appSKey);
    }
    data.macPayload.payload = Payload;
    return data;
};

module.exports = nutils;