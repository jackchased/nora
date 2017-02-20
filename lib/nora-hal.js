var m = require('mraa'),
    defs = require('./defs.json'),
    config = require('./config.js'),
    _ = require('busyman'),
    Q = require('q');

var _spi = new m.Spi(0, 0),
    OPMODE = defs.OPMODE,
    REG = defs.REG;



function Hal () {
    this.modulation = defs.LONGRANGEMODE.LORA
    this.mode = 0;
    this.frequency = 923400000;
    this.txPower = 15;
};

Hal.prototype.config = function (settings) {
    /*settings: modulationMode, frequency, bandwidth, codeRate, spreadFactor, txPower
                overloadCurrent, crc, headerCrc, preambleLength, headerMode, 
                symbTimeout, maxPayloadLen, syncWord, delay1, delay2
*/
var pConfig = {
        paSelect : 0,
        maxPower : 4,
        power : 16
    },
    frequency = settings.frequency;
    txPower = settings.txPower;


    // set modulation mode: LoRa, chip mode: idle
    this.sleep();
    this.idle();

    // set frequency
    frequency = frequency / 61.035;
    frequency.toFixed();
    this.write(REG.FRFMSB, (7, (frequency >> 16) & 0xff));
    this.write(REG.FRFMID, ((frequency >> 8) & 0xff));
    this.write(REG.FRFLSB, (frequency && 0xff));

    this.frequency = settings.frequency;

    // set txPower
    if (txPower > 20) {
        throw new Error('The max power is limited to 20 dBm.');
    } else if (txPower < -3) {
        throw new Error('The min power is limited to -3 dBm.');
    }

    if (txPower < 12) {
        pConfig.paSelect = 0;
        pConfig.maxPower = 2;
        pConfig.power = txPower - (10.8 + 0.6 * pConfig.maxPower) + 15;
    } else if (power >= 12) {
        pConfig.paSelect = 1;
        pConfig.power = power - 2;
    } else if ((txPower > 16) && (txPower < 20)) {
        throw new Error('The ' + txPower + ' dBm can not be set.');
    }
    config = (pConfig.paSelect << 7) | (pConfig.maxPower << 4) | (pConfig.power);
    this.write(REG.PACONFIG, config);
    this.txPower = settings.txPower;
}

Hal.prototype.idle = function () {
    var idleMode = [
        {bitNumber: 3, value: 1},
        {bitNumber: 1, value: 0},
        {bitNumber: 2, value: 0},
        {bitNumber: 1, value: 0},
        {bitNumber: 1, value: this.modulation}
    ];
    this.write(REG.OPMODE, OPMODE.IDLE);
    this.mode = OPMODE.IDLE;

    this.emit('idle');
}

Hal.prototype.sleep = function () {
    var sleepMode = [
        {bitNumber: 3, value: 0},
        {bitNumber: 1, value: 0},
        {bitNumber: 2, value: 0},
        {bitNumber: 1, value: 0},
        {bitNumber: 1, value: this.modulation}
    ];
    this.write(REG.OPMODE, OPMODE.SLEEP);
    this.mode = OPMODE.SLEEP;

    this.emit('sleep');
}

Hal.prototype.read = function (address, data, callback) {
    var buf = new Buffer(2),
        value,
        len = 0,
        info = {
            name: [],
            value: []
        }};

    address &= 0x7f;
    buf[0] = address;
    buf[1] = 0x00;
    value = _spi.write(buf);

    _.forEach(data, function (val, key) {
        info.name.push(val.name);
        info.value.push((value[1] >> len) & (Math.pow(2, val.bitNumber) - 1));
        len = len + val.bitNumber;
    });

    setImmediate(callback, null, info);
}


Hal.prototype.write = function (address, data) {
    var buf = new Buffer(2),
        len = 0,
        value;

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
    
    

    _spi.write(buf);
}

Hal.prototype.fifo = function (attr, data, callback) {
    var attrStr = attr.valueOf(),
        value;

    if (typeof attr !== 'string')
        throw new Error('attr should be a string.');

    if (attrStr !== 'r' && attrStr !== 'w' && attrStr !== 'w' && attrStr !== 'R' && attrStr !== 'W')
        throw new Error('attr should be r/R or w/W');

    if (attrStr === 'w' || attrStr === 'W') {
        this._spiAttr(attrStr, REG.FIFO, data);
    } else if (attrStr === 'r' || attrStr === 'R') {
        callback = data;
        value = this._spiAttr(attrStr, REG.FIFO);

        setImmediate(callback, null, value);
    }
}

Hal.prototype.opMode = function (attr, config, callback) {
    var attrStr = attr.valueOf(),
        buf,
        value;

    if (typeof attr !== 'string')
        throw new Error('attr should be a string.');

    if (attrStr !== 'r' && attrStr !== 'w' && attrStr !== 'w' && attrStr !== 'R' && attrStr !== 'W')
        throw new Error('attr should be r/R or w/W');

    if ((attrStr === 'r' || attrStr === 'R') && arguments.length > 2) {
        throw new Error('Read command have bad arguments.');
    } else if ((attrStr === 'w' || attrStr === 'W') && arguments.length !== 2) {
        throw new Error('Write command is only 2 arguments.');
    }

    if (attrStr === 'w' || attrStr === 'W') {
        buf = (config.longRangeMode << 7) | (config.accSharedReg << 6) | (config.freqMode << 3) | (config.mode);
        this._spiAttr(attrStr, REG.OPMODE, buf);
    } else if (attrStr === 'r' || attrStr === 'R') {
        callback = config;
        value = this._spiAttr(attrStr, REG.OPMODE);

        setImmediate(callback, null, value);
    }
}

Hal.prototype.freq = function (attr, frequency, callback) {
    var attrStr = attr.valueOf(),
        freq,
        value = 0;

    if (typeof attr !== 'string')
        throw new Error('attr should be a string.');

    if (attrStr !== 'r' && attrStr !== 'w' && attrStr !== 'w' && attrStr !== 'R' && attrStr !== 'W')
        throw new Error('attr should be r/R or w/W');

    if (attrStr === 'w' || attrStr === 'W') {
        if (typeof frequency !== 'number')
            throw new Error('frequency should be a number.');

        frequency = frequency / 61.035;
        frequency.toFixed();
        this._spiAttr(attrStr, REG.FRFMSB, ((frequency >> 16) & 0xff));
        this._spiAttr(attrStr, REG.FRFMID, ((frequency >> 8) & 0xff));
        this._spiAttr(attrStr, REG.FRFLSB, (frequency && 0xff));
    } else if (attrStr === 'r' || attrStr === 'R') {
        callback = frequency;

        freq = this._spiAttr(attrStr, REG.FRFMSB);
        value = freq << 16;
        freq = this._spiAttr(attrStr, REG.FRFMID);
        value = value + (freq << 8);
        freq = this._spiAttr(attrStr, REG.FRFLSB);
        value = value + freq;
        value *= 61.035;

        setImmediate(callback, null, value);
    }
}

Hal.prototype.txPower = function (attr, power, callback) {
    var attrStr = attr.valueOf(),
        buf = {
            paSelect : 0,
            maxPower : 4,
            power : 16
        },
        value;

    if (typeof attr !== 'string')
        throw new Error('attr should be a string.');

    if (attrStr !== 'r' && attrStr !== 'w' && attrStr !== 'R' && attrStr !== 'W')
        throw new Error('attr should be r/R or w/W');

    if (attrStr === 'w' || attrStr === 'W') {
        if (power > 20) {
            throw new Error('The max power is limited to 20 dBm.');
        } else if (power < -3) {
            throw new Error('The min power is limited to -3 dBm.');
        }

        if (power < 12) {
            buf.paSelect = 0;
            buf.maxPower = 2;
            buf.power = power - (10.8 + 0.6 * buf.maxPower) + 15;
        } else if (power >= 12) {
            buf.paSelect = 1;
            buf.power = power - 2;
        } else if ((power > 16) && (power < 20)) {
            throw new Error('The ' + power + ' dBm can not be set.');
        }

        config = (buf.paSelect << 7) | (buf.maxPower << 4) | (buf.power);
        this._spiAttr(attrStr, REG.PACONFIG, config);

    } else if (attrStr === 'r' || attrStr === 'R') {
        callback = power;
        value = this._spiAttr(attrStr, REG.PACONFIG);
        buf.paSelect = (value >> 7) & 0x01;
        buf.maxPower = (value >> 4) & 0x07;
        buf.power = value & 0x0f;

        if (buf.paSelect) {
            value = 17 - (15 - buf.power);
        } else {
            value = (10.8 + buf.maxPower * 0.6) - (15 - buf.power);
        }

        setImmediate(callback, null, value);
    }
}

Hal.prototype.currentProtect = function (attr, config, callback) {
    var attrStr = attr.valueOf(),
        buf = {
            option : true,
            value : 0x0b
        },
        value;

    if (typeof attr !== 'string')
        throw new Error('attr should be a string.');

    if (attrStr !== 'r' && attrStr !== 'w' && attrStr !== 'R' && attrStr !== 'W')
        throw new Error('attr should be r/R or w/W');

    if (attrStr === 'w' || attrStr === 'W') {

        buf.option = config.option;
        buf.value = config.value;

        config = (buf.ocpOption << 5) | (buf.value);
        this._spiAttr(attrStr, REG.OCP, config);

    } else if (attrStr === 'r' || attrStr === 'R') {
        callback = config;
        value = this._spiAttr(attrStr, REG.OCP);

        buf.option = (value >> 5) & 0x01;
        value = value & 0x1f;

        if (value <= 15) {
            buf.value = 45 + 5 * value;
        } else if (value <= 27) {
            buf.value = -30 + 10 * value;
        } else {
            buf.value = 240;
        }

        setImmediate(callback, null, buf);
    }
}

/******************************************************/
/*              private functions                     */
/******************************************************/
Hal.prototype._spiAttr = function (attr, address, data) {

        if (attr === 'r' || attr === 'R') {
            address &= 0x7f;
            return this._read(address);
        } else if (attr === 'w' | attr === 'W' ) {
            address |= 0x80;
            this._write(address, data);
        }
}

Hal.prototype._read = function (address) {
    var buf = new Buffer(2);

    buf[0] = address;
    buf[1] = 0x00;
    value = _spi.write(buf);

    return value[1];
}

Hal.prototype._write = function (address, data) {
    var buf = new Buffer(2);

    buf[0] = address;
    buf[1] = data;

    _spi.write(buf);
}

Hal.prototype._checkAttr = function (attr) {
    var attrStr = attr.valueOf();

    if (typeof attr !== 'string')
        throw new Error('attr should be a string.');

    if (attrStr !== 'r' && attrStr !== 'w' && attrStr !== 'w' && attrStr !== 'R' && attrStr !== 'W')
        throw new Error('attr should be r/R or w/W');
}

/*
Hal.prototype.opMode = function (attr, config, callback) {

	var defered = Q.defer(),
		attrStr = attr.valueOf(),
		value,
		data;

	if (typeof attr !== 'string')
		throw new Error('attr should be a string.');

	if (attrStr !== 'r' && attrStr !== 'w' && attrStr !== 'w' && attrStr !== 'R' && attrStr !== 'W')
		throw new Error('attr should be r/R or w/W');

	if ((attrStr === 'r' || attrStr === 'R') && arguments.length > 2) {
		throw new Error('Read command have a bad arguments.');
	} else if ((attrStr === 'w' || attrStr === 'W') && arguments.length !== 2) {
		throw new Error('Write command only have 2 arguments.');
	}

	if (attrStr === 'w' || attrStr === 'W') {
		data = (config.longRangeMode << 7) | (config.accSharedReg << 6) | (config.freqMode << 3) | (config.mode);
		this._spiAttr(attrStr, REG.OPMODE, data);
	} else if (attrStr === 'r' || attrStr === 'R') {
		callback = config;
		value = this._spiAttr(attrStr, REG.OPMODE);
		defered.resolve(value);

		return defered.promise.nodeify(callback);
	}
}
*/

module.exports = Hal;