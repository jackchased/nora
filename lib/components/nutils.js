'use strict';

var _ = require('busyman')
    lwm2mid = require('lwm2m-id');

var nutils = {};

/*************************************************************************************************/
/*** path APIs                                                                                 ***/
/*************************************************************************************************/
nutils.pathParserToArray = function (path) {
    var pathArray = path.split('/'),
        pathNumber = [];

    if (pathArray[0] === '')
        pathArray = pathArray.slice(1);
    if (pathArray[pathArray.length - 1] === '')
        pathArray = pathArray.slice(0, pathArray.length - 1);

    _.forEach(pathArray, function (val, key) {
        if (key === 0)  // object id
            val = lwm2mid.getOid(val);
        else if (key === 2) // resource id
            val = lwm2mid.getRid(val);
        pathNumber.push(val);
    });

    return pathArray;
}
/*************************************************************************************************/
/*** LoRaWAN APIs                                                                              ***/
/*************************************************************************************************/
nutils.generateMic = function (device, data, dir) {
    if (!_.isBuffer(data))
        throw new TypeError('data should be a buffer.');
    var msg = '';
    // cmac = aes128_cmac(NwkSKey, B0 | msg)
    // MIC = cmac[0..3]
    // msg = MHDR | FHDR | FPort | FRMPayload
    // B0: 0x49 | 0x00000000 | Dir | DevAddr | FCntUp/FCntDown | 0x00 | len(msg)
    // Dir: 0: uplink, 1: downlink
    // [TODO] check FCnt(4/2 bytes)?
    msg = msg.concat((0x49).toString(16), (0x00000000).toString(16), (dir).toString(16));
    // devAddr
    for (var i = 0;i < 4;i += 1)
        msg = msg.concat((device.devAddr >> (8 * i)) & 0xff);
    // FCnt(up/down)
    for (var i = 0;i < 4;i += 1)
        msg = msg.concat((device.count >> (8 * i)) & 0xff);
    msg = msg.concat((0x00.toString(16)), data.length.toString(16));
    // concat msg
    // mhdr & fhdr & fport & frmPayload
    for (var i = 0;i < data.length;i += 1)
        msg = msg.concat(data[i]);
    nwkSKey = device.nwkSKey;
    cmac = aesCmac(nwkSKey, msg);
    for (var i = 3;i > -1;i -= 1)
        data.push(parseInt(cmac[i * 2] + cmac[i * 2 + 1], 16));

    return data;
}

// To encrypt/decrypt FRMPayload
nutils.frmPayloadcrypto = function (device, data, key) {
    if (!_.isBuffer(data))
        throw new TypeError('data must be a buffer.');
    var cipher,
        seq,
        seqSum = '',
        buf = '';
    // FPort: 0: NwkSKey, 1~255: AppSKey, K: NwkSKey/AppSKey
    // Ai = (0x01 | 0x00000000 | Dir | DevAddr | FCnt(Up/Down) | 0x00 | i)
    // Dir: 0: uplink, 1: downlink, pld = FRMPayload
    // Si = aes128_encrypt(K, Ai), i = 1..k, k = ceill(len(pld)/16)
    // S = S1 | S2 | .. | Sk
    // Encryption and decryption of the payload is done by truncating
    // (pld | pad16) xor S to the first len(pld) octets
    for (var i = 1;i < (data.length / 16);i += 1) {
        cipher = crypto.createCipher('aes128', key.toString(16));
        seq = buf.concat((0x01).toString(16), (0x00000000).toString(16), (0x00).toString(16), device.devAddr.toString(16), device.count.toString(16), (0x00).toString(16), i.toString(16));
        buf = '';
        cipher.update(seq);
        seq = cipher.final();
        seqSum = seqSum.concat(seq, 16);
    }
    // [TODO] Correction need to be checked
    for (var i = 0;i < (data.length - data.length % 16); i += 1)
        data[i] = data[i] ^ seqSum[i].charCodeAt(0);
    return data;
};