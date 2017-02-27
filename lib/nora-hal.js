var util = require('util')
    EventEmitter = require('events');

var Q = require('q'),
    m = require('mraa'),
    _ = require('busyman');

var CNST = require('./constants.json'),
    OPMODE = CNST.OPMODE,
    REG = CNST.REG;

/*************************************************************************************************/
/*** Take care of Buffer API (new Buffer is deprecated since node v6.0.0)                      ***/
/*************************************************************************************************/
if (!_.isFunction(Buffer.alloc)) {
    Buffer.alloc = function (size, fill, encoding) {
        return new Buffer(size, fill, encoding);
    };
}

if (!_.isFunction(Buffer.from)) {
    Buffer.from = function (array) {
        return new Buffer(array);
    };
}
/*************************************************************************************************/

function Hal(spiCfg) {
    var self = this,
        propUnwritable = { writable: false, enumerable: false, configurable: false };

    // set up SPI interface
    spiCfg = spiCfg || {};

    if (!_.isPlainObject(spiCfg))
        throw new TypeError('spiCfg should be an object if given');

    spiCfg.bus = spiCfg.bus || 0;
    spiCfg.cs = spiCfg.cs || 0;
    spiCfg.mode = spiCfg.mode || 0;
    spiCfg.frequency = spiCfg.frequency || 2000000;

    Object.defineProperty(this, '_spi', _.assign({
        value: new m.Spi(spiCfg.bus, spiCfg.cs)
    }, propUnwritable));

    this._spi.mode(spiCfg.mode);
    this._spi.frequency(spiCfg.frequency);

    // a store for radio settings
    Object.defineProperty(this, 'radio', _.assign({
        value: {
            txPower: 14,
            freqMode: 1,
            frequency: 0x6c8000,
            bandwidth: 7,
            modulation: 1,
            headerMode: 0,
            codingRate: 1,
            spreadFactor: 6,
            ocpOn: 1,
            ocpTrim: 0x0b,
            syncWord: 0x12,
            payloadCrc: 0,
            preambleLength: 8
        }
    }, propUnwritable));

    // [TOTO] ??? Dont know what it means?
    // GPIO setting
    // TODO DIO Mapping function
    // _gpio = new m.Gpio(config.gpio.pin);
    // EDGE_NONE, EDGE_BOTH, EDGE_RISING, EDGE_FALLING
    // _gpio.isr(EDGE_BOTH, isrFunc);

    Object.defineProperty(this, '_rxInt', _.assign({
        value: new m.Gpio(RX_INT_PIN)   // [TODO] replace RX_INT_PIN number
    }, propUnwritable));

    // [TODO] pick one: EDGE_NONE, EDGE_BOTH, EDGE_RISING, EDGE_FALLING
    this._rxInt.isr(m.EDGE_BOTH, function () {
        self.read(0x40).then(function (dioMap1) {
            var rxFinished = !(dioMap1 & 0xc0);
            return rxFinished;  // still receiving: return false
        }).then(function (rxFinished) {
            if (!rxFinished)
                return;

            // rx finished, set fifoAddrPtr to 0x00
            self.write(REG.FIFOADDRPTR, 0x00).then(function () {
                return self.read(0x12);
            }).then(function (data) {
                var buf = [];
                if ((data && 0x20)) {                       // PayloadCrcError
                    return self.write(REG.IRQFLAGS, 0xff);  // clear IrqFlags
                } else {
                    // should use sequential reading
                    return self.read(REG.RXNBYTES).then(function (len) {
                        for (var i = 0;i < length;i = i + 1) {
                            self.read(REG.FIFO, function (err, data) {
                                buf.push(data.toString(16));
                            });
                        }
                    });

                    setImmediate(function () {
                        self.emit('_data', buf);
                    });
                }
            });
        });
    });

    // Events: _ready, _idle, _data, _error
}

util.inherits(Hal, EventEmitter);

Hal.prototype.config = function (settings) {
    /*settings: modulation, frequency, bandwidth, codeRate, spreadFactor, txPower
                overloadCurrent, crc, headerCrc, preambleLength, headerMode, 
                symbTimeout, maxPayloadLen, syncWord, delay1, delay2
    */
    var self = this,
        info = _.assign(this.info, settings);  // this.info contains the defualt settings

    // check txPower setting
    if (info.txPower > 16)
        throw new Error('The max power is limited to 16 dBm.');
    else if (info.txPower < -3)
        throw new Error('The min power is limited to -3 dBm.');

    var defaultMode = (OPMODE.SLEEP | (info.freqMode << 3) | (info.modulation << 7));

    // set modulation mode: LoRa, chip mode: idle
    //     frequency, txPower
    this.write(REG.OPMODE, defaultMode).then(function () {
        return self.idle();
    }).then(function () {
        var freqMSB = ((info.frequency >> 16) & 0xff);
            freqMID = ((info.frequency >> 8) & 0xff),
            freqLSB = (info.frequency && 0xff);

        return self.write(REG.FRFMSB, freqMSB).then(function () {
            return self.write(REG.FRFMID, freqMID);
        }).then(function () {
            return self.write(REG.FRFLSB, freqLSB);
        });
    }).then(function () {
        var isHighPower = self.info.txPower > 12 ? true : false,
            paSelect = isHighPower ? 1 : 0,
            maxPower = isHighPower ? 4 : 2,
            power = isHighPower ? self.info.txPower - 2 : self.info.txPower - (10.8 + 0.6 * pConfig.maxPower) + 15,
            paCfg = (paSelect << 7) | (maxPower << 4) | (power);

        return self.write(REG.PACONFIG, paCfg);
    }).then(function () {
        // set Bandwidth & Code Rate & Header Mode
        // set Spread Factor
        var modemBw = (this.bandwidth << 4) | (this.codingRate << 1) | (this.headerMode),
            modemSf = ((this.spreadFactor << 4) | (this.payloadCrc << 2));
        return self.write(REG.MODEMCONFIG1, modemBw).then(function () {
            return self.write(REG.MODEMCONFIG2, modemSf);
        });
    }).then(function () {
        // Detection Optimize & Detection Threshold
        if (self.spreadFactor !== 6) {
            return self.write(REG.DETECTOPTIOMIZE, 0x03).then(function () {
                return self.write(REG.DETECTTHRESHOLD, 0x0a);
            });
        } else {
            return self.write(REG.DETECTOPTIOMIZE, 0x05).then(function () {
                return self.write(REG.DETECTTHRESHOLD, 0x0c);
            });
        }
    }).then(function () {
        // Preamble Length
        this.preambleLength = this.preambleLength - 4;
        this.write(REG.PREAMBLEMSB, ((this.preambleLength >> 7) & 0xff));
        this.write(REG.PREAMBLELSB, (this.preambleLength & 0xff));
    }).then(function () {
        // set FIFO Address Pointer
        this.write(REG.FIFOADDRPTR, 0x00);
        // set FIFO TX Base Address
        this.write(REG.FIFOTXBASEADDR, 0x00);
        // set FIFO RX Base Address
        this.write(REG.FIFORXBASEADDR, 0x00);
    }).then(function () {
        // set syncWord
        this.write(REG.SYNCWORD, this.syncWord);
    }).then(function () {
        // set ocpOn & ocpTrim
        this.write(REG.OCP, (this.ocpOn << 5) | this.ocpTrim);
    }).done(function () {
        // [TODO] why?
        self.info.frequency = self.info.frequency * 61.035;
    });
}

Hal.prototype.start = function (callback) {
    var self = this,
        rxMode = (OPMODE.RXCONTINOUS | (this.freqMode << 3) | (this.modulation << 7));

    // set chip to Rx mode
    return this.write(REG.OPMODE, rxMode).then(function () {
        self.emit('_ready');
    }).nodeify(callback);
};

// [TODO] enter sleep or idle OPMODE?
Hal.prototype.idle = function (callback) {
    var self = this,
        idleMode = (OPMODE.IDLE | (this.freqMode << 3) | (this.modulation << 7));

    return this.write(REG.OPMODE, idleMode).then(function () {
        self.emit('_idle');
    }).nodeify(callback);
};

Hal.prototype.send = function (buf, callback) {
    var deferred = Q.defer(),
        hal = this,
        seqCalls = [],
        bufLen;

    if (!Buffer.isBuffer(buf))
        throw new TypeError('buf must be a buffer');

    bufLen = buf.length;

    if (bufLen === 0)
        deferred.resolve(bufLen);

    seqCalls.push(function () {
        return hal.write(REG.FIFOADDRPTR, 0x00);    // set fifoAddrPtr 0x00
    });
    
    while (bufLen !== 0) {  // writing data
        seqCalls.push(function () {
            return hal.write(REG.FIFO, 0x00);    // set fifoAddrPtr 0x00
        });
        bufLen -= 1;
    }

    // start writing data
    for (var i = 0; i < bufLen; i = i + 1) {
        seqCalls.push(function () {
            var oneByte = data[i];  // CLOSURE: save each data[i], don't use write(REG.FIFO, data[i])
            return hal.write(REG.FIFO, oneByte);
        });
    }

    seqCalls.push(function () {
        var setting = ((hal.modulation << 7) | (hal.freqMode << 3) | OPMODE.TX)
        return hal.write(REG.OPMODE, setting);  // set chip tx mode
    });

    // check txDone
    // _gpio.isr(EDGE_BOTH, function () {
        this.read(REG.IRQFLAGS, function (err, data) {
            data = data & 0x04;
            if (data === 0x04) {
                // set fifoAddrPtr 0x00
                this.write(REG.FIFOADDRPTR, 0x00);
                // clear IrqFlags
                this.write(REG.IRQFLAGS, 0xff);
                // set chip rx mode
                this.write(REG.OPMODE, ((this.modulation << 7) | (this.freqMode << 3) | OPMODE.RXCONTINOUS));
            }
        });
    // });

    setImmediate(callback, null);
    return deferred.promise.nodeify(callback);
}

// [TODO]
Hal.prototype._isOtaTxFinished = function (callback) {
    var deferred = Q.defer(),
        hal = this;

    function isFinished(cb) {

    }

    function clear() {
        // set fifoAddrPtr 0x00
        hal.write(REG.FIFOADDRPTR, 0x00);
        // clear IrqFlags
        hal.write(REG.IRQFLAGS, 0xff);
        // set chip rx mode
        hal.write(REG.OPMODE, ((this.modulation << 7) | (this.freqMode << 3) | OPMODE.RXCONTINOUS));
    }

    hal.read(REG.IRQFLAGS, function (err, data) {
        var isFinished = !!(data & 0x04);
        if (isFinished)
            clear();
        else


    });


    isFinished(function (finished) {
        if (finished) {

        } else {
            setTimeout(isFinished, 1000);
        }
    });

    this.read(REG.IRQFLAGS, function (err, data) {
        var txFinished = 
        data = data & 0x04;
        if (data & 0x04) {
            // set fifoAddrPtr 0x00
            this.write(REG.FIFOADDRPTR, 0x00);
            // clear IrqFlags
            this.write(REG.IRQFLAGS, 0xff);
            // set chip rx mode
            this.write(REG.OPMODE, ((this.modulation << 7) | (this.freqMode << 3) | OPMODE.RXCONTINOUS));
        }
    });

    return deferred.promise.nodeify(callback);
};

Hal.prototype.read = function (address, callback) {
    var _spi = this._spi,
        txBuf = Buffer.alloc(2);

    txBuf[0] = (address &= 0x7f);   // msb: 1(write), 0(read)
    txBuf[1] = 0x00;                // dummy data when reading

    return Q.fcall(function () {
        var rxBuf = _spi.write(txBuf);
        return rxBuf[1];
    }).nodeify(callback);
};

Hal.prototype.write = function (address, data, callback) {
    var _spi = this._spi,
        txBuf = Buffer.alloc(2);

    txBuf[0] = (address |= 0x80);   // msb: 1(write), 0(read)

    if (_.isNumber(data)) {
        txBuf[1] = data;
    } else if (_.isBuffer(data)) {
        if (data.length !== 1)
            throw new Error('data should be a single byte to write out');
        else
            txBuf[1] = data;
    } else {
        throw new TypeError('data must be a number or a buffer');
    }

//==> I don't know what it means? data is an object? but object is not an ordered collection
    //     _.forEach(data, function (val, key) {
    //         value = value | (val.value << len);
    //         len = len + val.bitNumber;
    //     });
    //     buf[1] = value;
    // }

    return Q.fcall(function () {
        _spi.write(txBuf);
        return 1;
    }).nodeify(callback);
}

/*************************************************************************************************/
/*** Private Function                                                                          ***/
/*************************************************************************************************/

module.exports = Hal;
