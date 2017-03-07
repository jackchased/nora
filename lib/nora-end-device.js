var _ = require('busyman'),
    Nora_hal = require('./nora-hal.js');

var CNST = require('./constants.json'),
    REG = CNST.REG,
    MType = CNST.MType;
// [TODO] checking hal creat multi time ?
var hal = new Nora_hal();

function NoraEndDeivce(settings) {
    var self = this,
        nwkSKey,
        appSKey,
        propUnwritable = { writable: false, enumerable: false, configurable: false };
    // members:
    //  info
    // mac option(class): A, B, C
    this._option = {};
    // record linkCheckReq time
    this._gwCnt = 0;
    // record frame count
    this.count = 0;
    // [TODO] Generate NwkSKey & AppSKey with ?
    // Device Infomation
    Object.defineProperty(this, 'info', _.assign({
        value: {
            devEUI: settings.devEUI,
            appEUI: settings.appEUI,
            devNonce: settings.devNonce,
            appKey: settings.appKey,
            appNonce: settings.appNonce,
            netId: settings.netId,
            devAddr: settings.devAddr,
            appSKey: appSKey,
            nwkSKey: nwkSKey,
            _nwkId: (settings.devAddr >> 25),
            _nwkAddr: (settings.devAddr && 0x1ff)
        }
    }, propUnwritable));

    this.dlSettings = settings.dlSettings;
    this.rxDelay = settings.rxDelay;
    this.cfList = settings.cfList;
    
}

NoraEndDeivce.prototype.write = function (macCmdOpt, data, callback) {
    if (!_.isBoolean(macCmdOpt))
        throw new TypeError('MAC Command Option should be true or false');
    // macCmdOpt: true: MAC command, false: normal message
    // [TODO] According to device receive window delay time to send message
    // [TODO] According to class option, nora have difference timing to send message
    // [TODO] optimize program, only payload is not the same
    var buf = [],
        outputData,
        mhdr,
        devAddr = this.info.devAddr,
        fCtrl,
        fCnt = this.count + 1,
        fOpts,
        fPort,
        payload,
        mic;

    if (macCmdOpt) {    // MAC Command
        if (!_.isNumber(data.cId))
            throw new TypeError('Command ID should be a number');
        // Command ID
        buf.push(data.cId);
        if (data.cId === 0x02) {         //linkCheckAns
            var margin,
                gwCnt;

            callback = data;
            // [TODO] linkCheckAns should be automatic response when end-device sned linkCheckReq ?
            // set MHDR. MType: unconfirm data down, Major: LoRaWAN R1(0)
            mhdr = 0x00 | (MType.UNCONFIRMDATADOWN << 5);
            buf.push(mhdr);
            // set devAddr
            buf.push((this.devAddr >> 24) && 0xff);
            buf.push((this.devAddr >> 16) && 0xff);
            buf.push((this.devAddr >> 8) && 0xff);
            buf.push(this.devAddr && 0xff);
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
    } else {    // Normal Data
        if (!_.isBuffer(data))
            throw new TypeError('Data should be a Buffer');
    }
};
// [TODO] SmartObject pull high layer to handle ?
NoraEndDeivce.prototype.read = function (configName, callback) {
    // [TODO] read the value of end-device txPower, dataRate, cfList...
};

NoraEndDeivce.prototype.dump = function (callback) {
    // [TODO] dump the information of end-device(txPower, dataRate, cfList...)
};