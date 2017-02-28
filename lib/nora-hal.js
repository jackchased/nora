var util = require('util'),
    EventEmitter = require('events');

var Q = require('q'),
    m = require('mraa'),
    _ = require('busyman');

var CNST = require('./constants.json'),
    OPMODE = CNST.OPMODE,
    REG = CNST.REG;

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

function Hal(spiCfg, rxIntPin) {
    var self = this,
        defaultRxIntPin = 14,   // [TODO] give this pin for RPi2
        propUnwritable = { writable: false, enumerable: false, configurable: false };

    // members:
    //  this._state : 'unknown', 'idle', 'tx', 'rx', 'sleep'
    //  this._spi   : holds spi instance of mraa
    //  this._rxInt : a mraa gpio of RX interrupt
    //  this.radio  : information about the radio chip

    Object.defineProperty(this, '_state', _.assign({
        value: 'unknown'
    }, propUnwritable));

    if (_.isNumber(spiCfg)) {
        rxIntPin = spiCfg;
        spiCfg = undefined;
    }

    spiCfg = spiCfg || {};
    rxIntPin = rxIntPin || defaultRxIntPin;

    if (!_.isPlainObject(spiCfg))
        throw new TypeError('spiCfg should be an object if given');
    else if (!_.isNumber(rxIntPin))
        throw new TypeError('rxIntPin should be a number if given');

    spiCfg.bus = spiCfg.bus || 0;
    spiCfg.cs = spiCfg.cs || 0;
    spiCfg.mode = spiCfg.mode || 0;
    spiCfg.frequency = spiCfg.frequency || 2000000;

    Object.defineProperty(this, '_spi', _.assign({
        value: new m.Spi(spiCfg.bus, spiCfg.cs)
    }, propUnwritable));

    this._spi.mode(spiCfg.mode);
    this._spi.frequency(spiCfg.frequency);

    // set up the gpio for rx interrupt
    Object.defineProperty(this, '_rxInt', _.assign({
        value: new m.Gpio(rxIntPin)
    }, propUnwritable));

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

    // [TODO] pick one: EDGE_NONE, EDGE_BOTH, EDGE_RISING, EDGE_FALLING
    this._rxInt.isr(m.EDGE_BOTH, _otaRxIsr.bind(this));

    // Events: ready, idle, data, _error
}

util.inherits(Hal, EventEmitter);

/*************************************************************************************************/
/*** Public APIs                                                                               ***/
/*************************************************************************************************/
Hal.prototype.config = function (settings, callback) {
    /* settings: modulation, frequency, bandwidth, codeRate, spreadFactor, txPower
                 overloadCurrent, crc, headerCrc, preambleLength, headerMode, 
                 symbTimeout, maxPayloadLen, syncWord, delay1, delay2               */

    var self = this,
        deferred = Q.defer();

    if (this._state === 'unknown') {
        // config at very first time
        this._initChip(settings).then(function () {
            self._nextState('idle');    // [TODO] change state to ??? after first time iniitialzation
        }).done(deferred.resolve, deferred.reject);
    } else {
        // [TODO] really? cannot config at run time? I guess, but not sure.
        deferred.reject(new Error('Chip cannot be configured at runtime'));
    }

    return deferred.promise.nodeify(callback);
};

Hal.prototype.start = function (callback) {
    var self = this,
        radio = this.radio,
        rxMode = (OPMODE.RXCONTINOUS | (radio.freqMode << 3) | (radio.modulation << 7));

    // set chip to Rx mode
    return this.write(REG.OPMODE, rxMode).then(function () {
        var prevState = this._state;
        self._nextState('rx');

        if (prevState === 'unknown')
            self.emit('ready');
    }).nodeify(callback);
};

// [TODO] enter sleep or idle OPMODE?
Hal.prototype.idle = function (callback) {
    var self = this,
        idleMode = (OPMODE.IDLE | (this.freqMode << 3) | (this.modulation << 7));

    return this.write(REG.OPMODE, idleMode).then(function () {
        return self._nextState('idle');
    }).nodeify(callback);
};

// OTA Trasmitting
Hal.prototype.send = function (buf, callback) {
    var self = this,
        deferred = Q.defer(),
        bufLen,
        seqCalls = [],
        currentBufPos = 0;

    if (!Buffer.isBuffer(buf))
        throw new TypeError('buf must be a buffer');

    bufLen = buf.length;

    if (bufLen === 0)   // no need to send
        deferred.resolve(bufLen);

    seqCalls.push(function () {
        return self.write(REG.FIFOADDRPTR, 0x00);    // set fifoAddrPtr 0x00
    });
    
    // arrange writing functions of each byte
    for (var i = 0; i < bufLen; i++) {
        seqCalls.push(function () {
            var thisByte = buf[currentBufPos];
            currentBufPos += 1;
            return self.write(REG.FIFO, thisByte);
        });
    }

    seqCalls.push(function () {
        var setting = ((self.radio.modulation << 7) | (self.radio.freqMode << 3) | OPMODE.TX);

        self._nextState('tx');
        return self.write(REG.OPMODE, setting);  // set chip to tx mode
    });

    seqCalls.reduce(function (soFar, f) {
        return soFar.then(f);
    }, Q(0)).then(function () {
        return self._otaTxFinished();
    }).fail(function (err) {
        deferred.reject(err);
    }).done(function () {
        deferred.resolve(bufLen);
    });

    return deferred.promise.nodeify(callback);
};

Hal.prototype.read = function (address, callback) {
    var _spi = this._spi,
        txBuf = Buffer.alloc(2);

    if (!_.isNumber(address))
        throw new TypeError('address should be a number');
    else if (address < 0 || address > 255)
        throw new RangeError('address should be an integer in between 0 and 255');

    txBuf[0] = (address &= 0x7f);   // msb: 1(write), 0(read)
    txBuf[1] = 0x00;                // dummy data when reading

    return Q.fcall(function () {
        var rxBuf = _spi.write(txBuf);
        return rxBuf[1];    // number
    }).nodeify(callback);
};

Hal.prototype.write = function (address, data, callback) {
    var _spi = this._spi,
        txBuf = Buffer.alloc(2);

    if (!_.isNumber(address))
        throw new TypeError('address should be a number');
    else if (address < 0 || address > 255)
        throw new RangeError('address should be an integer in between 0 and 255');

    txBuf[0] = (address |= 0x80);   // msb: 1(write), 0(read)

    if (_.isNumber(data)) {
        if (data > 255 || data < 0)
            throw new RangeError('data should be in between 0 to 255 if it is a number');
        txBuf[1] = data;            // will be auto transformed to an integer if it is a float number
    } else if (_.isBuffer(data)) {
        if (data.length !== 1)
            throw new Error('data should be a single byte to write out');
        else
            txBuf[1] = data.readUInt8(0);
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
        return txBuf.length;
    }).nodeify(callback);
};

/*************************************************************************************************/
/*** Protected APIs                                                                            ***/
/*************************************************************************************************/
Hal.prototype._nextState = function (state) {
    //  this._state : 'unknown', 'idle', 'tx', 'rx', 'sleep'
    this._state = state;
    self.emit(state);
};

Hal.prototype._initChip = function (settings, callback) {
    var self = this,
        radio = _.assign(this.radio, settings), // radio contains the defualt/current settings
        defaultMode = (OPMODE.SLEEP | (radio.freqMode << 3) | (radio.modulation << 7));

    if (radio.txPower > 16)
        radio.txPower = 16;
    else if (radio.txPower < -3)
        radio.txPower = -3;

    // set modulation mode: LoRa, chip mode: idle
    //     frequency, txPower
    return this.write(REG.OPMODE, defaultMode).then(function () {
        // [TODO] default mode is sleep or idele?
        return self.idle();
    }).then(function () {
        var freqMSB = ((radio.frequency >> 16) & 0xff);
            freqMID = ((radio.frequency >> 8) & 0xff),
            freqLSB = (radio.frequency && 0xff);

        return self.write(REG.FRFMSB, freqMSB).then(function () {
            return self.write(REG.FRFMID, freqMID);
        }).then(function () {
            return self.write(REG.FRFLSB, freqLSB);
        });
    }).then(function () {
        var isHighPower = radio.txPower > 12 ? true : false,
            paSelect = isHighPower ? 1 : 0,
            maxPower = isHighPower ? 4 : 2,
            power = isHighPower ? radio.txPower - 2 : radio.txPower - (10.8 + 0.6 * maxPower) + 15,
            paCfg = (paSelect << 7) | (maxPower << 4) | (power);

        return self.write(REG.PACONFIG, paCfg);
    }).then(function () {
        // set Bandwidth & Code Rate & Header Mode
        var modemBw = (radio.bandwidth << 4) | (radio.codingRate << 1) | (radio.headerMode);
        return self.write(REG.MODEMCONFIG1, modemBw);
    }).then(function () {
        // set Spread Factor
        var modemSf = ((radio.spreadFactor << 4) | (radio.payloadCrc << 2));
        return self.write(REG.MODEMCONFIG2, modemSf);
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
        radio.preambleLength = radio.preambleLength - 4;    // [TODO] why?
        // var pembLen = radio.preambleLength - 4;
        return self.write(REG.PREAMBLEMSB, ((radio.preambleLength >> 7) & 0xff)).then(function () {
            return self.write(REG.PREAMBLELSB, (radio.preambleLength & 0xff));
        });
    }).then(function () {
        // set FIFO Address Pointer
        return self.write(REG.FIFOADDRPTR, 0x00);
    }).then(function () {
        // set FIFO TX Base Address
        return self.write(REG.FIFOTXBASEADDR, 0x00);
    }).then(function () {
        // set FIFO RX Base Address
        return self.write(REG.FIFORXBASEADDR, 0x00);
    }).then(function () {
        // set syncWord
        return self.write(REG.SYNCWORD, radio.syncWord);
    }).then(function () {
        // set ocpOn & ocpTrim
        return self.write(REG.OCP, (radio.ocpOn << 5) | radio.ocpTrim);
    }).then(function () {
        // [TODO] why?
        self.radio.frequency = radio.frequency * 61.035;
    }).nodeify(callback);
};


// [TODO] check irqFlags? Behavior needs to be confirmed
Hal.prototype._otaTxFinished = function (callback) {
    // var deferred = Q.defer(),
    //     hal = this;

    // function isFinished(cb) {

    // }

    // function clear() {
    //     // set fifoAddrPtr 0x00
    //     hal.write(REG.FIFOADDRPTR, 0x00);
    //     // clear IrqFlags
    //     hal.write(REG.IRQFLAGS, 0xff);
    //     // set chip rx mode
    //     hal.write(REG.OPMODE, ((this.modulation << 7) | (this.freqMode << 3) | OPMODE.RXCONTINOUS));
    // }

    // hal.read(REG.IRQFLAGS, function (err, data) {
    //     var isFinished = !!(data & 0x04);
    //     if (isFinished)
    //         clear();
    //     else


    // });


    // isFinished(function (finished) {
    //     if (finished) {

    //     } else {
    //         setTimeout(isFinished, 1000);
    //     }
    // });

    // this.read(REG.IRQFLAGS, function (err, irqFlags) {
    //     var txFinished = 
    //     data = data & 0x04;
    //     if (data & 0x04) {
    //         // set fifoAddrPtr 0x00
    //         this.write(REG.FIFOADDRPTR, 0x00);
    //         // clear IrqFlags
    //         this.write(REG.IRQFLAGS, 0xff);
    //         // set chip rx mode
    //         this.write(REG.OPMODE, ((this.modulation << 7) | (this.freqMode << 3) | OPMODE.RXCONTINOUS));
    //     }
    // });

    // return deferred.promise.nodeify(callback);
};


/*************************************************************************************************/
/*** Private Functions                                                                         ***/
/*************************************************************************************************/
function _otaRxIsr() {
    var self = this,
        rxBuf;

    // checks if rx finished
    this.read(REG.DIOMAP1).then(function (dioMap1) {    // REG.DIOMAP1 = 0x40
        var isRxFinished = !(dioMap1 & 0xc0);

        if (!isRxFinished)  // still receiving, just return
            return;

        // rx finished, set fifoAddrPtr to 0x00
        self.write(REG.FIFOADDRPTR, 0x00).then(function () {
            return self.read(0x12); // [TODO] why read from 0x12 = 18 = IRQFLAGS???
        }).then(function (irqFlags) {
            var isPayloadCrcError = irqFlags && 0x20,

                rxByteReaders = [];

            if (isPayloadCrcError)
                return self.write(REG.IRQFLAGS, 0xff);  // just clear IrqFlags, no need to read further
            else
                rxBuf = [];

            self.read(REG.RXNBYTES).then(function (len) {
                for (var i = 0; i < len; i++) {
                    rxByteReaders.push(function () {
                        return self.read(REG.FIFO).then(function (byte) {
                            rxBuf.push(byte);   // byte is an uint8 interger
                        });
                    });
                }

                return rxByteReaders.reduce(function (soFar, f) {
                    return soFar.then(f);
                }, Q(0));
            }).fail(function () {
                // do nothing if error occurs while reading
            }).done(function () {
                self.emit('data', rxBuf);
            });
        }).done();
    });
};

module.exports = Hal;
