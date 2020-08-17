const scaling_table = new Float64Array(64);
const scale_conversion_table = new Float64Array(128);
for (let i = 0; i < 64; i++) scaling_table[i] = Math.pow(2, (i - 63) * 53.0 / 128.0 + 3.5);
for (let i = 2; i < 127; i++) scale_conversion_table[i] = Math.pow(2, (i - 64) * 53.0 / 128.0);

class HCA {
    static scaling_table = scaling_table;
    static scale_conversion_table = scale_conversion_table;
    static range_table = new Float64Array([
        0,         2.0 / 3,    2.0 / 5,    2.0 / 7,
        2.0 / 9,   2.0 / 11,   2.0 / 13,   2.0 / 15,
        2.0 / 31,  2.0 / 63,   2.0 / 127,  2.0 / 255,
        2.0 / 511, 2.0 / 1023, 2.0 / 2047, 2.0 / 4095
    ]);
    private _table = new Uint8Array(0x100);
    private _table1 = new Uint8Array(0x100);
    verison = "";
    dataOffset = 0;
    format = {
        channelCount: 0,
        samplingRate: 0,
        blockCount: 0,
        muteHeader: 0,
        muteFooter: 0
    }
    blockSize = 0;
    bps = 0;
    compParam = new Uint8Array(9);
    ath = 0;
    loop = {
        start: 0,
        end: 0,
        count: 0
    }
    cipher = 0;
    rva = 0.0;
    comment = "";

    origin = new Uint8Array();
    decrypted = new Uint8Array();
    wave = new Uint8Array();
    channel: Array<stChannel> = [];

    parseKey (key:any) {
        let buff = new Uint8Array(4);
        try { switch (typeof key) {
            case "string":
                key = parseInt(key) || parseInt("0x" + key);
            case 'number':
                buff[0] = key & 0xff;
                buff[1] = key >> 8 & 0xff;
                buff[2] = key >> 16 & 0xff;
                buff[3] = key >> 24 & 0xff;
                break;
            case 'object':
                if (key instanceof Uint8Array) return new Uint32Array(key.buffer);
                if (key instanceof Uint32Array) return key;
        } } catch {
            // key parse error
        } finally {
            return new Uint32Array(buff.buffer);
        }
    }
    constructor (key1:any = null, key2:any = 0) {
        this.init1();
        if (key1 === null) {
            key1 = this.parseKey(0x01395C51);
            key2 = this.parseKey(0x00000000);
        } else if (typeof key1 === 'number') {
            key1 = this.parseKey(key1);
            key2 = this.parseKey(key2 ? key2 : key1 >> 32);
        } else if (typeof key1 === 'string') {
            key1 = parseInt(key1) || parseInt("0x" + key1);
            key1 = this.parseKey(key1);
            key2 = this.parseKey(key2 ? key2 : key1 >> 32);
        } else {
            key1 = this.parseKey(key1);
            key2 = this.parseKey(key2);
        }
        this.init56(key1, key2);
    }
    private init1() {
        for (let i = 1, v = 0; i < 0xFF; i++) {
            v = (v * 13 + 11) & 0xFF;
            if (v == 0 || v == 0xFF)v = (v * 13 + 11) & 0xFF;
            this._table1[i] = v;
        }
        this._table1[0] = 0;
        this._table1[0xFF] = 0xFF;
    }
    private init56(key1: Uint32Array, key2: Uint32Array) {
        let t1 = new Uint8Array(8);
        if (!key1[0])key2[0]--;
        key1[0]--;
        t1.set(new Uint8Array(key1.buffer));
        t1.set(new Uint8Array(key2.buffer), 4);
        let t2 = new Uint8Array([
            t1[1], t1[1] ^ t1[6], t1[2] ^ t1[3],
            t1[2], t1[2] ^ t1[1], t1[3] ^ t1[4],
            t1[3], t1[3] ^ t1[2], t1[4] ^ t1[5],
            t1[4], t1[4] ^ t1[3], t1[5] ^ t1[6],
            t1[5], t1[5] ^ t1[4], t1[6] ^ t1[1],
            t1[6]
        ]);
        let t3 = new Uint8Array(0x100);
        let t31 = new Uint8Array(0x10);
        let t32 = new Uint8Array(0x10);
        this.createTable(t31, t1[0]);
        for (let i = 0, t = 0; i < 0x10; i++) {
            this.createTable(t32, t2[i]);
            let v = t31[i] << 4;
            for (let j = 0; j < 0x10; j++) {
                t3[t++] = v | t32[j];
            }
        }
        for (let i = 0, v = 0, t = 1; i < 0x100; i++) {
            v = (v + 0x11) & 0xFF;
            let a = t3[v];
            if (a != 0 && a != 0xFF) this._table[t++] = a;
        }
        this._table[0] = 0;
        this._table[0xFF] = 0xFF;
    }
    private createTable(r: Uint8Array, key: number) {
        let mul = ((key & 1) << 3) | 5;
        let add = (key & 0xE) | 1;
        let t = 0;
        key >>= 4;
        for (let i = 0; i < 0x10; i++) {
            key = (key*mul + add) & 0xF;
            r[t++] = key;
        }
    }

    static _v = new Uint16Array([
        0x0000,0x8005,0x800F,0x000A,0x801B,0x001E,0x0014,0x8011,0x8033,0x0036,0x003C,0x8039,0x0028,0x802D,0x8027,0x0022,
        0x8063,0x0066,0x006C,0x8069,0x0078,0x807D,0x8077,0x0072,0x0050,0x8055,0x805F,0x005A,0x804B,0x004E,0x0044,0x8041,
        0x80C3,0x00C6,0x00CC,0x80C9,0x00D8,0x80DD,0x80D7,0x00D2,0x00F0,0x80F5,0x80FF,0x00FA,0x80EB,0x00EE,0x00E4,0x80E1,
        0x00A0,0x80A5,0x80AF,0x00AA,0x80BB,0x00BE,0x00B4,0x80B1,0x8093,0x0096,0x009C,0x8099,0x0088,0x808D,0x8087,0x0082,
        0x8183,0x0186,0x018C,0x8189,0x0198,0x819D,0x8197,0x0192,0x01B0,0x81B5,0x81BF,0x01BA,0x81AB,0x01AE,0x01A4,0x81A1,
        0x01E0,0x81E5,0x81EF,0x01EA,0x81FB,0x01FE,0x01F4,0x81F1,0x81D3,0x01D6,0x01DC,0x81D9,0x01C8,0x81CD,0x81C7,0x01C2,
        0x0140,0x8145,0x814F,0x014A,0x815B,0x015E,0x0154,0x8151,0x8173,0x0176,0x017C,0x8179,0x0168,0x816D,0x8167,0x0162,
        0x8123,0x0126,0x012C,0x8129,0x0138,0x813D,0x8137,0x0132,0x0110,0x8115,0x811F,0x011A,0x810B,0x010E,0x0104,0x8101,
        0x8303,0x0306,0x030C,0x8309,0x0318,0x831D,0x8317,0x0312,0x0330,0x8335,0x833F,0x033A,0x832B,0x032E,0x0324,0x8321,
        0x0360,0x8365,0x836F,0x036A,0x837B,0x037E,0x0374,0x8371,0x8353,0x0356,0x035C,0x8359,0x0348,0x834D,0x8347,0x0342,
        0x03C0,0x83C5,0x83CF,0x03CA,0x83DB,0x03DE,0x03D4,0x83D1,0x83F3,0x03F6,0x03FC,0x83F9,0x03E8,0x83ED,0x83E7,0x03E2,
        0x83A3,0x03A6,0x03AC,0x83A9,0x03B8,0x83BD,0x83B7,0x03B2,0x0390,0x8395,0x839F,0x039A,0x838B,0x038E,0x0384,0x8381,
        0x0280,0x8285,0x828F,0x028A,0x829B,0x029E,0x0294,0x8291,0x82B3,0x02B6,0x02BC,0x82B9,0x02A8,0x82AD,0x82A7,0x02A2,
        0x82E3,0x02E6,0x02EC,0x82E9,0x02F8,0x82FD,0x82F7,0x02F2,0x02D0,0x82D5,0x82DF,0x02DA,0x82CB,0x02CE,0x02C4,0x82C1,
        0x8243,0x0246,0x024C,0x8249,0x0258,0x825D,0x8257,0x0252,0x0270,0x8275,0x827F,0x027A,0x826B,0x026E,0x0264,0x8261,
        0x0220,0x8225,0x822F,0x022A,0x823B,0x023E,0x0234,0x8231,0x8213,0x0216,0x021C,0x8219,0x0208,0x820D,0x8207,0x0202
    ]);
    crc16(data: Uint8Array, size: number) {
        let sum = 0;
        let i = 0;
        while (i < size)
            sum = ((sum << 8) ^ HCA._v[(sum >> 8) ^ data[i++]]) & 0x0000ffff;
        return sum & 0x0000ffff;
    }
    mask(block: Uint8Array, offset: number, size: number) {
        for (let i = 0; i < size; i++) block[offset + i] = this._table[block[offset + i]];
    }
    private getSign(raw: DataView, offset = 0, resign = false) {
        let magic = raw.getUint32(offset, true);
        if (magic & 0x080808080) {
            magic &= 0x7f7f7f7f;
            if (resign) raw.setUint32(offset, magic, true);
        }
        let hex = [magic & 0xff, magic >> 8 & 0xff, magic >> 16 & 0xff, magic >> 24 & 0xff];
        return String.fromCharCode.apply(null, hex);
    }
    decrypt(hca: Uint8Array) {
        let p = new DataView(hca.buffer, 0, 8);
        let head = this.getSign(p, 0, true);
        const version = {
            main: p.getUint8(4),
            sub:  p.getUint8(5)
        }
        this.verison = version.main + '.' + version.sub;
        this.dataOffset = p.getUint16(6);
        p = new DataView(hca.buffer, 0, this.dataOffset);
        let ftell = 8;
        while (ftell < this.dataOffset - 2) {
            let sign = this.getSign(p, ftell, true);
            if (sign == "pad\0") break;
            switch (sign) {
                case "fmt\0":
                    this.format.channelCount = p.getUint8(ftell + 4);
                    this.format.samplingRate = p.getUint32(ftell + 4) & 0x00ffffff;
                    this.format.blockCount = p.getUint32(ftell + 8);
                    this.format.muteHeader = p.getUint16(ftell + 12);
                    this.format.muteHeader = p.getUint16(ftell + 14);
                    ftell += 16;
                    break;
                case "comp":
                    this.blockSize = p.getUint16(ftell + 4);
                    this.bps = this.format.samplingRate * this.blockSize / 128000.0;
                    this.compParam =  new Uint8Array(hca.buffer, ftell + 6, 9);
                    ftell += 16;
                    break;
                case "dec\0":
                    this.blockSize = p.getUint16(ftell + 4);
                    this.bps = this.format.samplingRate * this.blockSize / 128000.0;
                    this.compParam[0] = p.getUint8(ftell + 6);
                    this.compParam[1] = p.getUint8(ftell + 7);
                    this.compParam[2] = p.getUint8(ftell + 11);
                    this.compParam[3] = p.getUint8(ftell + 10);
                    this.compParam[4] = p.getUint8(ftell + 8) + 1;
                    this.compParam[5] = (p.getUint8(ftell + 12) ? p.getUint8(ftell + 9) : p.getUint8(ftell + 8)) + 1;
                    this.compParam[6] = this.compParam[4] - this.compParam[5];
                    this.compParam[7] = 0;
                    ftell += 13;
                    break;
                case "vbr\0":
                    ftell += 8;
                    break;
                case "ath\0":
                    this.ath = p.getUint16(ftell + 4);
                    ftell += 6;
                    break;
                case "loop":
                    this.loop.start = p.getUint32(ftell + 4);
                    this.loop.end = p.getUint32(ftell + 8);
                    this.loop.count = p.getUint16(ftell + 12);
                    ftell += 16;
                    break;
                case "ciph":
                    this.cipher = p.getUint16(ftell + 4);
                    p.setUint16(ftell + 4, 0);
                    ftell += 6;
                    break;
                case "rva\0":
                    this.rva = p.getFloat32(ftell + 4);
                    ftell += 8;
                    break;
                case "comm":
                    let len = p.getUint8(ftell + 4);
                    let jisdecoder = new TextDecoder('shift-jis');
                    this.comment = jisdecoder.decode(hca.slice(ftell + 5, ftell + 5 + len));
                    break;
                default: break;
            }
        }
        this.compParam[2] = this.compParam[2] || 1;
        let _a = this.compParam[4] - this.compParam[5] - this.compParam[6];
        let _b = this.compParam[7];
        this.compParam[8] = _b > 0 ? _a / _b + (_a % _b ? 1 : 0) : 0;

        p.setUint16(this.dataOffset - 2, this.crc16(hca, this.dataOffset - 2));
        for (let i = 0; i < this.format.blockCount; ++i) {
            ftell = this.dataOffset + this.blockSize * i;
            this.mask(hca, ftell, this.blockSize - 2);
            p = new DataView(hca.buffer, ftell, this.blockSize);
            p.setUint16(
                this.blockSize - 2,
                this.crc16(hca.slice(ftell), this.blockSize - 2)
            );
        }
        return hca
    }
    info(hca: Uint8Array) {
        let p = new DataView(hca.buffer, 0, 8);
        let head = this.getSign(p, 0);
        const version = {
            main: p.getUint8(4),
            sub:  p.getUint8(5)
        }
        this.verison = version.main + '.' + version.sub;
        this.dataOffset = p.getUint16(6);
        p = new DataView(hca.buffer, 0, this.dataOffset);
        let ftell = 8;
        while (ftell < this.dataOffset - 2) {
            let sign = this.getSign(p, ftell);
            if (sign == "pad\0") break;
            switch (sign) {
                case "fmt\0":
                    this.format.channelCount = p.getUint8(ftell + 4);
                    this.format.samplingRate = p.getUint32(ftell + 4) & 0x00ffffff;
                    this.format.blockCount = p.getUint32(ftell + 8);
                    this.format.muteHeader = p.getUint16(ftell + 12);
                    this.format.muteHeader = p.getUint16(ftell + 14);
                    ftell += 16;
                    break;
                case "comp":
                    this.blockSize = p.getUint16(ftell + 4);
                    this.bps = this.format.samplingRate * this.blockSize / 128000.0;
                    this.compParam =  new Uint8Array(hca.buffer, ftell + 6, 9);
                    ftell += 16;
                    break;
                case "dec\0":
                    this.blockSize = p.getUint16(ftell + 4);
                    this.bps = this.format.samplingRate * this.blockSize / 128000.0;
                    this.compParam[0] = p.getUint8(ftell + 6);
                    this.compParam[1] = p.getUint8(ftell + 7);
                    this.compParam[2] = p.getUint8(ftell + 11);
                    this.compParam[3] = p.getUint8(ftell + 10);
                    this.compParam[4] = p.getUint8(ftell + 8) + 1;
                    this.compParam[5] = (p.getUint8(ftell + 12) ? p.getUint8(ftell + 9) : p.getUint8(ftell + 8)) + 1;
                    this.compParam[6] = this.compParam[4] - this.compParam[5];
                    this.compParam[7] = 0;
                    ftell += 13;
                    break;
                case "vbr\0":
                    ftell += 8;
                    break;
                case "ath\0":
                    this.ath = p.getUint16(ftell + 4);
                    ftell += 6;
                    break;
                case "loop":
                    this.loop.start = p.getUint32(ftell + 4);
                    this.loop.end = p.getUint32(ftell + 8);
                    this.loop.count = p.getUint16(ftell + 12);
                    ftell += 16;
                    break;
                case "ciph":
                    this.cipher = p.getUint16(ftell + 4);
                    p.setUint16(ftell + 4, 0);
                    ftell += 6;
                    break;
                case "rva\0":
                    this.rva = p.getFloat32(ftell + 4);
                    ftell += 8;
                    break;
                case "comm":
                    let len = p.getUint8(ftell + 4);
                    let jisdecoder = new TextDecoder('shift-jis');
                    this.comment = jisdecoder.decode(hca.slice(ftell + 5, ftell + 5 + len));
                    break;
                default: break;
            }
        }
        this.compParam[2] = this.compParam[2] || 1;
        let _a = this.compParam[4] - this.compParam[5] - this.compParam[6];
        let _b = this.compParam[7];
        this.compParam[8] = _b > 0 ? _a / _b + (_a % _b ? 1 : 0) : 0;
    }
    load(hca: Uint8Array) {
        if (this.getSign(new DataView(hca.buffer)) == "HCA\0") {
            this.origin = new Uint8Array(hca);
            if (hca[0] & 0x7f || hca[1] & 0x7f || hca[2] & 0x7f) {
                this.decrypted = this.decrypt(hca);
            } else {
                this.decrypted = this.origin;
                this.info(hca);
            }
        } else throw "Not a HCA file";
    }

    decode(hca = this.decrypted, mode = 32, loop = 0, volume = 1.0) {
        let wavRiff = {
            id: 0x46464952, // RIFF
            size: 0,
            wave: 0x45564157 // WAVE
        }
        let fmt = {
            id: 0x20746d66, // fmt 
            size: 0x10,
            fmtType: mode > 0 ? 1 : 3,
            fmtChannelCount: this.format.channelCount,
            fmtSamplingRate: this.format.samplingRate,
            fmtSamplesPerSec: 0,
            fmtSamplingSize: 0,
            fmtBitCount: mode > 0 ? mode : 32
        }
        fmt.fmtSamplingSize = fmt.fmtBitCount / 8 * fmt.fmtChannelCount;
        fmt.fmtSamplesPerSec = fmt.fmtSamplingRate * fmt.fmtSamplingSize;
        let smpl = {
            id: 0x6c706d73, // smpl
            size: 0x3C,
            manufacturer: 0,
            product: 0,
            samplePeriod: 0,
            MIDIUnityNote: 0x3C,
            MIDIPitchFraction: 0,
            SMPTEFormat: 0,
            SMPTEOffset: 0,
            sampleLoops: 1,
            samplerData: 0x18,
            loop_Identifier: 0,
            loop_Type: 0,
            loop_Start: 0,
            loop_End: 0,
            loop_Fraction: 0,
            loop_PlayCount: 0
        }
        let note = {
            id: 0x65746f6e, // note
            size: 0,
            dwName: 0
        }
        let data = {
            id: 0x61746164, // data
            size: 0
        }
        // if (loop) {
            smpl.samplePeriod = (1 / fmt.fmtSamplingRate * 1000000000);
            smpl.loop_Start = this.loop.start * 0x80 * 8 + this.format.muteHeader;
            smpl.loop_End = (this.loop.end + 1) * 0x80 * 8 - 1;
            smpl.loop_PlayCount = (this.loop.count == 0x80) ? 0 : this.loop.count;
        // } else {
        //     smpl.loop_Start = 0;
        //     smpl.loop_End = (this.format.blockCount + 1) * 0x80 * 8 - 1;
        //     this.loop.start = 0;
        //     this.loop.end = this.format.blockCount;
        // }
        if (this.comment) {
            note.size = 4 + this.comment.length;
            if (note.size & 3) note.size += 4 - note.size & 3
        }
        data.size = this.format.blockCount * 0x400 * fmt.fmtSamplingSize + (smpl.loop_End - smpl.loop_Start) * loop;
        wavRiff.size = 0x1C + ((this.loop && !loop) ? 68 : 0) + (this.comment ? 8 + note.size : 0) + 8 + data.size;
        let writer = new Uint8Array(wavRiff.size + 8);
        let p = new DataView(writer.buffer);
        let ftell = 0;
        p.setUint32(0, wavRiff.id, true);
        p.setUint32(4, wavRiff.size, true);
        p.setUint32(8, wavRiff.wave, true);
        p.setUint32(12, fmt.id, true);
        p.setUint32(16, fmt.size, true);
        p.setUint16(20, fmt.fmtType, true);
        p.setUint16(22, fmt.fmtChannelCount, true);
        p.setUint32(24, fmt.fmtSamplingRate, true);
        p.setUint32(28, fmt.fmtSamplesPerSec, true);
        p.setUint16(32, fmt.fmtSamplingSize, true);
        p.setUint16(34, fmt.fmtBitCount, true);
        ftell = 36;
        if (this.loop) {
            p.setUint32(ftell, smpl.id, true);
            p.setUint32(ftell + 4, smpl.size, true);
            p.setUint32(ftell + 8, smpl.manufacturer, true);
            p.setUint32(ftell + 12, smpl.product, true);
            p.setUint32(ftell + 16, smpl.samplePeriod, true);
            p.setUint32(ftell + 20, smpl.MIDIUnityNote, true);
            p.setUint32(ftell + 24, smpl.MIDIPitchFraction, true);
            p.setUint32(ftell + 28, smpl.SMPTEFormat, true);
            p.setUint32(ftell + 32, smpl.SMPTEOffset, true);
            p.setUint32(ftell + 36, smpl.sampleLoops, true);
            p.setUint32(ftell + 40, smpl.samplerData, true);
            p.setUint32(ftell + 44, smpl.loop_Identifier, true);
            p.setUint32(ftell + 48, smpl.loop_Type, true);
            p.setUint32(ftell + 52, smpl.loop_Start, true);
            p.setUint32(ftell + 56, smpl.loop_End, true);
            p.setUint32(ftell + 60, smpl.loop_Fraction, true);
            p.setUint32(ftell + 64, smpl.loop_PlayCount, true);
            ftell += 68;
        }
        if (this.comment) {
            p.setUint32(ftell, note.id, true);
            p.setUint32(ftell + 4, note.size, true);
            let te = new TextEncoder();
            writer.set(te.encode(this.comment), ftell + 8);
            ftell += note.size;
        }
        p.setUint32(ftell, data.id, true);
        p.setUint32(ftell + 4, data.size, true);
        ftell += 8;
        let r = new Uint8Array(0x10);
        let b = Math.floor(this.format.channelCount / this.compParam[2]);
        if (this.compParam[6] && b > 1) {
            for (let i = 0; i < this.compParam[2]; ++i) switch (b) {
                case 8:
                    r[i * b + 6] = 1;
                    r[i * b + 7] = 2;
                case 7:
                case 6:
                    r[i * b + 4] = 1;
                    r[i * b + 5] = 2;
                case 5:
                    if (b == 5 && this.compParam[3] <= 2) {
                        r[i * b + 3] = 1;
                        r[i * b + 4] = 2;
                    }
                case 4:
                    if (b == 4 && this.compParam[3] == 0) {
                        r[i * b + 2] = 1;
                        r[i * b + 3] = 2;
                    }
                case 3:
                case 2:
                    r[i * b] = 1;
                    r[i * b + 1] = 2;
                default:
            }
        }
        for (let i = 0; i < this.format.channelCount; ++i) {
            let c = new stChannel();
            c.type = r[i];
            c.value3 = c.value.subarray(this.compParam[5] + this.compParam[6]);
            c.count = this.compParam[5] + (r[i] != 2 ? this.compParam[6] : 0);
            this.channel.push(c);
        }
        for (let l = 0; l < this.format.blockCount; ++l) {
            let wavebuff = this.decodeBlock(hca, this.dataOffset + this.blockSize * l);
            // let buff: ArrayBufferLike = new SharedArrayBuffer(0);
            // let length = 0x400;
            for (let i = 0; i<8; i++) {
                for (let j = 0; j<0x80; j++) {
                    for (let k = 0; k < this.format.channelCount; k++) {
                        let f = this.channel[k].wave[i][j] * volume;
                        if (f > 1) f = 1;
                        else if (f < -1) f = -1;
                        switch (mode) {
                            case 8:
                                p.setUint8(ftell, f * 0x7F + 0x80);
                                ftell += 1;
                            break;
                            case 16:
                                p.setUint16(ftell, f * 0x7FFF, true);
                                ftell += 2;
                            break;
                            case 24:
                                f *= 0x7FFFFF;
                                p.setUint8(ftell    , f       & 0xFF);
                                p.setUint8(ftell + 1, f >>  8 & 0xFF);
                                p.setUint8(ftell + 2, f >> 16 & 0xFF);
                                ftell += 3;
                            break;
                            case 32:
                                p.setUint32(ftell, f * 0x7FFFFFFF, true);
                                ftell += 4;
                            break;
                            case 0:
                            default:
                                writer.set(new Uint8Array(new Float32Array([f]).buffer), ftell);
                                ftell += 4;
                        }
                    }
                }
            }
            // switch (mode) {
            //     case 0:
            //     default:
            //         buff = new Float32Array(wavebuff).buffer;
            //     break;
            //     case 8:
            //         buff = new Uint8Array(wavebuff).buffer;
            //     break;
            //     case 16:
            //         buff = new Uint16Array(wavebuff).buffer;
            //     break;
            //     // case 24:
            //     //     buff = new Float32Array(wavebuff).buffer;
            //     // break;
            //     case 32:
            //         buff = new Uint32Array(wavebuff).buffer;
            //     break;
            // }
            // writer.set(new Uint8Array(buff.slice(0, length * fmt.fmtChannelCount)), ftell);
            // ftell += length * fmt.fmtSamplingSize;
        }
        this.channel = [];
        return this.wave = writer;
    }

    decodeBlock(hca = this.decrypted, address = 0) {
        let data = new clData(this.blockSize, hca.subarray(address, address + this.blockSize));
        let magic = data.read(16);
        if (magic == 0xFFFF) {
            let a = (data.read(9) << 8) - data.read(7);
            for (let i = 0; i < this.format.channelCount; i++) this.channel[i].Decode1(data, this.compParam[8], a);
            for (let i = 0; i<8; i++) {
                for (let j = 0; j < this.format.channelCount; j++) this.channel[j].Decode2(data);
                for (let j = 0; j < this.format.channelCount; j++) this.channel[j].Decode3(this.compParam[8], this.compParam[7], this.compParam[6] + this.compParam[5], this.compParam[4]);
                for (let j = 0; j < this.format.channelCount - 1; j++) this.channel[j].Decode4(i, this.compParam[4] - this.compParam[5], this.compParam[5], this.compParam[6], this.channel[j + 1]);
                for (let j = 0; j < this.format.channelCount; j++) this.channel[j].Decode5(i);
            }
        }
    }
}

class stChannel {
    block = new Float64Array(0x80);
    base = new Float64Array(0x80);
    value = new Uint8Array(0x80);
    scale = new Uint8Array(0x80);
    value2 = new Uint8Array(8);
    type = 0;
    value3 = new Uint8Array();
    count = 0; //uint32
    wav1 = new Float64Array(0x80);
    wav2 = new Float64Array(0x80);
    wav3 = new Float64Array(0x80);
    wave = [
        new Float64Array(0x80), new Float64Array(0x80),
        new Float64Array(0x80), new Float64Array(0x80),
        new Float64Array(0x80), new Float64Array(0x80),
        new Float64Array(0x80), new Float64Array(0x80)
    ];
    Decode1(data: clData, a: number, b: number, ath = new Uint8Array(0x80)) {
        const scalelist = new Uint8Array([
            0x0E,0x0E,0x0E,0x0E,0x0E,0x0E,0x0D,0x0D,
            0x0D,0x0D,0x0D,0x0D,0x0C,0x0C,0x0C,0x0C,
            0x0C,0x0C,0x0B,0x0B,0x0B,0x0B,0x0B,0x0B,
            0x0A,0x0A,0x0A,0x0A,0x0A,0x0A,0x0A,0x09,
            0x09,0x09,0x09,0x09,0x09,0x08,0x08,0x08,
            0x08,0x08,0x08,0x07,0x06,0x06,0x05,0x04,
            0x04,0x04,0x03,0x03,0x03,0x02,0x02,0x02,
            // v2.0
            0x02,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
            // v1.3
            //0x02,0x01,0x01,0x01,0x01,0x01,0x01,0x01,
        ]);
        let v = data.read(3);
        if (v >= 6) for (let i = 0; i < this.count; i++) this.value[i] = data.read(6);
        else if (v) {
            let v1 = data.read(6);
            let v2 = (1 << v) - 1;
            let v3 = v2 >> 1;
            let v4 = 0;
            this.value[0] = v1;
            for (let i = 1; i < this.count; i++) {
                v4 = data.read(v);
                if (v4 != v2) v1 += v4 - v3;
                else v1 = data.read(6);
                this.value[i] = v1;
            }
        } else this.value.fill(0);
        if (this.type == 2) {
            v = data.check(4);
            this.value2[0] = v;
            if (v < 15) for (let i = 0; i < 8; i++) this.value2[i] = data.read(4);
        }
        else for (let i = 0; i < a; i++) this.value3[i] = data.read(6);
        for (let i = 0; i < this.count; i++) {
            v = this.value[i];
            if (v) {
                v = ath[i] + ((b + i) >> 8) - ((v * 5) >> 1) + 1;
                if (v < 0) v = 15;
                else if (v >= 0x39) v = 1;
                else v = scalelist[v];
            }
            this.scale[i] = v;
        }
        this.scale.fill(0, this.count);
        for (let i = 0; i < this.count; i++) this.base[i] = HCA.scaling_table[this.value[i]] * HCA.range_table[this.scale[i]];
    }
    Decode2(data: clData) {
        const list1 = new Uint8Array([0,2,3,3,4,4,4,4,5,6,7,8,9,10,11,12]);
        const list2 = new Uint8Array([
            0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
            1,1,2,2,0,0,0,0,0,0,0,0,0,0,0,0,
            2,2,2,2,2,2,3,3,0,0,0,0,0,0,0,0,
            2,2,3,3,3,3,3,3,0,0,0,0,0,0,0,0,
            3,3,3,3,3,3,3,3,3,3,3,3,3,3,4,4,
            3,3,3,3,3,3,3,3,3,3,4,4,4,4,4,4,
            3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,
            3,3,4,4,4,4,4,4,4,4,4,4,4,4,4,4,
        ]);
        const list3 = new Int8Array([
            +0,+0,+0,+0,+0,+0,+0,+0,+0,+0,+0,+0,+0,+0,+0,+0,
            +0,+0,+1,-1,+0,+0,+0,+0,+0,+0,+0,+0,+0,+0,+0,+0,
            +0,+0,+1,+1,-1,-1,+2,-2,+0,+0,+0,+0,+0,+0,+0,+0,
            +0,+0,+1,-1,+2,-2,+3,-3,+0,+0,+0,+0,+0,+0,+0,+0,
            +0,+0,+1,+1,-1,-1,+2,+2,-2,-2,+3,+3,-3,-3,+4,-4,
            +0,+0,+1,+1,-1,-1,+2,+2,-2,-2,+3,-3,+4,-4,+5,-5,
            +0,+0,+1,+1,-1,-1,+2,-2,+3,-3,+4,-4,+5,-5,+6,-6,
            +0,+0,+1,-1,+2,-2,+3,-3,+4,-4,+5,-5,+6,-6,+7,-7,
        ]);
        for (let i = 0; i < this.count; i++) {
            let f = 0.0;
            let s = this.scale[i];
            let bitSize = list1[s];
            let v = data.read(bitSize);
            if (s < 8) {
                v += s << 4;
                data.seek(list2[v] - bitSize);
                f = list3[v];
            } else {
                v = (1 - ((v & 1) << 1)) * (v >> 1);
                if (!v) data.seek(-1);
                f = v;
            }
            this.block[i] = this.base[i] * f;
        }
        this.block.fill(0, this.count);
    }
    Decode3(a: number, b: number, c: number, d: number) {
        if (this.type != 2 && b > 0) {
            const listInt = new Uint32Array([
                0x00000000,0x00000000,0x32A0B051,0x32D61B5E,0x330EA43A,0x333E0F68,0x337D3E0C,0x33A8B6D5,
                0x33E0CCDF,0x3415C3FF,0x34478D75,0x3484F1F6,0x34B123F6,0x34EC0719,0x351D3EDA,0x355184DF,
                0x358B95C2,0x35B9FCD2,0x35F7D0DF,0x36251958,0x365BFBB8,0x36928E72,0x36C346CD,0x370218AF,
                0x372D583F,0x3766F85B,0x3799E046,0x37CD078C,0x3808980F,0x38360094,0x38728177,0x38A18FAF,
                0x38D744FD,0x390F6A81,0x393F179A,0x397E9E11,0x39A9A15B,0x39E2055B,0x3A16942D,0x3A48A2D8,
                0x3A85AAC3,0x3AB21A32,0x3AED4F30,0x3B1E196E,0x3B52A81E,0x3B8C57CA,0x3BBAFF5B,0x3BF9295A,
                0x3C25FED7,0x3C5D2D82,0x3C935A2B,0x3CC4563F,0x3D02CD87,0x3D2E4934,0x3D68396A,0x3D9AB62B,
                0x3DCE248C,0x3E0955EE,0x3E36FD92,0x3E73D290,0x3EA27043,0x3ED87039,0x3F1031DC,0x3F40213B,
                //
                0x3F800000,0x3FAA8D26,0x3FE33F89,0x4017657D,0x4049B9BE,0x40866491,0x40B311C4,0x40EE9910,
                0x411EF532,0x4153CCF1,0x418D1ADF,0x41BC034A,0x41FA83B3,0x4226E595,0x425E60F5,0x429426FF,
                0x42C5672A,0x43038359,0x432F3B79,0x43697C38,0x439B8D3A,0x43CF4319,0x440A14D5,0x4437FBF0,
                0x4475257D,0x44A3520F,0x44D99D16,0x4510FA4D,0x45412C4D,0x4580B1ED,0x45AB7A3A,0x45E47B6D,
                0x461837F0,0x464AD226,0x46871F62,0x46B40AAF,0x46EFE4BA,0x471FD228,0x4754F35B,0x478DDF04,
                0x47BD08A4,0x47FBDFED,0x4827CD94,0x485F9613,0x4894F4F0,0x48C67991,0x49043A29,0x49302F0E,
                0x496AC0C7,0x499C6573,0x49D06334,0x4A0AD4C6,0x4A38FBAF,0x4A767A41,0x4AA43516,0x4ADACB94,
                0x4B11C3D3,0x4B4238D2,0x4B8164D2,0x4BAC6897,0x4BE5B907,0x4C190B88,0x4C4BEC15,0x00000000,
            ]);
            const listFloat = new Float32Array(listInt.buffer);
            for (let i = 0; i < a; i++) {
                for (let j = 0, k = c, l = c - 1; j < b && k < d; j++, l--) {
                    this.block[k++] = listFloat[0x40 + this.value3[i] - this.value[l]] * this.block[l];
                }
            }
            this.block[0x80 - 1] = 0;
        }
    }
    Decode4(index: number, a: number, b: number, c: number, next: stChannel) {
        if (this.type == 1 && c) {
            const listFloat = new Float64Array([
                2,      13 / 7.0, 12 / 7.0, 11 / 7.0, 10 / 7.0, 9 / 7.0, 8 / 7.0, 1,
                6 / 7.0, 5 / 7.0,  4 / 7.0,  3 / 7.0,  2 / 7.0, 1 / 7.0, 0,       0
            ]);
            let f1 = listFloat[next.value2[index]];
            let f2 = f1 - 2.0;
            for (let i = 0; i < a; i++) {
                next.block[b + i] = this.block[b + i] * f2;
                this.block[b + i] = this.block[b + i] * f1;
            }
        }
    }
    Decode5(index: number) {
        const list1Int = [
            new Uint32Array([
                0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,
                0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,
                0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,
                0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,
                0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,
                0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,
                0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,
                0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,0x3DA73D75,
            ]), 
            new Uint32Array([
                0x3F7B14BE,0x3F54DB31,0x3F7B14BE,0x3F54DB31,0x3F7B14BE,0x3F54DB31,0x3F7B14BE,0x3F54DB31,
                0x3F7B14BE,0x3F54DB31,0x3F7B14BE,0x3F54DB31,0x3F7B14BE,0x3F54DB31,0x3F7B14BE,0x3F54DB31,
                0x3F7B14BE,0x3F54DB31,0x3F7B14BE,0x3F54DB31,0x3F7B14BE,0x3F54DB31,0x3F7B14BE,0x3F54DB31,
                0x3F7B14BE,0x3F54DB31,0x3F7B14BE,0x3F54DB31,0x3F7B14BE,0x3F54DB31,0x3F7B14BE,0x3F54DB31,
                0x3F7B14BE,0x3F54DB31,0x3F7B14BE,0x3F54DB31,0x3F7B14BE,0x3F54DB31,0x3F7B14BE,0x3F54DB31,
                0x3F7B14BE,0x3F54DB31,0x3F7B14BE,0x3F54DB31,0x3F7B14BE,0x3F54DB31,0x3F7B14BE,0x3F54DB31,
                0x3F7B14BE,0x3F54DB31,0x3F7B14BE,0x3F54DB31,0x3F7B14BE,0x3F54DB31,0x3F7B14BE,0x3F54DB31,
                0x3F7B14BE,0x3F54DB31,0x3F7B14BE,0x3F54DB31,0x3F7B14BE,0x3F54DB31,0x3F7B14BE,0x3F54DB31,
            ]), 
            new Uint32Array([
                0x3F7EC46D,0x3F74FA0B,0x3F61C598,0x3F45E403,0x3F7EC46D,0x3F74FA0B,0x3F61C598,0x3F45E403,
                0x3F7EC46D,0x3F74FA0B,0x3F61C598,0x3F45E403,0x3F7EC46D,0x3F74FA0B,0x3F61C598,0x3F45E403,
                0x3F7EC46D,0x3F74FA0B,0x3F61C598,0x3F45E403,0x3F7EC46D,0x3F74FA0B,0x3F61C598,0x3F45E403,
                0x3F7EC46D,0x3F74FA0B,0x3F61C598,0x3F45E403,0x3F7EC46D,0x3F74FA0B,0x3F61C598,0x3F45E403,
                0x3F7EC46D,0x3F74FA0B,0x3F61C598,0x3F45E403,0x3F7EC46D,0x3F74FA0B,0x3F61C598,0x3F45E403,
                0x3F7EC46D,0x3F74FA0B,0x3F61C598,0x3F45E403,0x3F7EC46D,0x3F74FA0B,0x3F61C598,0x3F45E403,
                0x3F7EC46D,0x3F74FA0B,0x3F61C598,0x3F45E403,0x3F7EC46D,0x3F74FA0B,0x3F61C598,0x3F45E403,
                0x3F7EC46D,0x3F74FA0B,0x3F61C598,0x3F45E403,0x3F7EC46D,0x3F74FA0B,0x3F61C598,0x3F45E403,
            ]), 
            new Uint32Array([
                0x3F7FB10F,0x3F7D3AAC,0x3F7853F8,0x3F710908,0x3F676BD8,0x3F5B941A,0x3F4D9F02,0x3F3DAEF9,
                0x3F7FB10F,0x3F7D3AAC,0x3F7853F8,0x3F710908,0x3F676BD8,0x3F5B941A,0x3F4D9F02,0x3F3DAEF9,
                0x3F7FB10F,0x3F7D3AAC,0x3F7853F8,0x3F710908,0x3F676BD8,0x3F5B941A,0x3F4D9F02,0x3F3DAEF9,
                0x3F7FB10F,0x3F7D3AAC,0x3F7853F8,0x3F710908,0x3F676BD8,0x3F5B941A,0x3F4D9F02,0x3F3DAEF9,
                0x3F7FB10F,0x3F7D3AAC,0x3F7853F8,0x3F710908,0x3F676BD8,0x3F5B941A,0x3F4D9F02,0x3F3DAEF9,
                0x3F7FB10F,0x3F7D3AAC,0x3F7853F8,0x3F710908,0x3F676BD8,0x3F5B941A,0x3F4D9F02,0x3F3DAEF9,
                0x3F7FB10F,0x3F7D3AAC,0x3F7853F8,0x3F710908,0x3F676BD8,0x3F5B941A,0x3F4D9F02,0x3F3DAEF9,
                0x3F7FB10F,0x3F7D3AAC,0x3F7853F8,0x3F710908,0x3F676BD8,0x3F5B941A,0x3F4D9F02,0x3F3DAEF9,
            ]), 
            new Uint32Array([
                0x3F7FEC43,0x3F7F4E6D,0x3F7E1324,0x3F7C3B28,0x3F79C79D,0x3F76BA07,0x3F731447,0x3F6ED89E,
                0x3F6A09A7,0x3F64AA59,0x3F5EBE05,0x3F584853,0x3F514D3D,0x3F49D112,0x3F41D870,0x3F396842,
                0x3F7FEC43,0x3F7F4E6D,0x3F7E1324,0x3F7C3B28,0x3F79C79D,0x3F76BA07,0x3F731447,0x3F6ED89E,
                0x3F6A09A7,0x3F64AA59,0x3F5EBE05,0x3F584853,0x3F514D3D,0x3F49D112,0x3F41D870,0x3F396842,
                0x3F7FEC43,0x3F7F4E6D,0x3F7E1324,0x3F7C3B28,0x3F79C79D,0x3F76BA07,0x3F731447,0x3F6ED89E,
                0x3F6A09A7,0x3F64AA59,0x3F5EBE05,0x3F584853,0x3F514D3D,0x3F49D112,0x3F41D870,0x3F396842,
                0x3F7FEC43,0x3F7F4E6D,0x3F7E1324,0x3F7C3B28,0x3F79C79D,0x3F76BA07,0x3F731447,0x3F6ED89E,
                0x3F6A09A7,0x3F64AA59,0x3F5EBE05,0x3F584853,0x3F514D3D,0x3F49D112,0x3F41D870,0x3F396842,
            ]), 
            new Uint32Array([
                0x3F7FFB11,0x3F7FD397,0x3F7F84AB,0x3F7F0E58,0x3F7E70B0,0x3F7DABCC,0x3F7CBFC9,0x3F7BACCD,
                0x3F7A7302,0x3F791298,0x3F778BC5,0x3F75DEC6,0x3F740BDD,0x3F721352,0x3F6FF573,0x3F6DB293,
                0x3F6B4B0C,0x3F68BF3C,0x3F660F88,0x3F633C5A,0x3F604621,0x3F5D2D53,0x3F59F26A,0x3F5695E5,
                0x3F531849,0x3F4F7A1F,0x3F4BBBF8,0x3F47DE65,0x3F43E200,0x3F3FC767,0x3F3B8F3B,0x3F373A23,
                0x3F7FFB11,0x3F7FD397,0x3F7F84AB,0x3F7F0E58,0x3F7E70B0,0x3F7DABCC,0x3F7CBFC9,0x3F7BACCD,
                0x3F7A7302,0x3F791298,0x3F778BC5,0x3F75DEC6,0x3F740BDD,0x3F721352,0x3F6FF573,0x3F6DB293,
                0x3F6B4B0C,0x3F68BF3C,0x3F660F88,0x3F633C5A,0x3F604621,0x3F5D2D53,0x3F59F26A,0x3F5695E5,
                0x3F531849,0x3F4F7A1F,0x3F4BBBF8,0x3F47DE65,0x3F43E200,0x3F3FC767,0x3F3B8F3B,0x3F373A23,
            ]), 
            new Uint32Array([
                0x3F7FFEC4,0x3F7FF4E6,0x3F7FE129,0x3F7FC38F,0x3F7F9C18,0x3F7F6AC7,0x3F7F2F9D,0x3F7EEA9D,
                0x3F7E9BC9,0x3F7E4323,0x3F7DE0B1,0x3F7D7474,0x3F7CFE73,0x3F7C7EB0,0x3F7BF531,0x3F7B61FC,
                0x3F7AC516,0x3F7A1E84,0x3F796E4E,0x3F78B47B,0x3F77F110,0x3F772417,0x3F764D97,0x3F756D97,
                0x3F748422,0x3F73913F,0x3F7294F8,0x3F718F57,0x3F708066,0x3F6F6830,0x3F6E46BE,0x3F6D1C1D,
                0x3F6BE858,0x3F6AAB7B,0x3F696591,0x3F6816A8,0x3F66BECC,0x3F655E0B,0x3F63F473,0x3F628210,
                0x3F6106F2,0x3F5F8327,0x3F5DF6BE,0x3F5C61C7,0x3F5AC450,0x3F591E6A,0x3F577026,0x3F55B993,
                0x3F53FAC3,0x3F5233C6,0x3F5064AF,0x3F4E8D90,0x3F4CAE79,0x3F4AC77F,0x3F48D8B3,0x3F46E22A,
                0x3F44E3F5,0x3F42DE29,0x3F40D0DA,0x3F3EBC1B,0x3F3CA003,0x3F3A7CA4,0x3F385216,0x3F36206C,
            ])
        ];
        const list2Int = [
            new Uint32Array([
                0xBD0A8BD4,0x3D0A8BD4,0x3D0A8BD4,0xBD0A8BD4,0x3D0A8BD4,0xBD0A8BD4,0xBD0A8BD4,0x3D0A8BD4,
                0x3D0A8BD4,0xBD0A8BD4,0xBD0A8BD4,0x3D0A8BD4,0xBD0A8BD4,0x3D0A8BD4,0x3D0A8BD4,0xBD0A8BD4,
                0x3D0A8BD4,0xBD0A8BD4,0xBD0A8BD4,0x3D0A8BD4,0xBD0A8BD4,0x3D0A8BD4,0x3D0A8BD4,0xBD0A8BD4,
                0xBD0A8BD4,0x3D0A8BD4,0x3D0A8BD4,0xBD0A8BD4,0x3D0A8BD4,0xBD0A8BD4,0xBD0A8BD4,0x3D0A8BD4,
                0x3D0A8BD4,0xBD0A8BD4,0xBD0A8BD4,0x3D0A8BD4,0xBD0A8BD4,0x3D0A8BD4,0x3D0A8BD4,0xBD0A8BD4,
                0xBD0A8BD4,0x3D0A8BD4,0x3D0A8BD4,0xBD0A8BD4,0x3D0A8BD4,0xBD0A8BD4,0xBD0A8BD4,0x3D0A8BD4,
                0xBD0A8BD4,0x3D0A8BD4,0x3D0A8BD4,0xBD0A8BD4,0x3D0A8BD4,0xBD0A8BD4,0xBD0A8BD4,0x3D0A8BD4,
                0x3D0A8BD4,0xBD0A8BD4,0xBD0A8BD4,0x3D0A8BD4,0xBD0A8BD4,0x3D0A8BD4,0x3D0A8BD4,0xBD0A8BD4,
            ]), 
            new Uint32Array([
                0xBE47C5C2,0xBF0E39DA,0x3E47C5C2,0x3F0E39DA,0x3E47C5C2,0x3F0E39DA,0xBE47C5C2,0xBF0E39DA,
                0x3E47C5C2,0x3F0E39DA,0xBE47C5C2,0xBF0E39DA,0xBE47C5C2,0xBF0E39DA,0x3E47C5C2,0x3F0E39DA,
                0x3E47C5C2,0x3F0E39DA,0xBE47C5C2,0xBF0E39DA,0xBE47C5C2,0xBF0E39DA,0x3E47C5C2,0x3F0E39DA,
                0xBE47C5C2,0xBF0E39DA,0x3E47C5C2,0x3F0E39DA,0x3E47C5C2,0x3F0E39DA,0xBE47C5C2,0xBF0E39DA,
                0x3E47C5C2,0x3F0E39DA,0xBE47C5C2,0xBF0E39DA,0xBE47C5C2,0xBF0E39DA,0x3E47C5C2,0x3F0E39DA,
                0xBE47C5C2,0xBF0E39DA,0x3E47C5C2,0x3F0E39DA,0x3E47C5C2,0x3F0E39DA,0xBE47C5C2,0xBF0E39DA,
                0xBE47C5C2,0xBF0E39DA,0x3E47C5C2,0x3F0E39DA,0x3E47C5C2,0x3F0E39DA,0xBE47C5C2,0xBF0E39DA,
                0x3E47C5C2,0x3F0E39DA,0xBE47C5C2,0xBF0E39DA,0xBE47C5C2,0xBF0E39DA,0x3E47C5C2,0x3F0E39DA,
            ]), 
            new Uint32Array([
                0xBDC8BD36,0xBE94A031,0xBEF15AEA,0xBF226799,0x3DC8BD36,0x3E94A031,0x3EF15AEA,0x3F226799,
                0x3DC8BD36,0x3E94A031,0x3EF15AEA,0x3F226799,0xBDC8BD36,0xBE94A031,0xBEF15AEA,0xBF226799,
                0x3DC8BD36,0x3E94A031,0x3EF15AEA,0x3F226799,0xBDC8BD36,0xBE94A031,0xBEF15AEA,0xBF226799,
                0xBDC8BD36,0xBE94A031,0xBEF15AEA,0xBF226799,0x3DC8BD36,0x3E94A031,0x3EF15AEA,0x3F226799,
                0x3DC8BD36,0x3E94A031,0x3EF15AEA,0x3F226799,0xBDC8BD36,0xBE94A031,0xBEF15AEA,0xBF226799,
                0xBDC8BD36,0xBE94A031,0xBEF15AEA,0xBF226799,0x3DC8BD36,0x3E94A031,0x3EF15AEA,0x3F226799,
                0xBDC8BD36,0xBE94A031,0xBEF15AEA,0xBF226799,0x3DC8BD36,0x3E94A031,0x3EF15AEA,0x3F226799,
                0x3DC8BD36,0x3E94A031,0x3EF15AEA,0x3F226799,0xBDC8BD36,0xBE94A031,0xBEF15AEA,0xBF226799,
            ]), 
            new Uint32Array([
                0xBD48FB30,0xBE164083,0xBE78CFCC,0xBEAC7CD4,0xBEDAE880,0xBF039C3D,0xBF187FC0,0xBF2BEB4A,
                0x3D48FB30,0x3E164083,0x3E78CFCC,0x3EAC7CD4,0x3EDAE880,0x3F039C3D,0x3F187FC0,0x3F2BEB4A,
                0x3D48FB30,0x3E164083,0x3E78CFCC,0x3EAC7CD4,0x3EDAE880,0x3F039C3D,0x3F187FC0,0x3F2BEB4A,
                0xBD48FB30,0xBE164083,0xBE78CFCC,0xBEAC7CD4,0xBEDAE880,0xBF039C3D,0xBF187FC0,0xBF2BEB4A,
                0x3D48FB30,0x3E164083,0x3E78CFCC,0x3EAC7CD4,0x3EDAE880,0x3F039C3D,0x3F187FC0,0x3F2BEB4A,
                0xBD48FB30,0xBE164083,0xBE78CFCC,0xBEAC7CD4,0xBEDAE880,0xBF039C3D,0xBF187FC0,0xBF2BEB4A,
                0xBD48FB30,0xBE164083,0xBE78CFCC,0xBEAC7CD4,0xBEDAE880,0xBF039C3D,0xBF187FC0,0xBF2BEB4A,
                0x3D48FB30,0x3E164083,0x3E78CFCC,0x3EAC7CD4,0x3EDAE880,0x3F039C3D,0x3F187FC0,0x3F2BEB4A,
            ]), 
            new Uint32Array([
                0xBCC90AB0,0xBD96A905,0xBDFAB273,0xBE2F10A2,0xBE605C13,0xBE888E93,0xBEA09AE5,0xBEB8442A,
                0xBECF7BCA,0xBEE63375,0xBEFC5D27,0xBF08F59B,0xBF13682A,0xBF1D7FD1,0xBF273656,0xBF3085BB,
                0x3CC90AB0,0x3D96A905,0x3DFAB273,0x3E2F10A2,0x3E605C13,0x3E888E93,0x3EA09AE5,0x3EB8442A,
                0x3ECF7BCA,0x3EE63375,0x3EFC5D27,0x3F08F59B,0x3F13682A,0x3F1D7FD1,0x3F273656,0x3F3085BB,
                0x3CC90AB0,0x3D96A905,0x3DFAB273,0x3E2F10A2,0x3E605C13,0x3E888E93,0x3EA09AE5,0x3EB8442A,
                0x3ECF7BCA,0x3EE63375,0x3EFC5D27,0x3F08F59B,0x3F13682A,0x3F1D7FD1,0x3F273656,0x3F3085BB,
                0xBCC90AB0,0xBD96A905,0xBDFAB273,0xBE2F10A2,0xBE605C13,0xBE888E93,0xBEA09AE5,0xBEB8442A,
                0xBECF7BCA,0xBEE63375,0xBEFC5D27,0xBF08F59B,0xBF13682A,0xBF1D7FD1,0xBF273656,0xBF3085BB,
            ]), 
            new Uint32Array([
                0xBC490E90,0xBD16C32C,0xBD7B2B74,0xBDAFB680,0xBDE1BC2E,0xBE09CF86,0xBE22ABB6,0xBE3B6ECF,
                0xBE541501,0xBE6C9A7F,0xBE827DC0,0xBE8E9A22,0xBE9AA086,0xBEA68F12,0xBEB263EF,0xBEBE1D4A,
                0xBEC9B953,0xBED53641,0xBEE0924F,0xBEEBCBBB,0xBEF6E0CB,0xBF00E7E4,0xBF064B82,0xBF0B9A6B,
                0xBF10D3CD,0xBF15F6D9,0xBF1B02C6,0xBF1FF6CB,0xBF24D225,0xBF299415,0xBF2E3BDE,0xBF32C8C9,
                0x3C490E90,0x3D16C32C,0x3D7B2B74,0x3DAFB680,0x3DE1BC2E,0x3E09CF86,0x3E22ABB6,0x3E3B6ECF,
                0x3E541501,0x3E6C9A7F,0x3E827DC0,0x3E8E9A22,0x3E9AA086,0x3EA68F12,0x3EB263EF,0x3EBE1D4A,
                0x3EC9B953,0x3ED53641,0x3EE0924F,0x3EEBCBBB,0x3EF6E0CB,0x3F00E7E4,0x3F064B82,0x3F0B9A6B,
                0x3F10D3CD,0x3F15F6D9,0x3F1B02C6,0x3F1FF6CB,0x3F24D225,0x3F299415,0x3F2E3BDE,0x3F32C8C9,
            ]), 
            new Uint32Array([
                0xBBC90F88,0xBC96C9B6,0xBCFB49BA,0xBD2FE007,0xBD621469,0xBD8A200A,0xBDA3308C,0xBDBC3AC3,
                0xBDD53DB9,0xBDEE3876,0xBE039502,0xBE1008B7,0xBE1C76DE,0xBE28DEFC,0xBE354098,0xBE419B37,
                0xBE4DEE60,0xBE5A3997,0xBE667C66,0xBE72B651,0xBE7EE6E1,0xBE8586CE,0xBE8B9507,0xBE919DDD,
                0xBE97A117,0xBE9D9E78,0xBEA395C5,0xBEA986C4,0xBEAF713A,0xBEB554EC,0xBEBB31A0,0xBEC1071E,
                0xBEC6D529,0xBECC9B8B,0xBED25A09,0xBED8106B,0xBEDDBE79,0xBEE363FA,0xBEE900B7,0xBEEE9479,
                0xBEF41F07,0xBEF9A02D,0xBEFF17B2,0xBF0242B1,0xBF04F484,0xBF07A136,0xBF0A48AD,0xBF0CEAD0,
                0xBF0F8784,0xBF121EB0,0xBF14B039,0xBF173C07,0xBF19C200,0xBF1C420C,0xBF1EBC12,0xBF212FF9,
                0xBF239DA9,0xBF26050A,0xBF286605,0xBF2AC082,0xBF2D1469,0xBF2F61A5,0xBF31A81D,0xBF33E7BC,
            ])
        ];
        const list3Int = new Uint32Array([
            0x3A3504F0,0x3B0183B8,0x3B70C538,0x3BBB9268,0x3C04A809,0x3C308200,0x3C61284C,0x3C8B3F17,
            0x3CA83992,0x3CC77FBD,0x3CE91110,0x3D0677CD,0x3D198FC4,0x3D2DD35C,0x3D434643,0x3D59ECC1,
            0x3D71CBA8,0x3D85741E,0x3D92A413,0x3DA078B4,0x3DAEF522,0x3DBE1C9E,0x3DCDF27B,0x3DDE7A1D,
            0x3DEFB6ED,0x3E00D62B,0x3E0A2EDA,0x3E13E72A,0x3E1E00B1,0x3E287CF2,0x3E335D55,0x3E3EA321,
            0x3E4A4F75,0x3E56633F,0x3E62DF37,0x3E6FC3D1,0x3E7D1138,0x3E8563A2,0x3E8C72B7,0x3E93B561,
            0x3E9B2AEF,0x3EA2D26F,0x3EAAAAAB,0x3EB2B222,0x3EBAE706,0x3EC34737,0x3ECBD03D,0x3ED47F46,
            0x3EDD5128,0x3EE6425C,0x3EEF4EFF,0x3EF872D7,0x3F00D4A9,0x3F0576CA,0x3F0A1D3B,0x3F0EC548,
            0x3F136C25,0x3F180EF2,0x3F1CAAC2,0x3F213CA2,0x3F25C1A5,0x3F2A36E7,0x3F2E9998,0x3F32E705,
            //
            0xBF371C9E,0xBF3B37FE,0xBF3F36F2,0xBF431780,0xBF46D7E6,0xBF4A76A4,0xBF4DF27C,0xBF514A6F,
            0xBF547DC5,0xBF578C03,0xBF5A74EE,0xBF5D3887,0xBF5FD707,0xBF6250DA,0xBF64A699,0xBF66D908,
            0xBF68E90E,0xBF6AD7B1,0xBF6CA611,0xBF6E5562,0xBF6FE6E7,0xBF715BEF,0xBF72B5D1,0xBF73F5E6,
            0xBF751D89,0xBF762E13,0xBF7728D7,0xBF780F20,0xBF78E234,0xBF79A34C,0xBF7A5397,0xBF7AF439,
            0xBF7B8648,0xBF7C0ACE,0xBF7C82C8,0xBF7CEF26,0xBF7D50CB,0xBF7DA88E,0xBF7DF737,0xBF7E3D86,
            0xBF7E7C2A,0xBF7EB3CC,0xBF7EE507,0xBF7F106C,0xBF7F3683,0xBF7F57CA,0xBF7F74B6,0xBF7F8DB6,
            0xBF7FA32E,0xBF7FB57B,0xBF7FC4F6,0xBF7FD1ED,0xBF7FDCAD,0xBF7FE579,0xBF7FEC90,0xBF7FF22E,
            0xBF7FF688,0xBF7FF9D0,0xBF7FFC32,0xBF7FFDDA,0xBF7FFEED,0xBF7FFF8F,0xBF7FFFDF,0xBF7FFFFC,
        ]);
        let s = this.block, s0 = 0;
        let d = this.wav1, d0 = 0;
        for (let i = 0, count1 = 1, count2 = 0x40; i < 7; i++, count1 <<= 1, count2 >>= 1) {
            let d1 = 0;
            let d2 = count2;
            for (let j = 0; j < count1; j++) {
                for (let k = 0; k < count2; k++) {
                    let a = s[s0++];
                    let b = s[s0++];
                    d[d0 + d1++] = b + a;
                    d[d0 + d2++] = a - b;
                }
                d1 += count2;
                d2 += count2;
            }
            let w = s;
            d0 = s0 - 0x80;
            s = d;
            s0 = 0;
            d = w;
        }
        s = this.wav1;
        d = this.block;
        for (let i = 0, count1 = 0x40, count2 = 1; i < 7; i++, count1 >>= 1, count2 <<= 1) {
            let list1Float = new Float32Array(list1Int[i].buffer), l0 = 0;
            let list2Float = new Float32Array(list2Int[i].buffer), l1 = 0;
            let s1 = 0;
            let s2 = count2;
            let d1 = 0;
            let d2 = count2 * 2 - 1;
            for (let j = 0; j < count1; j++) {
                for (let k = 0; k < count2; k++) {
                    let a = s[s1++];
                    let b = s[s2++];
                    let c = list1Float[l0++];
                    let e = list2Float[l1++];
                    d[d1++] = a*c - b*e;
                    d[d2--] = a*e + b*c;
                }
                s1 += count2;
                s2 += count2;
                d1 += count2;
                d2 += count2 * 3;
            }
            let w = s;
            s = d;
            d = w;
        }
        d = this.wav2;
        d.set(s);
        let list3Float = new Float32Array(list3Int.buffer);
        s0 = 0;
        d = this.wave[index];
        d0 = 0;
        let s1 = 0x40;
        let s2 = 0;
        for (let i = 0; i<0x40; i++) d[d0++] = this.wav2[s1++] * list3Float[s0++] + this.wav3[s2++];
        for (let i = 0; i<0x40; i++) d[d0++] = this.wav2[--s1] * list3Float[s0++] - this.wav3[s2++];
        s1 = 0x40 - 1;
        s2 = 0;
        for (let i = 0; i<0x40; i++) this.wav3[s2++] = list3Float[--s0] * this.wav2[s1--];
        for (let i = 0; i<0x40; i++) this.wav3[s2++] = list3Float[--s0] * this.wav2[++s1];
    }
}

class clData{
    _data: Uint8Array;
    _size: number;
    _bit = 0;
    constructor (size: number, data: Uint8Array) {
        this._data = data;
        this._size = size * 8 - 16;
    }
    static mask = [ 0xFFFFFF,0x7FFFFF,0x3FFFFF,0x1FFFFF,0x0FFFFF,0x07FFFF,0x03FFFF,0x01FFFF ];
    CheckBit (bitSize: number) {
        let v = 0;
        if (this._bit + bitSize <= this._size) {
            let data = this._data.subarray(this._bit >> 3);
            v = data[0];
            v = (v << 8) | data[1];
            v = (v << 8) | data[2];
            v &= clData.mask[this._bit & 7];
            v >>= 24 - (this._bit & 7) - bitSize;
        }
        return v;
    }
    check = this.CheckBit;
    GetBit (bitSize: number) {
        let v = this.CheckBit(bitSize);
        this._bit += bitSize;
        return v;
    }
    read = this.GetBit;
    AddBit (bitSize: number) {
        this._bit += bitSize;
    }
    seek = this.AddBit;
}