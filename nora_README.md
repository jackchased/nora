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

#### 1. nora  

* [new Nora()](#API_nora)  
* [nora.start()](#API_start)  
* [nora.stop()](#API_stop)  
* [nora.reset()](#API_reset)  
* [nora.permitJoin()](#API_permitJoin)  
* [nora.activate()](#API_activate)  
* [nora.macReq()](#API_macReq)  
* [nora.find()](#API_find)  
* [nora.list()](#API_list)  
* [nora.info()](#API_info)  
* [nora.remove()](#API_remove)  
* [nora.multicast()](#API_multicast)  
* Events: [ready](#EVT_ready), [devIncoming](#EVT_devIncoming), [ind](#EVT_ind) and [error](#EVT_error) 


#### 2. nora-end-device  
* [new NoraEndDeive()](#API_noraEndDevice)  
* [noraED.readReq()](#API_readReq)  
* [noraED.writeReq()](#API_writeReq)  
* [noraED.excuteReq()](#API_excuteReq)  
* [noraED.writeAttrsReq()](#API_writeAttrsReq)  
* [noraED.discoverReq()](#API_discoverReq)  
* [noraED.observeReq()](#API_observeReq)  
.identifyReq() need to be waited.


*************************************************
## nora Class  

It's according to nora-hal module to implement. Exposed by `require('nora')`. This class needs to be filled with parameters when creating a new instance.  

<br />

*************************************************
<a name="API_nora"></a>  
### new Nora(spiConfig, rxIntPin, settings)  
Create an instance of the `nora` class.  

**Arguments**  

1. `spiConfig` (*Object*): The following table shows the `spiConfig` properties  

|  Parameter  |  Property   |  Type     |  Mandatory  |  Description             |  Default Value  |
|-------------|-------------|-----------|-------------|--------------------------|-----------------|   
|  spi        |  bus        |  Number   |             |  SPI Bus                 |  0              |  
|             |  cs         |  Number   |             |  SPI Chip Select Pin     |  0              |  
|             |  mode       |  Number   |             |  SPI Mode                |  0              |  
|             |  frequency  |  Number   |             |  SPI Frequency           |  2,000,000      |  
|  gpio       |  pin        |  Number   |             |  GPIO Pin used for DIO0  |  14             | 

|  mode  |  Description         |  
|--------|----------------------|  
|  `0`   |  CPOL = 0, CPHA = 0  |  
|  `1`   |  CPOL = 0, CPHA = 1  |  
|  `2`   |  CPOL = 1, CPHA = 0  |  
|  `3`   |  CPOL = 1, CPHA = 1  |  

2. `rxIntPin` (*Number*): The pin for rxDone interrupt.  


3. `settings` (*Object*): The following table shows the `settings` properties  

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

- (*Object*): nora  

**Example**  

```javascript  
var Nora = require('nora');
var spiConfig = {
  spi: {
		bus: 0,
		cs: 0,
		frequency: 200000
		mode: 0
	},
	rxIntPin: {
		pin: 22
	},
  settings: {
    frequency: 922000000,
    txPower: 10,
    spreadFactor: 8,
    codingRate: 4,
    bandwidth: 8,
    payloadCrc: 1,
    syncWord: 0x34
  };
  // ...
var hal = new Nora(spiConfig, rxIntPin, settings);
```
*************************************************
<a name="API_start"></a>  
### .start([callback])  
Start to run the nora. The nora will fire a `'ready'` event when it start to running.  

**Arguments**  

1. `callback` (*Function*): `function (err) { }`. Get called when nora start to running.  

**Returns**  

- (*Promise*)  

**Example**  

```javascript  

// callback-style
nora.start(function(err) {
    if (err)
        console.log(err);
    else
        // do something after central started
});
```  

*************************************************

<a name="API_stop"></a>  
### .stop([callback])  
Stop the nora.

**Arguments**  

1. `callback` (*Function*): `function (err) { }`. Get called when written.  

**Returns**  

- (*Promise*)  

**Example**  

```javascript  

// callback-style
nora.stop(function(err) {
    if (err)
        console.log(err);
    else
        // do something after hal idle
});
```  
*************************************************
<a name="API_reset"></a>  
### .reset([callback])  
Reset the nora.  

**Arguments**  

1. `callback` (*Function*): `function (err) { }`. Get called when written.  

**Returns**  

- (*Promise*)  

**Example**  

*************************************************
<a name="API_permitJoin"></a>  
### .permitJoin(time[, callback])  
Permit end-device to join the network. Assign join-time for end-device.  

**Arguments**  

1. `time` (*Number*): The time which allow end-device to join network. Unit: second.  


**Returns**  

- (*Promise*)  

**Example**  

*************************************************
<a name="API_activate"></a>  
### .activate(joinWay, config[, callback])  
To permit end-device to join the network. To assign information to end-device.  

**Arguments**  

1. `joinWay` (*String*): 'OTAA' or 'ABP'  
2. `config` (*Object*): Join-accept information which contains appNonce, netId, devAddr, dlSettings, rxDelay, cfList(optional).   
3. `callback` (*Function*): `function (err) { }`. Get called when written.  

**Returns**  
End-device instance.  
- (*Promise*)  

**Example**  

*************************************************
<a name="API_macReq"></a>  
### .macReq(devAddr, cId, config, callback)  
To find a registered Device Address on nora.  

**Arguments**  

1. `devAddr` (*Number*): The device address.  
2. `cId` (*Number*): MAC command ID.  
3. `config` (*Object*): MAC command paramter.  
4. `callback` (*Function*): `function (err, value) { }`. Get called along with the read value.  

**Returns**  

- (*Promise*)  

**Example**  

```javascript  

nora.macReq(0x12345678, 0x03, function(err, value) {
    if (err)
        console.log(err);
    else
        console.log(value);
});
```  
*************************************************
<a name="API_find"></a>  
### .find(devAddr[, callback])  
To find a registered Device Address on nora.  

**Arguments**  

1. `devAddr` (*Number*): The device address.  
2. `callback` (*Function*): `function (err, value) { }`. Get called along with the read value.  

**Returns**  

- (*Promise*)  

**Example**  

```javascript  

nora.find(0x12345678, function(err, value) {
    if (err)
        console.log(err);
    else
        console.log(value);
});
```  
*************************************************
<a name="API_list"></a>  
### .list()  
To list the registered device infomation.  

**Arguments**  

- None   

**Returns**  

- (*Array*)  

**Example**  

```javascript  
console.log(nora.list());
/*
...
*/
```  
*************************************************
<a name="API_info"></a>  
### .info()  
To list the nora(server) infomation.  

**Arguments**  

- None   

**Returns**  

- (*Array*)  

**Example**  

```javascript  
console.log(nora.info());
/*
...
*/
```  
*************************************************
<a name="API_remove"></a>  
### .remove(devAddr[, callback])  
To deregister and remove a end-device from nora.  

**Arguments**  

1. `devAddr` (*Number*): The device address. 
2. `callback` (*Function*): `function (err, value) { }`. Get called along with the read value.  

**Returns**  

- (*Promise*)  

**Example**  

```javascript  
nora.remove(0x12345678);
```  
*************************************************
<a name="API_multicast"></a>  
### .multicast(msg[, callback])  
To broadcast the message to all end-devices.  

**Arguments**  

1. `msg` (*Object*): The following table shows the `config` properties  


**Returns**  

- (*Promise*)  

**Example**  

```javascript  
nora.announce('hi');
```  
*************************************************

<a name = "EVT_ready"></a>
### Event: 'ready'  

Listener: `function() { }`  
The nora will fire a `ready` event when nora is ready.  

*************************************************

<a name = "EVT_permitJoining"></a>
### Event: 'permitJoining'  

Listener: `function(joinTimeLeft) { }`  
Fired when qserver is allowing for devices to join the network, where `joinTimeLeft` is number of seconds left to allow devices to join the network. This event will be triggered at each tick of countdown (per second).

*************************************************

<a name = "EVT_ind"></a>
### Event: 'ind'  

Listener: `function(msg) { }`  
The nora will fire a `ind` event when there is a incoming indication message. There are ? types of indication including `'devIncoming'` and `'devLeaving'`  


* **devIncoming**  
     The nora will fire a `devIncoming` event when end-device fired a join request.  

  * msg.type: `'devIncoming'`  
  * msg.data: `'appEUI'`, `'devEUI'`, `'devNonce'`, the join-request   


* **devLeaving**  
     The nora will fire a `devLeaving` event when nora remove end-device.  

  * msg.type: `'devLeaving'`  
  * msg.data: `'devAddr'`, the device address which is leaving from nora.  

* **devStatus**  
     The nora will fire a `devStatus` event when nora remove end-device.  

  * msg.type: `'devStatus'`  
  * msg.noraED: `'noraED'`  
  * msg.data: `'online'`, `'offline'` or `'sleep'`  

*************************************************
<a name = "EVT_error"></a>
### Event: 'error'  

Listener: `function() { }`  
The nora will fire a `error` event when an error occurs.  

*************************************************

# nora-end-device    
Exposed by `require('nora-end-device')`. This class needs to be filled with parameters when creating a new instance.  

<br />

*************************************************
<a name="API_nora"></a>  
### new NoraEndDeivce(settings)  
Create an instance of the `nora-end-device` class.  

**Arguments**  

1. `settings` (*Object*): The following table shows the `settings` properties  

|  Property          |  Type     |  Mandatory  |  Description                    |  Default Value  |  
|--------------------|-----------|-------------|---------------------------------|-----------------|  
|  appNonce          |  Number   |             |  Range: `0 ~ 0xffffff`          |  random         |  
|  netId             |  Number   |             |  Range: `0 ~ 0xffffff`          |  random         |  
|  devAddr           |  Number   |             |  Range: `0 ~ 0xffffffff`        |  random         |  
|  rx1DROffset       |  Number   |             |  Range: `0 ~ 7`                 |  0              |  
|  rx2DR             |  Number   |             |  Range: `0 ~ 15`                |  2              |  
|  rxDelay           |  Number   |             |  Range: `1 ~ 15`, Uint: second  |  1              |  
|  cfList(optional)  |  Number   |             |  Channel frequency list         |  null           |  

**Returns**  

- (*Object*) 

*************************************************
[TODO] SmartObject Data Format.
       End-Device api should be worked on appliction layer.  

<a name="API_readReq"></a>  
### .readReq(path, callback)  
Remotely read a target from the noraED. Response will be passed through the second argument of the callback.  

**Arguments**  

1. `path` (*String*): Path of the allocated Object, Object Instance, or Resource on the remote noraED.  
2. `callback` (*Function*): `function (err, rsp) { }`  



**Returns**  

- (*Promise*)  

**Example**  

```javascript  

```  
*************************************************
<a name="API_writeReq"></a>  
### .writeReq(path, value[, callback])  
Remotely write a value to the allocated Resource on a noraED. The response will be passed through the second argument of the callback.  

**Arguments**  

1. `path` (*String*): Path of the allocated Resource on the remote noraED.  
2. `value` (*Depends*): The value to write to the Resource.  
3. `callback` (*Function*): `function (err, rsp) { }`  

**Returns**  

- (*Promise*)  

**Example**  

```javascript  

```  
*************************************************
<a name="API_executeReq"></a>  
### .executeReq(path[, args][, callback])  
Invoke an executable Resource on the remote noraED. An executable Resource is like a remote procedure call.  

**Arguments**  

1. `path` (*String*): Path of the allocated Resource on the remote noraED.  
2. `args` (*Depends*): The arguments to the procedure.  
3. `callback` (*Function*): `function (err, rsp) { }`  

**Returns**  

- (*Promise*)  

**Example**  

```javascript  

```  
*************************************************
<a name="API_writeAttrsReq"></a>  
### .writeAttrsReq(path, attrs[, callback])  
Configure the report settings of a Resource, an Object Instance, or an Object. This method can also be used to cancel an observation by assigning the `attrs.cancel` to `true`.  

**Arguments**  

1. `path` (*String*): Path of the allocated Resource on the remote noraED.  
2. `attrs` (*Object*): The value to write to the Resource.  
3. `callback` (*Function*): `function (err, rsp) { }`  

**Returns**  

- (*Promise*)  

**Example**  

```javascript  

```  
*************************************************
<a name="API_discoverReq"></a>  
### .discoverReq(path, callback)  
Discover report settings of a Resource or, an Object Instance ,or an Object on the remote nodrED.  

**Arguments**  

1. `path` (*String*): Path of the allocated Resource on the remote noraED.  
2. `callback` (*Function*): `function (err, rsp) { }`  

**Returns**  

- (*Promise*)  

**Example**  

```javascript  

```  
*************************************************
<a name="API_observeReq"></a>  
### .observeReq(path[, opt][, callback])  
Start observing a Resource on the remote noraED. Please listen to event `'ind'` with type of `'devNotify'` to get the reports.  

**Arguments**  

1. `path` (*String*): Path of the allocated Resource on the remote noraED.  
2. `opt` (*Number*): Set to `1` to cancel the observation. Default is `0` to enable the observation.  
3. `callback` (*Function*): `function (err, rsp) { }`  

**Returns**  

- (*Promise*)  

**Example**  

```javascript  

```  
*************************************************

<a name="License"></a>
## 3. License  
