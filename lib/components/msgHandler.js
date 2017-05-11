'use strict';

var _ = require('busyman'),
    NoraEndDevice = require('./nora-end-device.js'),
    SmartObject = require('smartobject'),
    nutils = require('./nutils.js'),
    aesCmac = require('node-aes-cmac').aesCmac,
    CNST = require('../constants.json'),
    Q = require('q');

var Lwm2mCmdId = CNST.LWM2MCMDID;

var msgHandler = {};

msgHandler._registerHandler = function (nora, msg) {
    // [TODO] msg should not use json format, end-device will have lots of strings to tranmit
    // msg: { devAddr, lifetime, version, objList }
    // console.log('_registerHandler msg');
    // console.log(msg);
    var noraED = nora.find(msg.devAddr),
        so = noraED ? noraED.so : null,
        badAttr = false,
        acceptedAttrs = ['devAddr', 'lifetime', 'version', 'objList'];

    if (!noraED)
        return;

    console.log('_registerHandler noraED._registered');
    console.log(noraED._registered);
    // validate message
    _.forEach(msg, function (val, key) {    // unknown device attributes are not allowed
        if (!_.includes(acceptedAttrs, key))
            badAttr = true;
    });

    if (badAttr)
        return sendResponse(nora, 'register', msg.devAddr, 'BadRequest');
    else {
        sendResponse(nora, 'register', msg.devAddr, 'Created', function () {
            noraED._registered = true;
            // console.log('_objectDetailReq');
            // devAddr, confirm, ack, pending, cmdId, payload
            msgHandler._objectDetailReq(noraED, noraED.info.devAddr, msg.objList).then(function (objs) {
                // [TODO] objList example:'/3303/0'.objList transfer to smartObject
                // console.log('_objectDetailReq objs');
                // console.log(objs);
                _.forEach(objs, function (obj) {
                    _.forEach(obj.data, function (rObjs, iid) {
                        so.init(obj.oid, iid, rObjs);
                    });
                });
            }).then(function () {
                // [TODO] read all resource?
                // [CHECK] program do not run the next step, why?
                
                // noraED.objList = msg.objList;
                noraED.version = msg.version;
                noraED._setStatus('online');
                console.log('_registerHandler noraED._registered');
                console.log(noraED._registered);
                return noraED.devBoxSave();
            }).then(function () {
                noraED.enableLifeChecker();
                setImmediate(function () {
                    nora.emit('_registered', noraED);
                    nora.emit('devIncoming', noraED);
                });
            }).fail(function (err) {
                console.log('_registerHandler fail');
                noraED._registered = false;
                noraED._setStatus('offline');
                noraED.devBoxRemove().done();
                noraED.so = null;
                nora._endDeviceBox[msg.devAddr] = null;
                delete nora._endDeviceBox[msg.devAddr];
                sendResponse(nora, 'register', msg.devAddr, 'IntervalServerError');
            }).done();
        });
    }
}

msgHandler._updateHandler = function (nora, msg) {
    // msg: devAddr, lifetime , objList
    var so,
        noraED = nora.find(msg.devAddr),
        oldEDData,
        oldObjList,
        badAttr = false,
        acceptedAttrs = ['devAddr', 'lifetime', 'version', 'objList'];

    // validate message
    _.forEach(msg, function (val, key) {            // unknown device attributes are not allowed
        if (!_.includes(acceptedAttrs, key))
            badAttr = true;
    });
    
    // console.log('badAttr');
    // console.log(badAttr);
    if (!noraED || !noraED.so) {
        console.log('NotFound');
        return sendResponse(nora, 'update', msg.devAddr, 'NotFound');
    } else if (badAttr)
        return sendResponse(nora, 'update', msg.devAddr, 'BadRequest');

    so = noraED.so;
    oldEDData = noraED.dump();
    oldObjList = noraED.objList;

    console.log('_updateHandler msg');
    console.log(msg);
    console.log('noraED._registered');
    console.log(noraED._registered);

    noraED.updateAttrs(msg).then(function (diff) {
        noraED.enableLifeChecker();
        console.log('diff');
        console.log(diff);
        if (_.has(diff, 'objList')) {
            noraED._registered = false;
            // kill old objects
            _.forEach(oidObjList, function (iids, oid) {
                var oidKey = nutils.oidKey(oid);
                so[oidKey] = null;
                delete so[oidKey];
            });

            return Q.fcall(function () {
                // [TODO] read all resource?
                _.forEach(msg.objList, function (obj) {
                    _.forEach(obj.data, function (rObjs, iid) {
                        so.init(obj.oid, iid, rObjs);
                    })
                });

                noraED.objList = msg.objList;
                return noraED.devBoxSave();
            }).then(function () {
                noraED._registered = true;

                setImmediate(function () {
                    nora.emit('updated', {devAddr: noraED.info.devAddr, data: diff});
                });
            }).fail(function (err) {
                // kill new objects
                _.forEach(oidObjList, function (iids, oid) {
                    var oidKey = nutils.oidKey(oid);
                    so[oidKey] = null;
                    delete so[oidKey];
                });

                // recover old Objs
                noraED.objList = oidObjList;
                // so.addObjects(oidEDData.so);
                _.forEach(oidEDData.so, function (iObjs, oid) {
                    _.forEach(iObjs, function (rObjs, iid) {
                        so.init(oid, iid, rObjs);
                    });
                });
                delete oldEDData.so;

                _.merge(noraED, oidEDData);
            }).done();
        } else {
            // [TODO]
        }
    }).fail(function (err) {

    }).done(function () {

    });
}

msgHandler._deregisterHandler = function (nora, msg) {
    // msg: devAddr
    var noraED = nora.find(msg.devAddr);

    if (!noraED)
        return sendResponse(nora, 'deregister', msg.devAddr, 'NotFound')

    noraED.disableLifeChecker();
    noraED._registered = false;
    noraED._setStatus('offline');

    noraED.devBoxRemove().done();
    noraED.so = null;
    delete noraED.so;
    nora.remove(msg.devAddr);

    sendResponse(nora, 'deregister', msg.devAddr, 'Deleted', function () {
        setImmediate(function () {
            nora.emit('deregister', msg.devAddr);
        });
    });
}

msgHandler._notifyHandler = function (nora, msg) {
    // msg: devAddr, oid, iid, rid, data
    var noraED = nora.find(msg.devAddr),
        iobj = (qnode && qnode.so) ? qnode.so.findObjectInstance(msg.oid, msg.iid) : undefined,
        resrc = (iobj && !_.isNil(msg.rid)) ? qnode.so.get(msg.oid, msg.iid, msg.rid) : undefined,
        rspStatus,
        targetPath;

    // validate message
    if (!noraED || !noraED.so)
        rspStatus = 'NotFound';
    else if (_.isNil(msg.oid) || _.isNil(msg.iid))
        rspStatus = 'BadRequest';
    else if (!iobj)
        rspStatus = 'NotFound';
    else if (_.isNil(msg.rid))      // data is object instance
        rspStatus = !_.isPlainObject(msg.data) ? 'BadRequest' : undefined;
    else if (_.isUndefined(resrc))  // data is resouece
        rspStatus = 'NotFound';

    if (rspStatus)
        sendResponse(nora, 'deregister', msg.devAddr, rspStatus);

    if (_.isNil(msg.rid)) {   // data is object instance
        var badResrc = false;
        targetPath = msg.oid + '/' + msg.iid;

        _.forEach(msg.data, function (val, rid) {
            var ridKey = nutils.ridKey(msg.oid, rid);
            badResrc = badResrc || _.isUndefined(qnode.so.get(msg.oid, msg.iid, rid));
            // replace rid with its string id
            delete msg.data[rid];
            msg.data[ridKey] = val;
        });
    } else {                        // data is an resource
        targetPath = msg.oid + '/' + msg.iid + '/' + msg.rid;
    }

    if (badResrc)
        return sendResponse(nora, 'notify', msg.devAddr, 'BadRequest');

    setImmediate(function () {
        nora.emit('devNotify', noraED, msg);
    });

    // [TODO]
    noraED.updateSoAndDevBox(targetPath, msg.data).then(function (diff) {
        msg.data = diff;
    });
}

// [TODO]
// msgHandler.macCmdHandler = function (nora, ) {

// }

msgHandler._msgDispatch = function (nora, data, callback) {
    var deferred = Q.defer();

    if (data.mhdr.mType === CNST.MType.JOINREQUEST) {   // joinRequest
        msgHandler._joinReqHandler(nora, data);
    // } else if (data.mhdr.mType === CNST.MType.JOINACCEPT) { // joinAccept
        // return;
    } else if (data.mhdr.mType === CNST.MType.UNCONFIRMDATAUP | data.mhdr.mType === CNST.MType.CONFIRMDATAUP) {    // other message type
        console.log('uplink message');
        msgHandler._uplinkHandler(nora, data).then(function (data) {
            // console.log('data');
            // console.log(data);
            deferred.resolve(data);
        });
        
    // } else if (data.mhdr.mType === CNST.MType.UNCONFIRMDATADOWN | data.mhdr.mType === CNST.MType.CONFIRMDATADOWN) {
        // return;
    }

    return deferred.promise.nodeify(callback);
};
// for nora
msgHandler._joinReqHandler = function (nora, data, callback) {
    // var deferred = Q.defer();

    function checkDevEUIAndAppEUI(otaaRegData) {
        var joinReqMicArray = [],
            // joinReqMicBuf,
            joinReqMic,
            micCheck;
        if ((data.devEUI === otaaRegData.devEUI) & (data.appEUI === otaaRegData.appEUI)) {  // check devEUI & appEUI
            // Generate & check MIC
            // cmac = aes128_cmac(AppKey, MHDR | AppEUI | DevEUI | DevNonce)
            // MIC = cmac[0..3]
            joinReqMicArray.push(data.mhdrByte);
            for (var i = 0;i < 8;i += 1)
                joinReqMicArray.push(data.appEUI[i]);
            for (var i = 0;i < 8;i += 1)
                joinReqMicArray.push(data.devEUI[i]);
            for (var i = 0;i < 2;i += 1)
                joinReqMicArray.push(data.devNonce[i]);
            // joinReqMicBuf = new Buffer(joinReqMicArray);
            joinReqMic = aesCmac((new Buffer(otaaRegData.appKey)), (new Buffer(joinReqMicArray)), { returnAsBuffer: true });
            micCheck = ((joinReqMic[0] << 24) | (joinReqMic[1] << 16) | (joinReqMic[2] << 8) | (joinReqMic[3] << 0));
            // if (data.mic === micCheck) {    // MIC correct
                // OTAA join-procedure
                // add devNonce & mhdr to joinData
                otaaRegData.mhdr = data.mhdr;
                otaaRegData.devNonce = data.devNonce;
                // return otaaRegData;
            // } else {
                // otaaRegData = null;
            // }
        } else {
            otaaRegData = null;
        }

        if (otaaRegData) {
            // console.log('otaaRegData');
            // console.log(otaaRegData);
            // add to prepare-join-list
            nora._joinBox.push(otaaRegData);
            // [TODO] if end-device do not receive joinAccept message?
            // [TODO] delay rxDelay? send joinAccept message
            nora._joinAccept(otaaRegData.devEUI, otaaRegData, otaaRegData.appKey, function (err) {
                if (err) {
                    console.log(err);
                    // deferred.reject(err);
                }
            });
        }
    }
    // search devNonce in database(objectbox)
    nora._devBox.findFromDb({ devNonce: data.devNonce }, function (err, dev) {    // dev is array
        if (dev.length === 0) { // devNonce do not exist in database
            nora._devBox.findFromDb({ devEUI: data.devEUI }, function (err, dev) {
                if (dev.length === 0) {
                    console.log('devEUI not exist');
                    // search OTAA register box
                    nora._otaaRegBox.find(function (otaaRegData) {
                        checkDevEUIAndAppEUI(otaaRegData);
                    });
                } else {
                    console.log('devEUI exist');
                    var pastData,
                        end_device;
                    // pastData.devEUI = dev[0].devEUI;
                    // dev[0]: status, option, devEUI, appEUI, devNonce, devAddr, netId, appNonce, rx1DROffset
                    //         rx2DR, rxDelay, version, lifetime, joinTime, nextPingSlotTime, objList, so, id , _id
                    // console.log();
                    dev[0].devNonce = data.devNonce;
                    // nora._pastDevBox.push(dev[0]);  // information need to be check
                    // nora._pastDevBox.find(function (pastDevData) {
                    //     if (end_device.info.devEUI === pastDevData.devEUI) {
                    //         console.log('devEUI equal');
                    // delete end-device instance
                    nora._endDeviceBox[dev[0].devAddr] = null;
                    delete nora._endDeviceBox[dev[0].devAddr];
                    // remove infomation from database
                    nora._devBox.remove(dev[0].id, function (err, id) {
                        if (err)
                            deferred.reject(err);
                    });
                    // create new end-device instance, devNonce is already new one
                    end_device = new NoraEndDevice(nora, dev[0]);
                    console.log('dev[0] create end_device');
                    nora._devBox.set(dev[0].id, end_device, function (err) {
                        if (err)
                            deferred.reject(err);
                    });
                    //     }
                    // });
                    // old device disconnect from sever but it wants to connect to server again 
                    // dev[0];
                    // [TODO] response joinAccept
                    nora._joinAccept(dev[0].devEUI, dev[0], dev[0].appKey, function (err, data) {
                        if (err)
                            console.log(err);
                    }); // appKey need to be decrypted
                    // need to maintain information until new uplink
                }
            });
        }
    });
};

// for nora
msgHandler._uplinkHandler = function (nora, data, callback) {
    var deferred = Q.defer(),
        FHDR = data.macPayload.fhdr,
        i = 0;
    // [TODO] 
    // check join procedure
    nora._joinBox.find(function (joinData) {
        console.log('time: ' + i);
        i += 1;
        var end_device,
            len = -1;
        if (joinData.devAddr === FHDR.devAddr) {
            console.log('create end-device');
            // create end-device instance
            end_device = new NoraEndDevice(nora, joinData);
            nora._devBox.add(end_device, function (err) {
                if (err)
                    deferred.reject(err);
            });
            len = nora._joinBox.indexOf(joinData);
            if (len > -1)
                nora._joinBox.splice(len, 1);   // delete this joinData content
            len = nora._otaaRegBox.indexOf(joinData);
            if (len > -1)
                nora._otaaRegBox.splice(len, 1);   // delete this regData content
        } else {
            console.log('search end-device');
            // search devAddr in database(objectbox)
            end_device = nora.find(FHDR.devAddr);
            // console.log(end_device);
            // [TODO] how to update to new one devNonce?
            // how to get devNonce
            // nora._devBox.findFromDb();
            // if (count === 1)?
            if (!end_device)
                deferred.reject('End-device 0x' + FHDR.devAddr + ' does not exist.');
            else {
                // [TODO] there will be created new end-device if devEUI equal
                // nora._pastDevBox.find(function (pastDevData) {
                //     if (end_device.info.devEUI === pastDevData.devEUI) {
                //         console.log('devEUI equal');
                //         // delete end-device instance
                //         nora._endDeviceBox[pastDevData.devAddr] = null;
                //         delete nora._endDeviceBox[pastDevData.devAddr];
                //         // remove infomation from database
                //         nora._devBox.remove(pastDevData.id, function (err, id) {
                //             if (err)
                //                 deferred.reject(err);
                //         });
                //         // create new end-device instance, devNonce is already new one
                //         end_device = new NoraEndDevice(nora, pastDevData);
                //         console.log('_pastDevBox create end_device');
                //         nora._devBox.set(pastDevData.id, end_device, function (err) {
                //             if (err)
                //                 deferred.reject(err);
                //         });
                //     }
                // });
            }
        }
        // console.log('end_device');
        // console.log(end_device);
        if (end_device) {
            if (nutils.checkMic(end_device, data, 0)) {
                // deferred.resolve(nutils.decryptPayload(end_device, data));
                // console.log('data');
                // console.log(data);
                // [TODO] why the first reslove(data) is not working
                deferred.resolve(data);

                // return deferred.promise.nodeify(callback);
            }
        }
    });

    return deferred.promise.nodeify(callback);
};

msgHandler._objectDetailReq = function (noraED, devAddr, objListOfSo, callback) {
    var deferred = Q.defer(),
        readAllObjectPromises = [],
        oids = [];
    // var noraED = nora.find(devAddr);
    // before readReq, device need to be registered
    // noraED._registered = true;
    // read every object => dig into the structure and id-name transform
    // example for objList: { '1': [ 0 ], '3': [ 0 ], '4': [ 0 ], '3303': [ 0, 1, 2 ] }
    // example for objList: [ { oid: 3303, iid: [ 0 ] } ]
    _.forEach(objListOfSo, function (objs, objsIds) {
        var oidNum = nutils.oidNum(objs.oid);
        oids.push(oidNum);
        readAllObjectPromises.push(noraED.readReq('/' + oidNum));
    });

    // does it really need to readReq one by one?
    return Q.all(readAllObjectPromises).then(function (rsps) {
        // console.log('_objectDetailReq rsps');
        // console.log(rsps);
        // [TODO] wait all rsp response?how?
        var objs = [],
            isAnyFail = false;
        // after read all resources, register turn to false
        // noraED._registered = false;
        _.forEach(rsps, function (rsp, idx) {
            if (rsp.status === 200 || rsp.status === 201 || rsp.status === 202 || rsp.status === 204 || rsp.status === 205) {   // content
                // _.forEach(rsp.data, function (iObj, iid) {
                objs.push({ oid: oids[idx], data: rsp.data });
                    // console.log('iObj');
                    // console.log(iObj);
                    // _.forEach(iObj, function (val, rid) {
                    //     rsc[rid] = val;
                    // });
                    // console.log('rsc');
                    // console.log(rsc);
                    // noraED.so.init(oid, iid, iObj);
                    // noraED.so.init(oid, iid, rsc);
                // });
            } else {
                isAnyFail = true;
            }
        });

        if (isAnyFail) {
            // [TODO] if timeout, isAnyFail = true
            console.log('Object requests fail.');
            throw new Error('Object requests fail.');
        } else {
            // console.log('return');
            // objs.status = rsp.status;
            // console.log('return');
            // objs.data = noraED.so;
            // console.log('return');
            return objs;
        }
    }).nodeify(callback);
};

msgHandler.dispatchEvent = function (nora, data) {
    var FHDR = data.macPayload.fhdr,
        FPort = data.macPayload.fPort,
        Payload = data.macPayload.payload,
        cmd = '',
        j = 0,
        eventName,
        noraED = nora.find(FHDR.devAddr),
        result = { status: null, data: null };

    if (!noraED)
        return;

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
                    // status: rfu, power ack, data rate ack, channel mask ack
                    cmd = 'linkAdrAns';
                    break;
                case 4:  // 0x04
                    cmd = 'dutyCycleAns';
                    break;
                case 5:  // 0x05
                    // status: rfu, rx1DROffset ack, rx2 data rate ack, channel ack
                    cmd = 'rxParamSetupAns';
                    break;
                case 6:  // 0x06
                    // battery, margin
                    cmd = 'devStatusAns';
                    break;
                case 7:  // 0x07
                    // status: rfu, data rate range ok, channel frequency ok
                    cmd = 'newChannelAns';
                    break;
                case 8:  // 0x08
                    cmd = 'rxTimingSetupAns';
                    break;
                case 9:  // 0x09
                    cmd = 'txParamSetupAns';
                    break;
                case 10: // 0x0a
                    // status: rfu, uplink frequency exists, channel frequency ok
                    cmd = 'diChannelAns';
                    break;
            }
        } else {    // Payload is application data
            // [TODO] fire event with different FPort(example: bootstrapReq, readRsp, ...)
            // event: 'register'. devIncoming should be fire after device registered successful.
            // data format & [TODO] message continue or not?(need to be queued)
            // [TODO] according to data format, payload need to be parsed to different format
            var dataFormat = Payload.readUInt8(j);
            // data format: bit: 7~6: rfu
            //              bit: 5~4: data format
            //              bit: 3  : more data to be transmit
            //              bit: 2~0: rfu
            j += 1;
            Payload = Payload.slice(1);
            // eventName = 'lwm2mCmd';
            // console.log('dataFormat');
            // console.log(dataFormat);
            if ((dataFormat & 0x30) === 0x30) { // JSON format. it is not lwm2m json format, just normal json format
                // console.log('json');
                Payload = Payload.toString('ascii');
                // console.log(Payload);
                Payload = JSON.parse(Payload);
                // console.log(Payload);
                Payload.devAddr = noraED.info.devAddr;
                
            } else if ((dataFormat & 0x30) === 0x20) {  // TLV format
                // [TODO] TLV format
            }
            // console.log('FPort');
            // console.log(FPort);
            if (FPort === Lwm2mCmdId.BSRequest) {
                cmd = 'bootstrapReq';
            } else if (FPort === Lwm2mCmdId.BSFinish) {
                cmd = 'bootstrapFinishRsp';
            } else if (FPort === Lwm2mCmdId.BSWrite) {
                cmd = 'bootstrapWriteRsp';
            } else if (FPort === Lwm2mCmdId.BSDiscover) {
                cmd = 'bootstrapDiscoverRsp';
            } else if (FPort === Lwm2mCmdId.BSDelete) {
                cmd = 'bootstrapDeleteRsp';
            } else if (FPort === Lwm2mCmdId.Register) {
                // register info: devAddr, lifetime, lwm2m version, objects & object instances [MUST]
                console.log('dispatchEvent register');
                cmd = 'register';
                msgHandler._registerHandler(nora, Payload);
                console.log('noraED._registered');
                console.log(noraED._registered);
            } else if (FPort === Lwm2mCmdId.Update) {
                // update info: lifetime ,binding mode ,SMS number ,objects & object instances [OPTIONAL]
                console.log('dispatchEvent update');
                cmd = 'update';
                console.log('noraED._registered');
                console.log(noraED._registered);
                msgHandler._updateHandler(nora, Payload);
            } else if (FPort === Lwm2mCmdId.Deregister) {
                // de-register info: none
                cmd = 'deregister';
                msgHandler._deregisterHandler(nora, Payload);
            } else if (FPort === Lwm2mCmdId.Read) {
                cmd = 'readRsp';
                console.log('dispatchEvent readRsp');
                j = 0;
                result.status = Payload.readUInt16LE(j);
                j += 2;
                Payload = Payload.slice(2);
                result.data = Payload;
                // Payload: status: , data: {}
            } else if (FPort === Lwm2mCmdId.Write) {
                cmd = 'writeRsp';
                // Payload: status: 
            } else if (FPort === Lwm2mCmdId.Execute) {
                cmd = 'executeRsp';
                // Payload: status: 
            } else if (FPort === Lwm2mCmdId.Create) {
                cmd = 'createRsp';
            } else if (FPort === Lwm2mCmdId.Delete) {
                cmd = 'deleteRsp';
            } else if (FPort === Lwm2mCmdId.Discover) {
                cmd = 'discoverRsp';
                // Payload: status: , data: {}
            } else if (FPort === Lwm2mCmdId.WriteAttrs) {
                cmd = 'writeAttrsRsp';
                // Payload: status: 
            } else if (FPort === Lwm2mCmdId.Observation) {
                cmd = 'observationRsp';
                // Payload: status: , data: {}
            } else if (FPort === Lwm2mCmdId.CancelObservation) {
                cmd = 'cancelObervationRsp';
            } else if (FPort === Lwm2mCmdId.Notify) {
                // notify info: update value [MUST]
                cmd = 'notify';
                msgHandler._notifyHandler(nora, Payload);
            } else {
                console.log('Not defined yet.');
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
        nora.emit(cmd, { devAddr: FHDR.devAddr, data: result });
    });
}

function sendResponse(nora, intface, devAddr, status, callback) {
    var rspCode,
        rspArray = [],
        rspBuf,
        cmdId;

    if (!_.isString(status))
        throw new TypeError('status must be a string.');

    if (status === 'OK')
        rspCode = 200;
    else if (status === 'Created')
        rspCode = 201;
    else if (status === 'Deleted')
        rspCode = 202;
    else if (status === 'Changed')
        rspCode = 204;
    else if (status === 'BadRequest')
        rspCode = 400;
    else if (status === 'NotFound')
        rspCode = 404;
    else if (status === 'MethodNotAllowed')
        rspCode = 405;
    else if (status === 'Timeout')
        rspCode = 408;
    else if (status === 'IntervalServerError')
        rspCode = 500;
    else
        throw new Error('You got a wrong status.');

    // rspCode = JSON.stringify(rspCode);
    // rspCodeBuf = new Buffer(rspCode);
    // data format, tlv
    rspArray.push(0x20);
    for (var i = 0;i < 2;i += 1 )
        rspArray.push((rspCode >> (i * 8)) & 0xff);
    rspBuf = new Buffer(rspArray);

    if (intface === 'register')
        cmdId = 0x06;
    else if (intface === 'update')
        cmdId = 0x07;
    else if (intface === 'deregister')
        cmdId = 0x08;
    else if (intface === 'notify')
        cmdId = 0x12;
    else
        throw new Error('You got a wrong interface.');
    // devAddr, confirm, ack, pending, cmdId, payload, callback
    // console.log('rspBuf');
    // console.log(rspBuf);
    nora.sendMessage(devAddr, false, true, false, cmdId, rspBuf, function () {
        if (_.isFunction(callback))
            callback();
    });
}

module.exports = msgHandler;