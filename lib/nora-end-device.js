var _ = require('busyman'),
    Nora_hal = require('./lib/nora-hal.js');

var CNST = require('./constants.json'),
    REG = CNST.REG,
    MType = CNST.MType;

var hal = new Nora_hal();

function NoraEndDeivce(settings) {
    var self.this,
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
            devAddr: settings.devAddr,
            netId: settings.netId,
            appSKey: appSKey,
            nwkSKey: nwkSKey,
            _nwkId: (settings.devAddr >> 25),
            _nwkAddr: (settings.devAddr && 0x1ff)
        }
    }, propUnwritable));

    this.rxDelay = settings.rxDelay;
    this.cfList = settings.cfList;
    this.dlSettings = settings.dlSettings;
}

NoraEndDeivce.prototype.macCmd = function (cId, params, callback) {
    if (!_.isNumber(cId))
        throw new TypeError('CID should be a number');

    var buf = [],
        mhdr,
        devAddr = info.devAddr,
        fCtrl,
        fCnt = this.count + 1,
        fOpts,
        fPort,
        payload,
        mic;
    // Command ID
    buf.push(cId);

    if (cId === 0x02) {         //linkCheckAns
        var margin,
            gwCnt;

        callback = params;
        // [TODO] linkCheckAns should be automatic response
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
            return hal.send(buf);
        }).nodeify(callback);
    } else if (cId === 0x03) {  // linkADRReq
        // params: dataRate, txPower, chMask, redundancy
        if (params.dataRate > 15 || params.dataRate < 0)
            throw new RangeError('DataRate should be in between 0 to 15 if it is a number');
        if (params.txPower > 15 || params.txPower < 0)
            throw new RangeError('TxPower should be in between 0 to 15 if it is a number');
        if (params.chMask > 65535 || params.chMask < 0)
            throw new RangeError('ChMask should be in between 0 to 65535 if it is a number');
        if (params.redundancy > 255 || params.redundancy < 0)
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
        dataRate_Power = params.txPower | (params.dataRate << 4);
        buf.push(dataRate_Power);
        buf.push((params.chMask) && 0xff);
        buf.push(params.chMask && 0xff);
        buf.push(params.redundancy);
        // [TODO] Redundancy: ChMaskCntl, NbTrans implement

        // set MIC
        // [TODO] MIC generated with ?
        // [TODO] delay?
        return hal.send(buf);
    } else if (cId === 0x04) {  // dutyCycleReq
        // params: dutyCyclePL
        if (params.dutyCyclePL > 15 || params.dutyCyclePL < 0)
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
        buf.push(params.maxDCycle);
        // set MIC
        // [TODO] MIC generated with ?
        // [TODO] delay?
        return hal.send(buf);
    } else if (cId === 0x05) {  // rxParamSetupReq
        // params: rx1DRoffset, rx2DR, frequency
        //         dlSettings
        if (params.rx1DRoffset > 7 || params.rx1DRoffset < 0)
            throw new RangeError('RX1DRoffset should be in between 0 to 7 if it is a number');
        if (params.rx2DR > 15 || params.rx2DR < 0)
            throw new RangeError('RX2DataRate should be in between 0 to 15 if it is a number');
        if (params.frequency > 16777215 || params.frequency < 0)
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
        dlSettings = params.rx2DR | (params.rx1DRoffset << 4);
        buf.push(params.dlSettings);
        buf.push((params.frequency >> 16) && 0xff);
        buf.push((params.frequency >> 8) && 0xff);
        buf.push(params.frequency && 0xff);
        // set MIC
        // [TODO] MIC generated with ?
        // [TODO] delay?
        return hal.send(buf);
    } else if (cId === 0x06) {  // devStatusReq
        // params: none
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
        return hal.send(buf);
    } else if (cId === 0x07) {  // newChannelReq
        // params: chIndex, frequency, maxDataRate, MinDataRate.drRange
        // [TODO] newChannelReq
        if (params.chIndex > 255 || params.chIndex < 0)
            throw new RangeError('ChIndex should be in between 0 to 255 if it is a number');
        if (params.frequency > 16777215 || params.frequency < 0)
            throw new RangeError('Frequency should be in between 0 to 16777215 if it is a number');
        if (params.maxDr > 15 || params.maxDr < 0)
            throw new RangeError('MaxDataRate should be in between 0 to 15 if it is a number');
        if (params.minDr > 15 || params.minDr < 0)
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
        buf.push(params.chIndex);
        buf.push((params.frequency >> 16) && 0xff);
        buf.push((params.frequency >> 8) && 0xff);
        buf.push(params.frequency && 0xff);
        drRange = params.MinDataRate | (params.MaxDataRate << 4);
        buf.push(params.drRange);
        // set MIC
        // [TODO] MIC generated with ?
        // [TODO] delay?
        return hal.send(buf);
    } else if (cId === 0x08) {  // rxTimingSetupReq
        // params: delay(unit: second)
        // [TODO] rxTimingSetupReq
        if (params.delay > 15 || params.delay < 0)
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
        buf.push(params.delay);
        // set MIC
        // [TODO] MIC generated with ?
        // [TODO] delay?
        return hal.send(buf);
    } else if (cId === 0x09) {  // txParamSetupReq
        // params: downlinkDwellTime, uplinkDwellTime, maxEIRP
        // Dwell Time: 0: no limit, 1 : 400 ms
        // [TODO] txParamSetupReq
        // [TODO] downlinkDwellTime, uplinkDwellTime should be set true or false
        if (params.maxEIRP > 15 || params.maxEIRP < 0)
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
        eirp_dwellTime = params.maxEIRP | (params.uplinkDwellTime << 4) | (params.dwonlinkDwellTime << 5);
        buf.push(eirp_dwellTime);
        // set MIC
        // [TODO] MIC generated with ?
        // [TODO] delay?
        return hal.send(buf);
    } else if (cId === 0x0a) {  // DIChannelReq
        // params: chIndex, frequency
        // [TODO] DIChannelReq
        if (params.chIndex > 255 || params.chIndex < 0)
            throw new RangeError('ChIndex should be in between 0 to 255 if it is a number');
        if (params.frequency > 16777215 || params.frequency < 0)
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
        buf.push(params.chIndex);
        // [TODO] frequency channel is 100 * frequency ?
        buf.push((params.frequency >> 16) && 0xff);
        buf.push((params.frequency >> 8) && 0xff);
        buf.push(params.frequency && 0xff);
        // set MIC
        // [TODO] MIC generated with ?
        // [TODO] delay?
        return hal.send(buf);
    }
    // [TODO] Class B MAC Command implement
};

NoraEndDeivce.prototype.write = function () {
    
};

NoraEndDeivce.prototype.read = function () {
    
};

NoraEndDeivce.prototype.find = function () {
    
};