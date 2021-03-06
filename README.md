# nora  


## Table Content  

1. [Overview](#Overview)  
2. [API & Events](#APIs)  
3. [License](#License)  

<br />

<a name="Overview"></a>
## 1. Overview  

<a name="APIs"></a>
## 2. API & Events  

#### 1. nora-hal (SX1276 Drivers)  

* [new nora-hal()](#API_noraHal)  
* [hal.start()](#API_start)  
* [hal.config()](#API_config)  
* [hal.send()](#API_send)  
* [hal.idle()](#API_idle)  
* [hal.read()](#API_read)  
* [hal.write()](#API_write)  
* Events: [ready](#EVT_ready), [idle](#EVT_idle), [data](#EVT_data) and [error](#EVT_error)  

*************************************************
## nora-hal Class  

It's according to mraa module to implement. Exposed by `require('nora-hal')`. This class needs to be filled with parameters when creating a new instance.  

<br />

*************************************************
<a name="API_noraHal"></a>  
### new nora-hal(spiConfig, rxIntPin, resetPin)  
Create an instance of the `nora-hal` class.  

**Arguments**  

1. `spiConfig` (*Object*): The following table shows the `config` properties  

|  Parameter  |  Property   |  Type     |  Mandatory  |  Description             |  Default Value  |
|-------------|-------------|-----------|-------------|--------------------------|-----------------|   
|  spi        |  bus        |  Number   |             |  SPI Bus                 |  0              |  
|             |  cs         |  Number   |             |  SPI Chip Select Pin     |  0              |  
|             |  mode       |  Number   |             |  SPI Mode                |  0              |  
|             |  frequency  |  Number   |             |  SPI Frequency           |  2,000,000      |  

|  mode  |  Description         |  
|--------|----------------------|  
|  `0`   |  CPOL = 0, CPHA = 0  |  
|  `1`   |  CPOL = 0, CPHA = 1  |  
|  `2`   |  CPOL = 1, CPHA = 0  |  
|  `3`   |  CPOL = 1, CPHA = 1  |  

2. `rxIntPin` (*Number*): The 'rx' interrupte pin. Default value: 22.  

3. `resetPin` (*Number*): Reset pin. Default value: 18.  

**Returns**  

- (*Object*): hal  

**Example**  

```javascript  
var noraHal = require('nora-hal');
var spiConfig = {
	spi: {
		bus: 0,
		cs: 0,
		frequency: 200000,
		mode: 0
	}
    };

var hal = new noraHal(spiConfig);
```

*************************************************
<a name="API_config"></a>  
### .config(settings)  
Connect to the SoC and start to run the central. The hal will fire a `'ready'` event when it start to running.  

**Arguments**  

1. `settings` (*Object*): The following table shows the `config` properties  

|  Property        |  Type     |  Mandatory  |  Description                                                                                     |  Default Value  |  
|------------------|-----------|-------------|--------------------------------------------------------------------------------------------------|-----------------|  
|  modulation      |  Number   |             |  `0`: FSK/OOK, `1`: LoRa                                                                         |  1              |  
|  frequency       |  Number   |             |  Range: `0 ~ 0xffffff`, Frequency interval(61.035 Hz)                                            |  0x6c8000       |  
|  freqMode        |  Number   |             |  `0`: High Frequency Mode, `1`: Low Frequency Mode                                               |  1              |  
|  txPower         |  Number   |             |  Range: `0 ~ 17`, Max: `20`. Unit: dBm                                                           |  14             |  
|  spreadFactor    |  Number   |             |  Spreading Factor Rate. Range: `6 ~ 12`                                                          |  6              |  
|  codingRate      |  Number   |             |  Error Coding Rate. Value: `1 ~ 4`                                                               |  1              |  
|  bandwidth       |  Number   |             |  Signal Bandwidth. Range: `0 ~ 9`                                                                |  7              |  
|  headerMode      |  Number   |             |  `0`: Explicit Header Mode, `1`: Implicit Header Mode                                            |  0              |  
|  payloadCrc      |  Number   |             |  `0`: Disable, `1`: Enable                                                                       |  0              |  
|  preambleLength  |  Number   |             |  Preamble Length. Range: `1 ~ 65535`, yeild total preamble length `preambleLength + 4` symbols.  |  8              |  
|  syncWord        |  Number   |             |  Range: `0x00 ~ 0xff`, 0x34 is reserved for LoRaWAN networks.                                    |  0x12           |  
|  ocpOn           |  Number   |             |  Overload Current Protection. `0`: Disable, `1`: Enable                                          |  1              |  
|  ocpTrim         |  Number   |             |  Trim of OCP current. Range: `0x00 ~ 0x1f`                                                       |  0x0b           |  

|  bandwidth  |  Description  |  spreadFactor  |  Description  |  codingRate  |  Description  |  ocpTrim     |  Description                     |  
|-------------|---------------|----------------|---------------|--------------|---------------|--------------|----------------------------------|  
|  `0`        |  7.8 kHz      |  `6`           |  SF_6         |  `1`         |  CR_4/5       |  `0 ~ 15`    |  Imax = 45 + 5 * ocpTrim (mA)    |  
|  `1`        |  10.4 kHz     |  `7`           |  SF_7         |  `2`         |  CR_4/6       |  `16 ~ 27`   |  Imax = -30 + 10 * ocpTrim (mA)  |  
|  `2`        |  15.6 kHz     |  `8`           |  SF_8         |  `3`         |  CR_4/7       |  `27 ~ 32`   |  Imax = 240 (mA)                 |  
|  `3`        |  20.8 kHz     |  `9`           |  SF_9         |  `4`         |  CR_4/8       |              |                                  |  
|  `4`        |  31.25 kHz    |  `10`          |  SF_10        |              |               |              |                                  |  
|  `5`        |  41.7 kHz     |  `11`          |  SF_11        |              |               |              |                                  |  
|  `6`        |  62.5 kHz     |  `12`          |  SF_12        |              |               |              |                                  |  
|  `7`        |  125 kHz      |                |               |              |               |              |                                  |  
|  `8`        |  250 kHz      |                |               |              |               |              |                                  |  
|  `9`        |  500 kHz      |                |               |              |               |              |                                  |  

**Returns**  

- (*Promise*)  

**Example**  

```javascript  
var settings = {
        frequency: 922000000,
        txPower: 10,
        spreadFactor: 8,
        codingRate: 4,
        bandwidth: 8,
        payloadCrc: 1,
        syncWord: 0x34
    };

hal.config(settings);
```  

*************************************************
<a name="API_start"></a>  
### .start([callback])  
Start to run the Soc. The hal will fire a `'ready'` event when it start to running.  

**Arguments**  

1. `callback` (*Function*): `function (err) { }`. Get called when hal start to running.  

**Returns**  

- (*Promise*)  

**Example**  

```javascript  

// callback-style
hal.start(function(err) {
    if (err)
        console.log(err);
    else
        // do something after central started
});
```  

*************************************************
<a name="API_send"></a>  
### .send(data, [callback])  
Tansmit Data with change ship status into tx mode.  

**Arguments**  

1. `data` (*Buffer* | *Object*): Transmit Data.  
2. `callback` (*Function*): `function (err) { }`. Get called when written.  

**Returns**  

- (*Promise*)  

**Example**  


*************************************************
<a name="API_idle"></a>  
### .idle([callback])  
Device get into idle mode. The hal will fire a `'idle'` event when hal set to idle mode.  

**Arguments**  

1. `callback` (*Function*): `function (err) { }`. Get called when written.  

**Returns**  

- (*Promise*)  

**Example**  

```javascript  

// callback-style
hal.idle(function(err) {
    if (err)
        console.log(err);
    else
        // do something after hal idle
});
```  

*************************************************
<a name="API_read"></a>  
### .read(address, callback)  
Read the value of register.  

**Arguments**  

1. `address` (*Number*): The address of register.  
2. `callback` (*Function*): `function (err, value) { }`. Get called along with the read value.  

**Returns**  

- (*Promise*)  

**Example**  

```javascript  

hal.read(0x09, function(err, value) {
    if (err)
        console.log(err);
    else
        console.log(value);
});
```  

*************************************************
<a name="API_write"></a>  
### .write(address, data, [callback])  
Write a value to register.  

**Arguments**  

1. `address` (*Number*): The address of register.  
2. `data` (*Array* | *Number*): Value which will be written into register.  
3. `callback` (*Function*): `function (err) { }`. Get called when written.  

**Returns**  

- None  

**Example**  

```javascript  
var data = [
    {bit: 3, value: 5}, // LSB
    {bit: 1, value: 0},
    {bit: 2, value: 0},
    {bit: 1, value: 0},
    {bit: 1, value: 1}  // MSB
	];
// Number-style
hal.write(0x09, 0x4f);
// Array-style
hal.write(0x01, data);
```  

*************************************************

<a name = "EVT_ready"></a>
###Event: 'ready'  

Listener: `function() { }`  
The hal will fire a `ready` event when hal is ready.  

*************************************************

<a name = "EVT_idle"></a>
###Event: 'idle'  

Listener: `function() { }`  
The hal will fire a `idle` event when hal is idle.  

*************************************************

<a name = "EVT_data"></a>
###Event: 'data'  

Listener: `function() { }`  
The hal will fire a `data` event when hal is rxDone.  

*************************************************

<a name = "EVT_error"></a>
###Event: 'error'  

Listener: `function() { }`  
The hal will fire a `error` event when an error occurs.  

*************************************************

<a name="License"></a>
## 3. License  
