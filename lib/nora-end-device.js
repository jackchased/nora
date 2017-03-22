var _ = require('busyman'),
    aesCmac = require('node-aes-cmac').aesCmac,
    crypto = require('crypto'),
    Nora_hal = require('./nora-hal.js');

var CNST = require('./constants.json'),
    REG = CNST.REG,
    MType = CNST.MType;

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
    // control end-device instance operation or not
    //  true: instance is created, the information will be stored
    //  false: instance is created, the information will not be stored and api do not allow to used
    // this._operation = false;
    // record linkCheckReq time
    this._gwCnt = 0;
    // record frame count
    this.count = 0;
    // [ TODO] ping slot
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
            appEUI: '0x' + settings.appEUI.toString(16),
            devEUI: '0x' + settings.devEUI.toString(16),
            devNonce: settings.devNonce,
            appKey: settings.appKey,
            appNonce: settings.appNonce,
            // netId: settings.netId,
            // devAddr: settings.devAddr,
            appSKey: appSKey,
            nwkSKey: nwkSKey
            // _nwkId: (settings.devAddr >> 25),
            // _nwkAddr: (settings.devAddr & 0x1ffffff)
        }
    }, propUnwritable));

    this.netId = '0x' + settings.netId.toString(16);
    this.devAddr = '0x' + settings.devAddr.toString(16);
    this._nwkId = '0x' + (settings.devAddr >> 25).toString(16);
    this._nwkAddr = '0x' + (settings.devAddr & 0x1ffffff).toString(16);
    this.dlSettings = settings.dlSettings;
    this.rxDelay = settings.rxDelay;
    this.cfList = settings.cfList;
    // [TODO] what kind of information should be store
    devBox.add(this.info, function (err, id) {

    });

    // var object = {
    // clourse?
    // };
    // devBox information?
    // {
    //     devAddr: ,
    //     devEUI: ,
    //     appEUI: ,
    //     devNonce: ,
    //     appNonce: ,
    //     appSKey: ,
    //     nwkSKey: ,
    //     rxDelay: ,
    //     cfList: ,
    //     netId: ,
    //     nwkId: ,
    //     nwkAddr: ,
    //     dlSettings: ,
    //     _option: ,
    //     // nextPingSlotTime: ,
    //     version: ,
    //     liftTime: ,
    //     joinTime: ,
    //     objList: ,
    //     so: {
    //         device: {}
    //     }
    // }
}
// application layer is not ready yet 
// need to see smartobject & lwm2m content


NoraEndDeivce.prototype.readReq = function (path, callback) {

};

NoraEndDeivce.prototype.writeReq = function (path, value, callback) {

};

NoraEndDeivce.prototype.executeReq = function (path, args, callback) {

};

NoraEndDeivce.prototype.writeAttrsReq = function (path, attrs, callback) {

};

NoraEndDeivce.prototype.discoverReq = function (path, callback) {

};

NoraEndDeivce.prototype.observeReq = function (path, opt, callback) {

};

// [TODO] SmartObject pull high layer to handle ?
// NoraEndDeivce.prototype.read = function (configName, callback) {
    // [TODO] read the value of end-device txPower, dataRate, cfList...
// };

// NoraEndDeivce.prototype.dump = function (callback) {
    // [TODO] dump the information of end-device(txPower, dataRate, cfList...)
// };

module.exports = NoraEndDeivce;