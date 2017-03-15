var _ = require('busyman'),
    aesCmac = require('node-aes-cmac').aesCmac,
    crypto = require('crypto'),
    Nora_hal = require('./nora-hal.js');

var CNST = require('./constants.json'),
    REG = CNST.REG,
    MType = CNST.MType;
// [TODO] checking hal creat multi time ?
var hal = new Nora_hal();

function NoraEndDeivce(nora, settings) {
    var self = this,
        devBox = nora._devBox,
        nwkSKeyData = '',
        appSKeyData = '',
        nwkSKey = crypto.createCipher('aes128', settings.appKey.toString(16)),
        appSKey = crypto.createCipher('aes128', settings.appKey.toString(16)),
        propUnwritable = { writable: false, enumerable: false, configurable: false };
    // members:
    //  info
    // mac option(class): A, B, C
    this._option = {};
    // record linkCheckReq time
    this._gwCnt = 0;
    // record frame count
    this.count = 0;
    // Generate NwkSKey & AppSKey with AppKey, Check AES128 which way is used?
    // NwkSKey = aes128_encrypt(AppKey, 0x01 | AppNonce | NetID | DevNonce | pad16)
    // AppSKey = aes128_encrypt(AppKey, 0x02 | AppNonce | NetID | DevNonce | pad16)
    nwkSKeyData = nwkSKeyData.concat((0x01).toString(16), settings.appNonce.toString(16), settings.netId.toString(16), settings.devNonce.toString(16)/*, pad16(chList(optional))*/);
    appSKeyData = appSKeyData.concat((0x02).toString(16), settings.appNonce.toString(16), settings.netId.toString(16), settings.devNonce.toString(16)/*, pad16(chList(optional))*/);
    nwkSKey.update(nwkSKeyData);
    appSKey.update(appSKeyData);
    nwkSKey = nwkSKey.final();
    appSKey = appSKey.final();
    // Device Infomation
    Object.defineProperty(this, 'info', _.assign({
        value: {
            devEUI: settings.devEUI,
            appEUI: settings.appEUI,
            devNonce: settings.devNonce,
            appKey: settings.appKey,
            appNonce: settings.appNonce,
            // netId: settings.netId,
            // devAddr: settings.devAddr,
            appSKey: appSKey,
            nwkSKey: nwkSKey
            // _nwkId: (settings.devAddr >> 25),
            // _nwkAddr: (settings.devAddr && 0x1ff)
        }
    }, propUnwritable));

    this.netId = settings.netId;
    this.devAddr = settings.devAddr;
    this._nwkId = (this.devAddr >> 25);
    this._nwkAddr = (this.devAddr && 0x1ff);
    this.dlSettings = settings.dlSettings;
    this.rxDelay = settings.rxDelay;
    this.cfList = settings.cfList;
    // [TODO] what kind of information should be protect
    devBox.add(this.info);
}
// application layer is not ready yet 
// need to see smartobject & lwm2m content

// [TODO] SmartObject pull high layer to handle ?
// NoraEndDeivce.prototype.read = function (configName, callback) {
    // [TODO] read the value of end-device txPower, dataRate, cfList...
// };

// NoraEndDeivce.prototype.dump = function (callback) {
    // [TODO] dump the information of end-device(txPower, dataRate, cfList...)
// };

module.exports = NoraEndDeivce;