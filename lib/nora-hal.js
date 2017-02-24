var m = require('mraa'),
    defs = require('./defs.json'),
    _ = require('busyman'),
    util = require('util'),
    EventEmitter = require('events').EventEmitter,
    Q = require('q');

var _spi,
    _gpio,
    OPMODE = defs.OPMODE,
    REG = defs.REG;

function Hal(config) {
    var self = this,
        spi = {
            bus: 0,
            cs: 0,
            mode: 0,
            frequency: 2000000
        };

    spi.bus = config.spi.bus || spi.bus;
    spi.cs = config.spi.cs || spi.cs;
    spi.mode = config.spi.mode || spi.mode;
    spi.frequency = config.spi.frequency || spi.frequency;
    // spi settings
    _spi = new m.Spi(spi.bus, spi.cs);
    _spi.mode(spi.mode);
    _spi.frequency(spi.frequency);

    // GPIO setting
    // TODO DIO Mapping function
    // _gpio = new m.Gpio(config.gpio.pin);
    // EDGE_NONE, EDGE_BOTH, EDGE_RISING, EDGE_FALLING
    // _gpio.isr(EDGE_BOTH, isrFunc);

    function isrFunc() {
        this.read(0x40, function (err, data) {
            data = data & 0xc0;
            if (data === 0x00) {
                //RxDone
                // set fifoAddrPtr 0x00
                this.write(REG.FIFOADDRPTR, 0x00);
                this.read(0x12, function (err, data) {
                    if ((data && 0x20)) {
                        // PayloadCrcError
                        // clear IrqFlags
                        this.write(REG.IRQFLAGS, 0xff);
                    } else {
                        var buf = [];
                        this.read(REG.RXNBYTES, function (err, length) {
                            for (var i = 0;i < length;i = i + 1) {
                                this.read(REG.FIFO, function (err, data) {
                                    buf.push(data.toString(16));
                                });
                            }
                        });
                        setImmediate(function () {
                            self.emit('_data', buf);
                        });
                    }
                });
            }
        });
    }

    this.on('_ready', function () {
        setImmediate(function () {
            self.emit('ready');
        });
    });

    this.on('_idle', function () {
        setImmediate(function () {
            self.emit('idle');
        });
    });

    this.on('_data', function (msg) {
        setImmediate(function () {
            self.emit('data', msg);
        });
    });

    // this.on('_error', function () {
    //     setImmediate(function () {
    //         self.emit('error');
    //     });
    // });
}

util.inherits(Hal, EventEmitter);

Hal.prototype.config = function (settings) {
    /*settings: modulation, frequency, bandwidth, codeRate, spreadFactor, txPower
                overloadCurrent, crc, headerCrc, preambleLength, headerMode, 
                symbTimeout, maxPayloadLen, syncWord, delay1, delay2
*/
var pConfig = {
        paSelect: 0,
        maxPower: 4,
        power: 16
    };
    this.modulation = settings.modulation || 1;
    this.headerMode = settings.headerMode || 0;
    this.frequency = settings.frequency || 0x6c8000;
    this.txPower = settings.txPower || 14;
    this.spreadFactor = settings.spreadFactor || 6;
    this.codingRate = settings.codingRate || 1;
    this.bandwidth = settings.bandwidth || 7;
    this.payloadCrc = settings.payloadCrc || 0;
    this.preambleLength = settings.preambleLength || 8;
    this.syncWord = settings.syncWord || 0x12;
    this.ocpOn = settings.ocpOn || 1;
    this.ocpTrim = settings.ocpTrim || 0x0b;
    this.freqMode = settings.freqMode || 1;

    // set modulation mode: LoRa, chip mode: idle
    this.write(REG.OPMODE, (OPMODE.SLEEP | (this.freqMode << 3) | (this.modulation << 7)));
    this.idle();

    // set frequency
    this.write(REG.FRFMSB, ((this.frequency >> 16) & 0xff));
    this.write(REG.FRFMID, ((this.frequency >> 8) & 0xff));
    this.write(REG.FRFLSB, (this.frequency && 0xff));

    this.frequency = this.frequency * 61.035;

    // set txPower
    if (this.txPower > 20) {
        throw new Error('The max power is limited to 20 dBm.');
    } else if (this.txPower < -3) {
        throw new Error('The min power is limited to -3 dBm.');
    }

    if (this.txPower < 12) {
        pConfig.paSelect = 0;
        pConfig.maxPower = 2;
        pConfig.power = this.txPower - (10.8 + 0.6 * pConfig.maxPower) + 15;
    } else if (this.txPower >= 12) {
        pConfig.paSelect = 1;
        pConfig.power = this.txPower - 2;
    } else if ((this.txPower > 16) && (this.txPower < 20)) {
        throw new Error('The ' + this.txPower + ' dBm can not be set.');
    }
    config = (pConfig.paSelect << 7) | (pConfig.maxPower << 4) | (pConfig.power);
    this.write(REG.PACONFIG, config);
    // set Bandwidth & Code Rate & Header Mode
    this.write(REG.MODEMCONFIG1, (this.bandwidth << 4) | (this.codingRate << 1) | (this.headerMode));
    // set Spread Factor
    this.write(REG.MODEMCONFIG2, ((this.spreadFactor << 4) | (this.payloadCrc << 2)));
    // Detection Optimize & Detection Threshold
    if (this.spreadFactor !== 6) {
        this.write(REG.DETECTOPTIOMIZE, 0x03);
        this.write(REG.DETECTTHRESHOLD, 0x0a);
    } else {
        this.write(REG.DETECTOPTIOMIZE, 0x05);
        this.write(REG.DETECTTHRESHOLD, 0x0c);
    }
    // Preamble Length
    this.preambleLength = this.preambleLength - 4;
    this.write(REG.PREAMBLEMSB, ((this.preambleLength >> 7) & 0xff));
    this.write(REG.PREAMBLELSB, (this.preambleLength & 0xff));
    // set FIFO Address Pointer
    this.write(REG.FIFOADDRPTR, 0x00);
    // set FIFO TX Base Address
    this.write(REG.FIFOTXBASEADDR, 0x00);
    // set FIFO RX Base Address
    this.write(REG.FIFORXBASEADDR, 0x00);
    // set syncWord
    this.write(REG.SYNCWORD, this.syncWord);
    // set ocpOn & ocpTrim
    this.write(REG.OCP, (this.ocpOn << 5) | this.ocpTrim);
}

Hal.prototype.start = function (callback) {
    var self = this,
        deferred = Q.defer();
    // set chip to Rx mode
    this.write(REG.OPMODE, (OPMODE.RXCONTINOUS | (this.freqMode << 3) | (this.modulation << 7)));
    setImmediate(function () {
        self.emit('_ready');
    });

    return deferred.promise.nodeify(callback);
}

Hal.prototype.idle = function (callback) {
    var self = this,
        deferred = Q.defer();

    this.write(REG.OPMODE, (OPMODE.IDLE | (this.freqMode << 3) | (this.modulation << 7)), function (err) {

        self.emit('_idle');
        deferred.reject(null);
    });
    // setImmediate(callback, null);

    return deferred.promise.nodeify(callback);
}

Hal.prototype.send = function (data, callback) {
    // set fifoAddrPtr 0x00
    this.write(REG.FIFOADDRPTR, 0x00);
    // write data
    for (var i = 0;i < data.length;i = i + 1) {
        this.write(REG.FIFO, data[i]);
    }
    // set chip tx mode
    this.write(REG.OPMODE, ((this.modulation << 7) | (this.freqMode << 3) | OPMODE.TX));

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
}

Hal.prototype.read = function (address, callback) {
    var buf = new Buffer(2),
        value;

    address &= 0x7f;
    buf[0] = address;
    buf[1] = 0x00;
    value = _spi.write(buf);

    setImmediate(callback, null, value[1]);
}


Hal.prototype.write = function (address, data) {
    var buf = new Buffer(2),
        len = 0,
        value,
        deferred = Q.defer();

    address |= 0x80;
    buf[0] = address;

    if(_.isNumber(data)) {
        buf[1] = data;
    } else {
        _.forEach(data, function (val, key) {
            value = value | (val.value << len);
            len = len + val.bitNumber;
        });
        buf[1] = value;
    }

    setImmediate(function () {
        _spi.write(buf);
    });
}
/*****************************************/
/*           Private function            */
/*****************************************/


module.exports = Hal;
