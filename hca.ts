const scaling_table = new Float64Array(64);
const scale_conversion_table = new Float64Array(128);
for (let i = 0; i < 64; i++) scaling_table[i] = Math.pow(2, (i - 63) * 53.0 / 128.0 + 3.5);
for (let i = 2; i < 127; i++) scale_conversion_table[i] = Math.pow(2, (i - 64) * 53.0 / 128.0);

class HCAInfo {
    private rawHeader: Uint8Array;

    version = "";
    dataOffset = 0;
    format = {
        channelCount: 0,
        samplingRate: 0,
        blockCount: 0,
        droppedHeader: 0,
        droppedFooter: 0
    }
    blockSize = 0;
    hasHeader: Record<string, boolean> = {};
    headerOffset: Record<string, [number, number]> = {}; // [start (inclusive), end (exclusive)]
    bps = 0;
    compDec = {
        MinResolution: 0,
        MaxResolution: 0,
        TrackCount: 0,
        ChannelConfig: 0,
        TotalBandCount: 0,
        BaseBandCount: 0,
        StereoBandCount: 0,
        HfrBandCount: 0,
        BandsPerHfrGroup: 0,
        Reserved1: 0,
        Reserved2: 0,
    };
    dec = {
        DecStereoType: 0,
    }
    loop = {
        start: 0,
        end: 0,
        // count: 0, // Nyagamon's interpretation
        // r01: 0,
        droppedHeader: 0, // VGAudio's interpretation
        droppedFooter: 0,
    }
    vbr = {
        MaxBlockSize: 0,
        NoiseLevel: 0,
    }
    UseAthCurve: boolean = false;
    cipher = 0;
    rva = 0.0;
    comment = "";

    // computed sample count/offsets
    HfrGroupCount = 0;
    fullSampleCount = 0;
    startAtSample = 0;
    endAtSample = 0;
    loopStartAtSample = 0;
    loopEndAtSample = 0;
    private static getSign(raw: DataView, offset = 0, changeMask: boolean, encrypt: boolean) {
        let magic = raw.getUint32(offset, true);
        let strLen = 4;
        for (let i = 0; i < 4; i++) {
            if (raw.getUint8(offset + i) == 0) {
                strLen = i;
                break;
            }
        }
        if (strLen > 0) {
            let mask = 0x80808080 >>> 8 * (4 - strLen);
            magic &= 0x7f7f7f7f;
            if (changeMask) raw.setUint32(offset, encrypt ? magic | mask : magic, true);
        }
        let hex = [magic & 0xff, magic >> 8 & 0xff, magic >> 16 & 0xff, magic >> 24 & 0xff];
        hex = hex.slice(0, strLen);
        return String.fromCharCode.apply(String, hex);
    }
    clone(): HCAInfo {
        return new HCAInfo(this.rawHeader);
    }
    private parseHeader(hca: Uint8Array, changeMask: boolean, encrypt: boolean, modList: Record<string, Uint8Array>) {
        let p = new DataView(hca.buffer, hca.byteOffset, 8);
        let head = HCAInfo.getSign(p, 0, false, encrypt); // do not overwrite for now, until checksum verified
        if (head !== "HCA") {
            throw new Error("Not a HCA file");
        }
        const version = {
            main: p.getUint8(4),
            sub:  p.getUint8(5)
        }
        this.version = version.main + '.' + version.sub;
        this.dataOffset = p.getUint16(6);
        // verify checksum
        HCACrc16.verify(hca, this.dataOffset - 2);
        let hasModDone = false;
        // checksum verified, now we can overwrite it
        if (changeMask) HCAInfo.getSign(p, 0, changeMask, encrypt);
        // parse the header
        p = new DataView(hca.buffer, hca.byteOffset, this.dataOffset);
        let ftell = 8;
        while (ftell < this.dataOffset - 2) {
            let lastFtell = ftell;
            // get the sig
            let sign = HCAInfo.getSign(p, ftell, changeMask, encrypt);
            // record hasHeader
            this.hasHeader[sign] = true;
            // padding should be the last one
            if (sign == "pad") {
                this.headerOffset[sign] = [ftell, this.dataOffset - 2];
                break;
            }
            // parse data accordingly
            switch (sign) {
                case "fmt":
                    this.format.channelCount = p.getUint8(ftell + 4);
                    this.format.samplingRate = p.getUint32(ftell + 4) & 0x00ffffff;
                    this.format.blockCount = p.getUint32(ftell + 8);
                    this.format.droppedHeader = p.getUint16(ftell + 12);
                    this.format.droppedFooter = p.getUint16(ftell + 14);
                    ftell += 16;
                    break;
                case "comp":
                    this.blockSize = p.getUint16(ftell + 4);
                    this.bps = this.format.samplingRate * this.blockSize / 128000.0;
                    this.compDec.MinResolution = p.getUint8(ftell + 6);
                    this.compDec.MaxResolution = p.getUint8(ftell + 7);
                    this.compDec.TrackCount = p.getUint8(ftell + 8);
                    this.compDec.ChannelConfig = p.getUint8(ftell + 9);
                    this.compDec.TotalBandCount = p.getUint8(ftell + 10);
                    this.compDec.BaseBandCount = p.getUint8(ftell + 11);
                    this.compDec.StereoBandCount = p.getUint8(ftell + 12);
                    this.compDec.BandsPerHfrGroup = p.getUint8(ftell + 13);
                    this.compDec.Reserved1 = p.getUint8(ftell + 14);
                    this.compDec.Reserved2 = p.getUint8(ftell + 15);
                    ftell += 16;
                    break;
                case "dec":
                    this.blockSize = p.getUint16(ftell + 4);
                    this.bps = this.format.samplingRate * this.blockSize / 128000.0;
                    this.compDec.MinResolution = p.getUint8(ftell + 6);
                    this.compDec.MaxResolution = p.getUint8(ftell + 7);
                    this.compDec.TotalBandCount = p.getUint8(ftell + 8); + 1;
                    this.compDec.BaseBandCount = p.getUint8(ftell + 9); + 1;
                    let a = p.getUint8(ftell + 10);
                    this.compDec.TrackCount = HCAUtilFunc.GetHighNibble(a);
                    this.compDec.ChannelConfig = HCAUtilFunc.GetLowNibble(a);
                    this.dec.DecStereoType = p.getUint8(ftell + 11);
                    if (this.dec.DecStereoType == 0) {
                        this.compDec.BaseBandCount = this.compDec.TotalBandCount;
                    } else {
                        this.compDec.StereoBandCount = this.compDec.TotalBandCount - this.compDec.BaseBandCount;
                    }
                    ftell += 12;
                    break;
                case "vbr":
                    ftell += 8;
                    break;
                case "ath":
                    this.UseAthCurve = p.getUint16(ftell + 4) == 1;
                    ftell += 6;
                    break;
                case "loop":
                    this.loop.start = p.getUint32(ftell + 4);
                    this.loop.end = p.getUint32(ftell + 8);
                    this.loop.droppedHeader = p.getUint16(ftell + 12);
                    this.loop.droppedFooter = p.getUint16(ftell + 14);
                    ftell += 16;
                    break;
                case "ciph":
                    this.cipher = p.getUint16(ftell + 4);
                    ftell += 6;
                    break;
                case "rva":
                    this.rva = p.getFloat32(ftell + 4);
                    ftell += 8;
                    break;
                case "vbr":
                    this.vbr.MaxBlockSize = p.getUint16(ftell + 4);
                    this.vbr.NoiseLevel = p.getInt16(ftell + 6);
                    break;
                case "comm":
                    let len = p.getUint8(ftell + 4);
                    let jisdecoder = new TextDecoder('shift-jis');
                    this.comment = jisdecoder.decode(hca.slice(ftell + 5, ftell + 5 + len));
                    break;
                default: throw new Error("unknown header sig");
            }
            // record headerOffset
            this.headerOffset[sign] = [lastFtell, ftell];
            // do modification if needed
            let sectionDataLen = ftell - lastFtell - 4;
            let newData = modList[sign];
            if (newData != null) {
                if (newData.byteLength > sectionDataLen) throw new Error("newData.byteLength > sectionDataLen");
                hca.set(newData, lastFtell + 4);
                hasModDone = true;
            }
        }
        /*
        // (ported from) Nyagamon's original code, should be (almost) equivalent to CalculateHfrValues
        this.compParam[2] = this.compParam[2] || 1;
        let _a = this.compParam[4] - this.compParam[5] - this.compParam[6];
        let _b = this.compParam[7];
        this.compDec.Reserved1 = _b > 0 ? _a / _b + (_a % _b ? 1 : 0) : 0;
        // Translating the above code with meaningful variable names:
        this.compDec.TrackCount = this.compDec.TrackCount || 1;
        this.compDec.HfrBandCount = this.compDec.TotalBandCount - this.compDec.BaseBandCount - this.compDec.StereoBandCount;
        this.HfrGroupCount = this.compDec.BandsPerHfrGroup;
        this.compDec.Reserved1 = this.HfrGroupCount > 0 ? this.compDec.HfrBandCount / this.HfrGroupCount + (this.compDec.HfrBandCount % this.HfrGroupCount ? 1 : 0) : 0;
        */
        // CalculateHfrValues, ported from VGAudio
        if (this.compDec.BandsPerHfrGroup > 0) {
            this.compDec.HfrBandCount = this.compDec.TotalBandCount - this.compDec.BaseBandCount - this.compDec.StereoBandCount;
            this.HfrGroupCount = HCAUtilFunc.DivideByRoundUp(this.compDec.HfrBandCount, this.compDec.BandsPerHfrGroup);
        }
        // calculate sample count/offsets
        this.fullSampleCount = this.format.blockCount * 0x400;
        this.startAtSample = this.format.droppedHeader;
        this.endAtSample = this.fullSampleCount - this.format.droppedFooter;
        if (this.hasHeader["loop"]) {
            this.loopStartAtSample = this.loop.start * 0x400 + this.loop.droppedHeader;
            this.loopEndAtSample = (this.loop.end + 1) * 0x400 - this.loop.droppedFooter;
        }
        if (changeMask || hasModDone) {
            // fix checksum if requested
            HCACrc16.fix(hca, this.dataOffset - 2);
        }
        let rawHeader = hca.slice(0, this.dataOffset);
        // check validity of parsed values
        this.checkValidity();
        return rawHeader;
    }
    private checkValidity(): void {
        const results: Array<boolean> = [
            this.blockSize > 0,
            0 < this.format.blockCount,
            0 <= this.startAtSample,
            this.startAtSample < this.endAtSample,
            this.endAtSample <= this.fullSampleCount,
        ];
        results.find((result, index) => {
            if (!result) {
                throw new Error(`did not pass normal check on rule ${index}`);
            }
        });
        if (this.hasHeader["loop"]) {
            const loopChecks: Array<boolean> = [
                this.startAtSample <= this.loopStartAtSample,
                this.loopStartAtSample < this.loopEndAtSample,
                this.loopEndAtSample <= this.endAtSample,
            ];
            loopChecks.find((result, index) => {
                if (!result) {
                    throw new Error(`did not pass loop check on rule ${index}`);
                }
            });
        }
    }
    private isHeaderChanged(hca: Uint8Array): boolean {
        if (hca.length >= this.rawHeader.length) {
            for (let i = 0; i < this.rawHeader.length; i++) {
                if (hca[i] != this.rawHeader[i]) {
                    return true;
                }
            }
        } else return true;
        return false;
    }
    modify(hca: Uint8Array, sig: string, newData: Uint8Array): void {
        // reparse header if needed
        if (this.isHeaderChanged(hca)) {
            this.parseHeader(hca, false, false, {});
        }
        // prepare to modify data in-place
        let modList: Record<string, Uint8Array> = {};
        modList[sig] = newData;
        let encrypt = this.cipher != 0;
        if (sig === "ciph") {
            encrypt = new DataView(newData.buffer, newData.byteOffset, newData.byteLength).getUint16(0) != 0;
        }
        // do actual modification & check validity
        this.rawHeader = this.parseHeader(hca, true, encrypt, modList);
    }
    static addHeader(hca: Uint8Array, sig: string, newData: Uint8Array): Uint8Array {
        // sig must consist of 1-4 ASCII characters
        if (sig.length < 1 || sig.length > 4) throw new Error("sig.length < 1 || sig.length > 4");
        let newSig = new Uint8Array(4);
        for (let i = 0; i < 4; i++) {
            let c = sig.charCodeAt(i);
            if (c >= 0x80) throw new Error("sig.charCodeAt(i) >= 0x80");
            newSig[i] = c;
        }
        // parse header & check validty
        let info = new HCAInfo(hca);
        // check whether specified header section already exists
        if (info.hasHeader[sig]) throw new Error(`header section ${sig} already exists`);
        // prepare a newly allocated buffer
        let newHca = new Uint8Array(hca.byteLength + newSig.byteLength + newData.byteLength);
        let insertOffset = info.headerOffset["pad"][0];
        // copy existing headers (except padding)
        newHca.set(hca.subarray(0, insertOffset), 0);
        // copy inserted header
        newHca.set(newSig, insertOffset);
        newHca.set(newData, insertOffset + newSig.byteLength);
        // copy remaining data (padding and blocks)
        newHca.set(hca.subarray(insertOffset, hca.byteLength), insertOffset + newSig.byteLength + newData.byteLength);
        // update dataOffset
        info.dataOffset += newSig.byteLength + newData.byteLength;
        let p = new DataView(newHca.buffer, newHca.byteOffset, newHca.byteLength);
        p.setInt16(6, info.dataOffset);
        // fix checksum
        HCACrc16.fix(newHca, info.dataOffset - 2);
        // reparse header & recheck validty
        info = new HCAInfo(newHca);
        return newHca;
    }
    static addCipherHeader(hca: Uint8Array, cipherType: number | undefined = undefined): Uint8Array {
        let newData = new Uint8Array(2);
        if (cipherType != null) new DataView(newData.buffer).setUint16(0, cipherType);
        return this.addHeader(hca, "ciph", newData);
    }
    static fixHeaderChecksum(hca: Uint8Array): Uint8Array {
        let p = new DataView(hca.buffer, hca.byteOffset, 8);
        let head = this.getSign(p, 0, false, false);
        if (head !== "HCA") {
            throw new Error("Not a HCA file");
        }
        let dataOffset = p.getUint16(6);
        HCACrc16.fix(hca, dataOffset - 2);
        return hca;
    }
    constructor (hca: Uint8Array, changeMask: boolean = false, encrypt: boolean = false) {
        // if changeMask == true, (un)mask the header sigs in-place
        this.rawHeader = this.parseHeader(hca, changeMask, encrypt, {});
    }
}

class HCAUtilFunc
{
    static DivideByRoundUp(/*int*/ value: number, /*int*/ divisor: number): number
    {
        return Math.ceil(value / divisor);
    }
    static GetHighNibble(value: number): number
    {
        return (value >> 4) & 0xF;
    }
    static GetLowNibble(value: number): number
    {
        return value & 0xF;
    }
}

class HCA {
    static scaling_table = scaling_table;
    static scale_conversion_table = scale_conversion_table;
    static range_table = new Float64Array([
        0,         2.0 / 3,    2.0 / 5,    2.0 / 7,
        2.0 / 9,   2.0 / 11,   2.0 / 13,   2.0 / 15,
        2.0 / 31,  2.0 / 63,   2.0 / 127,  2.0 / 255,
        2.0 / 511, 2.0 / 1023, 2.0 / 2047, 2.0 / 4095
    ]);

    constructor () {
    }

    static decrypt(hca: Uint8Array, key1: any = undefined, key2: any = undefined): Uint8Array {
        return this.decryptOrEncrypt(hca, false, key1, key2);
    }
    static encrypt(hca: Uint8Array, key1: any = undefined, key2: any = undefined): Uint8Array {
        return this.decryptOrEncrypt(hca, true, key1, key2);
    }
    static decryptOrEncrypt(hca: Uint8Array, encrypt: boolean, key1: any = undefined, key2: any = undefined): Uint8Array {
        // in-place decryption/encryption
        // parse header
        let info = new HCAInfo(hca); // throws "Not a HCA file" if mismatch
        if (!encrypt && !info.hasHeader["ciph"]) {
            return hca; // not encrypted
        } else if (encrypt && !info.hasHeader["ciph"]) {
            throw new Error("Input hca lacks \"ciph\" header section. Please call HCAInfo.addCipherHeader(hca) first.");
        }
        let cipher: HCACipher;
        switch (info.cipher) {
            case 0:
                // not encrypted
                if (encrypt) cipher = new HCACipher(key1, key2).invertTable();
                else return hca;
                break;
            case 1:
                // encrypted with "no key"
                if (encrypt) throw new Error("already encrypted with \"no key\", please decrypt first");
                else cipher = new HCACipher("none"); // ignore given keys
                break;
            case 0x38:
                // encrypted with keys - will yield incorrect waveform if incorrect keys are given!
                if (encrypt) throw new Error("already encrypted with specific keys, please decrypt with correct keys first");
                else cipher = new HCACipher(key1, key2);
                break;
            default:
                throw new Error("unknown ciph.type");
        }
        for (let i = 0; i < info.format.blockCount; ++i) {
            let ftell = info.dataOffset + info.blockSize * i;
            let block = hca.subarray(ftell, ftell + info.blockSize);
            // verify block checksum
            HCACrc16.verify(block, info.blockSize - 2);
            // decrypt/encrypt block
            cipher.mask(block, 0, info.blockSize - 2);
            // fix checksum
            HCACrc16.fix(block, info.blockSize - 2);
        }
        // re-(un)mask headers, and set ciph header to new value
        let newCipherData = new Uint8Array(2);
        let newCipherType = encrypt ? cipher.getType() : 0;
        new DataView(newCipherData.buffer).setUint16(0, newCipherType);
        info.modify(hca, "ciph", newCipherData);
        return hca;
    }
    static decode(hca: Uint8Array, mode = 32, loop = 0, volume = 1.0) {
        switch (mode) {
            case 0: // float
            case 8: case 16: case 24: case 32: // integer
                break;
            default:
                mode = 32;
        }
        if (volume > 1) volume = 1;
        else if (volume < 0) volume = 0;
        let state = new HCAInternalState(hca); // throws "Not a HCA file" if mismatch
        let info = state.info;
        if (info.hasHeader["ciph"] && info.cipher != 0) {
            throw new Error("HCA is encrypted, please decrypt it first before decoding");
        }
        let wavRiff = {
            id: 0x46464952, // RIFF
            size: 0,
            wave: 0x45564157 // WAVE
        }
        let fmt = {
            id: 0x20746d66, // fmt 
            size: 0x10,
            fmtType: mode > 0 ? 1 : 3,
            fmtChannelCount: info.format.channelCount,
            fmtSamplingRate: info.format.samplingRate,
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
        smpl.samplePeriod = (1 / fmt.fmtSamplingRate * 1000000000);
        if (info.hasHeader["loop"]) {
            smpl.loop_Start = info.loopStartAtSample - info.startAtSample;
            smpl.loop_End = info.loopEndAtSample - info.startAtSample;
            smpl.SMPTEOffset = 1;
        }
        if (info.comment) {
            note.size = 4 + info.comment.length;
            if (note.size & 3) note.size += 4 - note.size & 3
        }
        let blockSizeInWav = 0x400 * fmt.fmtSamplingSize;
        data.size = info.hasHeader["loop"]
            ? ((info.loopStartAtSample - info.startAtSample) + (info.loopEndAtSample - info.loopStartAtSample) * (loop + 1)) * fmt.fmtSamplingSize
            : (info.endAtSample - info.startAtSample) * fmt.fmtSamplingSize;
        wavRiff.size = 0x1C + (info.comment ? 8 + note.size : 0) + 8 + data.size + (info.hasHeader["loop"] ? 68 : 0);
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
        ftell += 36;
        if (info.comment) {
            p.setUint32(ftell, note.id, true);
            p.setUint32(ftell + 4, note.size, true);
            let te = new TextEncoder();
            writer.set(te.encode(info.comment), ftell + 8);
            ftell += note.size;
        }
        p.setUint32(ftell, data.id, true);
        p.setUint32(ftell + 4, data.size, true);
        ftell += 8;
        let actualEndAtSample = info.hasHeader["loop"] ? info.loopEndAtSample : info.endAtSample;
        for (let l = 0; l < info.format.blockCount; ++l) {
            let lastDecodedSamples = l * 0x400;
            let currentDecodedSamples = lastDecodedSamples + 0x400;
            if (currentDecodedSamples <= info.startAtSample || lastDecodedSamples >= actualEndAtSample) {
                continue;
            }
            let startOffset = info.dataOffset + info.blockSize * l;
            let block = hca.subarray(startOffset, startOffset + info.blockSize);
            this.decodeBlock(state, block, mode);
            let wavebuff: Uint8Array;
            if (lastDecodedSamples < info.startAtSample || currentDecodedSamples > actualEndAtSample) {
                // crossing startAtSample/endAtSample, skip/drop specified bytes
                wavebuff = this.writeToPCM(state, mode, volume);
                if (lastDecodedSamples < info.startAtSample) {
                    let skippedSize = (info.startAtSample - lastDecodedSamples) * fmt.fmtSamplingSize;
                    wavebuff = wavebuff.subarray(skippedSize, blockSizeInWav);
                } else if (currentDecodedSamples > actualEndAtSample) {
                    let writeSize = (actualEndAtSample - lastDecodedSamples) * fmt.fmtSamplingSize;
                    wavebuff = wavebuff.subarray(0, writeSize);
                } else throw Error("should never go here");
                writer.set(wavebuff, ftell);
            } else {
                wavebuff = this.writeToPCM(state, mode, volume, writer, ftell);
            }
            ftell += wavebuff.byteLength;
        }
        // decoding done, then just copy looping part
        if (info.hasHeader["loop"] && loop) {
            // "tail" beyond loop end is dropped
            // copy looping audio clips
            let wavDataOffset = writer.byteLength - data.size - 68;
            let loopSizeInWav = (info.loopEndAtSample - info.loopStartAtSample) * fmt.fmtSamplingSize;
            let preLoopSizeInWav = (info.loopStartAtSample - info.startAtSample) * fmt.fmtSamplingSize;
            let loopStartOffsetInWav = wavDataOffset + preLoopSizeInWav;
            let src = new Uint8Array(writer.buffer, writer.byteOffset + loopStartOffsetInWav, loopSizeInWav);
            for (let i = 1; i <= loop; i++) {
                let dst = new Uint8Array(writer.buffer, writer.byteOffset + loopStartOffsetInWav + i * loopSizeInWav, loopSizeInWav);
                dst.set(src);
                ftell += dst.byteLength;
            }
        }
        if (info.hasHeader["loop"]) {
            // write smpl section
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
        return writer;
    }

    static decodeBlock(state: HCAInternalState, block: Uint8Array, mode = 32): void
    {
        switch (mode) {
            case 0: // float
            case 8: case 16: case 24: case 32: // integer
                break;
            default:
                mode = 32;
        }
        let info = state.info;
        if (block.byteLength < info.blockSize) throw new Error("block.byteLength < info.blockSize");
        // verify checksum
        HCACrc16.verify(block, info.blockSize - 2);
        // decode
        let channel = state.channel;
        let data = new HCABitReader(info.blockSize, block);
        let magic = data.read(16);
        if (magic == 0xFFFF) {
            let a = (data.read(9) << 8) - data.read(7);
            for (let i = 0; i < info.format.channelCount; i++) HCADecoder.step1(channel[i], data, info.HfrGroupCount/*info.compDec.Reserved1*/, a);
            for (let i = 0; i<8; i++) {
                for (let j = 0; j < info.format.channelCount; j++) HCADecoder.step2(channel[j], data);
                for (let j = 0; j < info.format.channelCount; j++) HCADecoder.step3(channel[j], info.HfrGroupCount/*info.compDec.Reserved1*/, info.compDec.BandsPerHfrGroup, info.compDec.StereoBandCount + info.compDec.BaseBandCount, info.compDec.TotalBandCount);
                for (let j = 0; j < info.format.channelCount - 1; j++) HCADecoder.step4(channel[j], i, info.compDec.TotalBandCount - info.compDec.BaseBandCount, info.compDec.BaseBandCount, info.compDec.StereoBandCount, channel[j + 1]);
                for (let j = 0; j < info.format.channelCount; j++) HCADecoder.step5(channel[j], i);
            }
        }
    }
    static writeToPCM(state: HCAInternalState, mode = 32, volume = 1.0,
        writer: Uint8Array | undefined = undefined, ftell: number | undefined = undefined): Uint8Array
    {
        switch (mode) {
            case 0: // float
            case 8: case 16: case 24: case 32: // integer
                break;
            default:
                mode = 32;
        }
        if (volume > 1) volume = 1;
        else if (volume < 0) volume = 0;
        // create new writer if not specified
        let info = state.info;
        let channel = state.channel;
        if (writer == null) {
            writer = new Uint8Array(0x400 * info.format.channelCount * mode / 8);
            if (ftell == null) {
                ftell = 0;
            }
        } else {
            if (ftell == null) {
                throw new Error("ftell == null");
            }
        }
        // write decoded data into writer
        let p = new DataView(writer.buffer);
        let ftellBegin = ftell;
        for (let i = 0; i<8; i++) {
            for (let j = 0; j<0x80; j++) {
                for (let k = 0; k < info.format.channelCount; k++) {
                    let f = channel[k].wave[i][j] * volume;
                    if (f > 1) f = 1;
                    else if (f < -1) f = -1;
                    switch (mode) {
                        case 8:
                            // must be unsigned
                            p.setUint8(ftell, f * 0x7F + 0x80);
                            ftell += 1;
                            break;
                        case 16:
                            // for above 8-bit integer, little-endian signed integer is used
                            // (setUint16/setInt16 actually doesn't seem to make any difference here)
                            p.setInt16(ftell, f * 0x7FFF, true);
                            ftell += 2;
                            break;
                        case 24:
                            // there's no setInt24, write 3 bytes with setUint8 respectively
                            f *= 0x7FFFFF;
                            p.setUint8(ftell    , f       & 0xFF);
                            p.setUint8(ftell + 1, f >>  8 & 0xFF);
                            p.setUint8(ftell + 2, f >> 16 & 0xFF);
                            ftell += 3;
                            break;
                        case 32:
                            p.setInt32(ftell, f * 0x7FFFFFFF, true);
                            ftell += 4;
                            break;
                        case 0:
                            // float
                            p.setFloat32(ftell, f, true);
                            ftell += 4;
                            break;
                        default:
                            throw new Error("unknown mode");
                    }
                }
            }
        }
        return new Uint8Array(writer.buffer, ftellBegin, ftell - ftellBegin);
    }

    static fixChecksum(hca: Uint8Array): Uint8Array {
        HCAInfo.fixHeaderChecksum(hca);
        let info = new HCAInfo(hca);
        for (let i = 0; i < info.format.blockCount; i++) {
            let ftell = info.dataOffset + i * info.blockSize;
            let block = hca.subarray(ftell, ftell + info.blockSize);
            HCACrc16.fix(block, info.blockSize - 2);
        }
        return hca;
    }
}

class HCAChannelContext {
    block = new Float64Array(0x80);
    base = new Float64Array(0x80);
    value = new Uint8Array(0x80);
    scale = new Uint8Array(0x80);
    value2 = new Uint8Array(8);
    type = 0;
    value3 = new Uint8Array(8);
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
    private cloneTypedArray(obj: any) {
        if (obj instanceof Int8Array) return obj.slice(0);
        if (obj instanceof Uint8Array) return obj.slice(0);
        if (obj instanceof Uint8ClampedArray) return obj.slice(0);
        if (obj instanceof Int16Array) return obj.slice(0);
        if (obj instanceof Uint16Array) return obj.slice(0);
        if (obj instanceof Int32Array) return obj.slice(0);
        if (obj instanceof Uint32Array) return obj.slice(0);
        if (obj instanceof Float32Array) return obj.slice(0);
        if (obj instanceof Float64Array) return obj.slice(0);
        return obj;
    }
    clone() : HCAChannelContext {
        // ref: https://stackoverflow.com/questions/28150967/typescript-cloning-object
        let ret = new HCAChannelContext() as any;
        for (let key in this) {
            switch (typeof this[key]) {
                case "number":
                    ret[key] = this[key];
                    break;
                case "object":
                    if (this[key] instanceof Array) {
                        for (let key_ in this[key]) {
                            ret[key][key_] = this.cloneTypedArray(this[key][key_]);
                        }
                    } else {
                        ret[key] = this.cloneTypedArray(this[key]);
                    }
                    break;
            }
        }
        return ret;
    }
}
class HCADecoder {
    static readonly consts = {
        // step1
        scalelist: new Uint8Array([
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
        ]),
        // step2
        list1: new Uint8Array([0,2,3,3,4,4,4,4,5,6,7,8,9,10,11,12]),
        list2: new Uint8Array([
            0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
            1,1,2,2,0,0,0,0,0,0,0,0,0,0,0,0,
            2,2,2,2,2,2,3,3,0,0,0,0,0,0,0,0,
            2,2,3,3,3,3,3,3,0,0,0,0,0,0,0,0,
            3,3,3,3,3,3,3,3,3,3,3,3,3,3,4,4,
            3,3,3,3,3,3,3,3,3,3,4,4,4,4,4,4,
            3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,
            3,3,4,4,4,4,4,4,4,4,4,4,4,4,4,4,
        ]),
        list3: new Int8Array([
            +0,+0,+0,+0,+0,+0,+0,+0,+0,+0,+0,+0,+0,+0,+0,+0,
            +0,+0,+1,-1,+0,+0,+0,+0,+0,+0,+0,+0,+0,+0,+0,+0,
            +0,+0,+1,+1,-1,-1,+2,-2,+0,+0,+0,+0,+0,+0,+0,+0,
            +0,+0,+1,-1,+2,-2,+3,-3,+0,+0,+0,+0,+0,+0,+0,+0,
            +0,+0,+1,+1,-1,-1,+2,+2,-2,-2,+3,+3,-3,-3,+4,-4,
            +0,+0,+1,+1,-1,-1,+2,+2,-2,-2,+3,-3,+4,-4,+5,-5,
            +0,+0,+1,+1,-1,-1,+2,-2,+3,-3,+4,-4,+5,-5,+6,-6,
            +0,+0,+1,-1,+2,-2,+3,-3,+4,-4,+5,-5,+6,-6,+7,-7,
        ]),
        // step3
        listInt: new Uint32Array([
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
        ]),
        // step4
        listFloat: new Float64Array([
            2,      13 / 7.0, 12 / 7.0, 11 / 7.0, 10 / 7.0, 9 / 7.0, 8 / 7.0, 1,
            6 / 7.0, 5 / 7.0,  4 / 7.0,  3 / 7.0,  2 / 7.0, 1 / 7.0, 0,       0
        ]),
        // step5
        list1Int: [
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
        ],
        list2Int: [
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
        ],
        list3Int: new Uint32Array([
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
        ]),
    }
    static step1(channel: HCAChannelContext, data: HCABitReader, a: number, b: number, ath = new Uint8Array(0x80)) {
        const scalelist = this.consts.scalelist;
        let v = data.read(3);
        if (v >= 6) for (let i = 0; i < channel.count; i++) channel.value[i] = data.read(6);
        else if (v) {
            let v1 = data.read(6);
            let v2 = (1 << v) - 1;
            let v3 = v2 >> 1;
            let v4 = 0;
            channel.value[0] = v1;
            for (let i = 1; i < channel.count; i++) {
                v4 = data.read(v);
                if (v4 != v2) v1 += v4 - v3;
                else v1 = data.read(6);
                channel.value[i] = v1;
            }
        } else channel.value.fill(0);
        if (channel.type == 2) {
            v = data.check(4);
            channel.value2[0] = v;
            if (v < 15) for (let i = 0; i < 8; i++) channel.value2[i] = data.read(4);
        }
        else for (let i = 0; i < a; i++) channel.value3[i] = data.read(6);
        for (let i = 0; i < channel.count; i++) {
            v = channel.value[i];
            if (v) {
                v = ath[i] + ((b + i) >> 8) - ((v * 5) >> 1) + 1;
                if (v < 0) v = 15;
                else if (v >= 0x39) v = 1;
                else v = scalelist[v];
            }
            channel.scale[i] = v;
        }
        channel.scale.fill(0, channel.count);
        for (let i = 0; i < channel.count; i++) channel.base[i] = HCA.scaling_table[channel.value[i]] * HCA.range_table[channel.scale[i]];
    }
    static step2(channel: HCAChannelContext, data: HCABitReader) {
        const list1 = this.consts.list1;
        const list2 = this.consts.list2;
        const list3 = this.consts.list3;
        for (let i = 0; i < channel.count; i++) {
            let f = 0.0;
            let s = channel.scale[i];
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
            channel.block[i] = channel.base[i] * f;
        }
        channel.block.fill(0, channel.count);
    }
    static step3(channel: HCAChannelContext, a: number, b: number, c: number, d: number) {
        if (channel.type != 2 && b > 0) {
            const listFloat = new Float32Array(this.consts.listInt.buffer);
            for (let i = 0; i < a; i++) {
                for (let j = 0, k = c, l = c - 1; j < b && k < d; j++, l--) {
                    channel.block[k++] = listFloat[0x40 + channel.value3[i] - channel.value[l]] * channel.block[l];
                }
            }
            channel.block[0x80 - 1] = 0;
        }
    }
    static step4(channel: HCAChannelContext, index: number, a: number, b: number, c: number, next: HCAChannelContext) {
        if (channel.type == 1 && c) {
            const listFloat = this.consts.listFloat;
            let f1 = listFloat[next.value2[index]];
            let f2 = f1 - 2.0;
            for (let i = 0; i < a; i++) {
                next.block[b + i] = channel.block[b + i] * f2;
                channel.block[b + i] = channel.block[b + i] * f1;
            }
        }
    }
    static step5(channel: HCAChannelContext, index: number) {
        const list1Int = this.consts.list1Int;
        const list2Int = this.consts.list2Int;
        const list3Int = this.consts.list3Int;
        let s = channel.block, s0 = 0;
        let d = channel.wav1, d0 = 0;
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
        s = channel.wav1;
        d = channel.block;
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
        d = channel.wav2;
        d.set(s);
        let list3Float = new Float32Array(list3Int.buffer);
        s0 = 0;
        d = channel.wave[index];
        d0 = 0;
        let s1 = 0x40;
        let s2 = 0;
        for (let i = 0; i<0x40; i++) d[d0++] = channel.wav2[s1++] * list3Float[s0++] + channel.wav3[s2++];
        for (let i = 0; i<0x40; i++) d[d0++] = channel.wav2[--s1] * list3Float[s0++] - channel.wav3[s2++];
        s1 = 0x40 - 1;
        s2 = 0;
        for (let i = 0; i<0x40; i++) channel.wav3[s2++] = list3Float[--s0] * channel.wav2[s1--];
        for (let i = 0; i<0x40; i++) channel.wav3[s2++] = list3Float[--s0] * channel.wav2[++s1];
    }
}

class HCABitReader {
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
            v &= HCABitReader.mask[this._bit & 7];
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

class HCACrc16 {
    private static _v = new Uint16Array([
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
    static calc(data: Uint8Array, size: number): number {
        if (size > data.byteLength) throw new Error("size > data.byteLength");
        if (size < 0) throw new Error("size < 0");
        let sum = 0;
        for (let i = 0; i < size; i++)
            sum = ((sum << 8) ^ this._v[(sum >> 8) ^ data[i]]) & 0x0000ffff;
        return sum & 0x0000ffff;
    }
    static verify(data: Uint8Array, size: number, expected: number | undefined = undefined, doNotThrow = false): boolean {
        if (expected == null) {
            expected = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(size);
        }
        let actual = this.calc(data, size);
        let result = expected == actual;
        if (!result) {
            function toHex(num: number): string {
                const padding = "0000";
                let hex = padding + num.toString(padding.length * 4).toUpperCase();
                return "0x" + hex.substring(hex.length - padding.length, hex.length)
            }
            let msg = `checksum mismatch (expected=${toHex(expected)} actual=${toHex(actual)})`;
            if (doNotThrow) console.error(msg);
            else throw new Error(msg);
        }
        return result;
    }
    static fix(data: Uint8Array, size: number): Uint8Array {
        let newCrc16 = this.calc(data, size);
        new DataView(data.buffer, data.byteOffset, data.byteLength).setUint16(size, newCrc16);
        return data;
    }
}

class HCACipher {
    static readonly defKey1 = 0x01395C51;
    static readonly defKey2 = 0x00000000;
    private cipherType = 0;
    private encrypt = false;
    private key1buf = new ArrayBuffer(4);
    private key2buf = new ArrayBuffer(4);
    private dv1: DataView;
    private dv2: DataView;
    private _table = new Uint8Array(256);
    private init1(): void {
        for (let i = 1, v = 0; i < 0xFF; i++) {
            v = (v * 13 + 11) & 0xFF;
            if (v == 0 || v == 0xFF)v = (v * 13 + 11) & 0xFF;
            this._table[i] = v;
        }
        this._table[0] = 0;
        this._table[0xFF] = 0xFF;
    }
    private init56(): void {
        let key1 = this.getKey1();
        let key2 = this.getKey2();
        if (!key1) key2--;
        key1--;
        this.dv1.setUint32(0, key1, true);
        this.dv2.setUint32(0, key2, true);
        let t1 = this.getBytesOfTwoKeys();
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
    private createTable(r: Uint8Array, key: number): void {
        let mul = ((key & 1) << 3) | 5;
        let add = (key & 0xE) | 1;
        let t = 0;
        key >>= 4;
        for (let i = 0; i < 0x10; i++) {
            key = (key*mul + add) & 0xF;
            r[t++] = key;
        }
    }
    invertTable(): HCACipher {
        // actually, this method switch the mode between encrypt/decrypt
        this.encrypt = !this.encrypt;
        let _old_table = this._table.slice(0);
        let bitMap = new Uint16Array(16);
        for (let i = 0; i < 256; i++) {
            // invert key and value
            let key = _old_table[i];
            let val = i;
            // check for inconsistency
            let higher4 = key >> 4 & 0x0F;
            let lower4 = key & 0x0F;
            let flag = 0x01 << lower4;
            if (bitMap[higher4] & flag) throw new Error("_table is not bijective");
            // update table
            this._table[key] = val;
        }
        return this;
    }
    getType(): number {
        return this.cipherType;
    }
    getEncrypt(): boolean {
        return this.encrypt;
    }
    getKey1(): number {
        return this.dv1.getUint32(0, true);
    }
    getKey2(): number {
        return this.dv2.getUint32(0, true);
    }
    getBytesOfTwoKeys(): Uint8Array {
        let buf = new Uint8Array(8);
        buf.set(new Uint8Array(this.key1buf), 0);
        buf.set(new Uint8Array(this.key2buf), 4);
        return buf;
    }
    setKey1(key: number): HCACipher {
        this.dv1.setUint32(0, key, true);
        this.init56();
        this.cipherType = 0x38;
        return this;
    }
    setKey2(key: number): HCACipher {
        this.dv2.setUint32(0, key, true);
        this.init56();
        this.cipherType = 0x38;
        return this;
    }
    setKeys(key1: number, key2: number): HCACipher {
        this.dv1.setUint32(0, key1, true);
        this.dv2.setUint32(0, key2, true);
        this.init56();
        this.cipherType = 0x38;
        return this;
    }
    setToDefKeys(): HCACipher {
        return this.setKeys(HCACipher.defKey1, HCACipher.defKey2);
    }
    setToNoKey(): HCACipher {
        this.init1();
        this.cipherType = 0x01;
        return this;
    }
    mask(block: Uint8Array, offset: number, size: number): void {
        // encrypt or decrypt block data
        for (let i = 0; i < size; i++) block[offset + i] = this._table[block[offset + i]];
    }
    static isHCAHeaderMasked(hca: Uint8Array): boolean {
        // fast & dirty way to determine whether encrypted, not recommended
        if (hca[0] & 0x80 || hca[1] & 0x80 || hca[2] & 0x80) return true;
        else return false;
    }
    static parseKey(key: any): number {
        switch (typeof key) {
            case "number":
                return key;
            case "string":
                // avoid ambiguity: always treat as hex
                if (!key.match(/^0x/)) key = "0x" + key;
                return parseInt(key);
            case "object":
                // avoid endianness ambiguity: only accepting Uint8Array, then read as little endian
                if (key instanceof Uint8Array && key.byteLength == 4) {
                    return new DataView(key.buffer, key.byteOffset, key.byteLength).getUint32(0, true);
                }
            default:
                throw new Error("can only accept number/hex string/Uint8Array[4]");
        }
    }
    constructor (key1: any = undefined, key2: any = undefined) {
        this.dv1 = new DataView(this.key1buf);
        this.dv2 = new DataView(this.key2buf);
        if (key1 == null) throw new Error("no keys given. use \"defaultkey\" if you want to use the default key");
        switch (key1) {
            case "none":
            case "nokey":
            case "noKey":
            case "no key":
            case "no_Key":
                this.setToNoKey();
                break;
            case "defaultkey":
            case "defaultKey":
            case "default key":
            case "default_key":
                this.setToDefKeys();
                break;
            default:
                key1 = HCACipher.parseKey(key1);
                if (key2 == null) {
                    key2 = key1 >> 32;
                } else {
                    key2 = HCACipher.parseKey(key2);
                }
                this.setKeys(key1, key2);
        }
    }
}

class HCAInternalState {
    info: HCAInfo;
    channel: HCAChannelContext[];
    private initialize(info: HCAInfo): HCAChannelContext[] {
        let r = new Uint8Array(0x10);
        let b = Math.floor(info.format.channelCount / info.compDec.TrackCount);
        if (info.compDec.StereoBandCount && b > 1) {
            for (let i = 0; i < info.compDec.TrackCount; ++i) switch (b) {
                case 8:
                    r[i * b + 6] = 1;
                    r[i * b + 7] = 2;
                case 7:
                case 6:
                    r[i * b + 4] = 1;
                    r[i * b + 5] = 2;
                case 5:
                    if (b == 5 && info.compDec.ChannelConfig <= 2) {
                        r[i * b + 3] = 1;
                        r[i * b + 4] = 2;
                    }
                case 4:
                    if (b == 4 && info.compDec.ChannelConfig == 0) {
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
        let channel = [];
        for (let i = 0; i < info.format.channelCount; ++i) {
            let c = new HCAChannelContext();
            c.type = r[i];
            c.value3 = c.value.subarray(info.compDec.BaseBandCount + info.compDec.StereoBandCount);
            c.count = info.compDec.BaseBandCount + (r[i] != 2 ? info.compDec.StereoBandCount : 0);
            channel.push(c);
        }
        return channel;
    }
    clone(): HCAInternalState {
        let ret = new HCAInternalState(this);
        return ret;
    }
    constructor (hca: Uint8Array | HCAInternalState) {
        if (hca instanceof HCAInternalState) {
            let old = hca;
            this.info = old.info.clone();
            this.channel = [];
            old.channel.forEach(c => this.channel.push(c.clone()));
        } else {
            this.info = new HCAInfo(hca);
            this.channel = this.initialize(this.info);
        }
    }
}



// Web Workers support
if (typeof document === "undefined") {
    // running in worker
    onmessage = function (msg : MessageEvent) {
        function handleMsg(msg : MessageEvent) {
            switch (msg.data.cmd) {
                case "nop":
                    return;
                case "info":
                    return new HCAInfo(msg.data.args[0]);
                case "fixHeaderChecksum":
                    return HCAInfo.fixHeaderChecksum.apply(HCA, msg.data.args);
                case "fixChecksum":
                    return HCA.fixChecksum.apply(HCA, msg.data.args);
                case "decrypt":
                    return HCA.decrypt.apply(HCA, msg.data.args);
                case "encrypt":
                    return HCA.encrypt.apply(HCA, msg.data.args);
                case "addCipherHeader":
                    return HCAInfo.addCipherHeader.apply(HCAInfo, msg.data.args);
                case "decode":
                    return HCA.decode.apply(HCA, msg.data.args);
                default:
                    throw new Error("unknown cmd");
            }
        }
        // it's observed that Firefox refuses to postMessage an Error object:
        // "DataCloneError: The object could not be cloned."
        // (observed in Firefox 97, not clear about other versions)
        // Chrome doesn't seem to have this problem,
        // however, in order to keep compatible with Firefox,
        // we still have to avoid posting an Error object
        let reply: Record<string, any> = {taskID: msg.data.taskID};
        try {
            reply.result = handleMsg(msg);
        } catch (e) {
            console.error(e);
            reply.hasError = true;
            reply.errMsg = "error during Worker executing cmd";
            if (typeof e === "string" || e instanceof Error) reply.errMsg += "\n" + e.toString();
        }
        try {
            this.postMessage(reply);
        } catch (e) {
            console.error(e);
            reply.hasError = true;
            reply.errMsg = (reply.errMsg == null ? "" : reply.errMsg + "\n\n") + "postMessage from Worker failed";
            if (typeof e === "string" || e instanceof Error) reply.errMsg += "\n" + e.toString();
            delete reply.result;
        }
    }
}

// create & control worker
class HCAWorker {
    private selfUrl: URL;
    private cmdQueue: Array<{taskID: number, cmd: string, args: Array<any>}>;
    private resultCallback: Record<number, {onResult: Function, onErr: Function}>;
    private lastTaskID = 0;
    private hcaWorker: Worker;
    private errHandlerCallback: Function;
    private idle = true;
    private hasError = false;
    private isShutdown = false;
    private lastTick = 0;
    private execCmdQueueIfIdle(): void {
        if (this.hasError) throw new Error("there was once an error, which had shut down background HCAWorket thread");
        if (this.isShutdown) throw new Error("the Worker instance has been shut down");
        if (this.idle) {
            this.idle = false;
            if (this.cmdQueue.length > 0) this.hcaWorker.postMessage(this.cmdQueue[0]);
        }
    }
    private resultHandler(self: HCAWorker, msg: MessageEvent): void {
        let result = msg.data;
        let taskID = result.taskID;
        for (let i=0; i<self.cmdQueue.length; i++) {
            if (self.cmdQueue[i].taskID == taskID) {
                let nextTask = undefined;
                if (i + 1 < self.cmdQueue.length) {
                    nextTask = self.cmdQueue[i+1];
                }
                self.cmdQueue.splice(i, 1);
                let callback = self.resultCallback[taskID][result.hasError ? "onErr" : "onResult"];
                try {
                    callback(result[result.hasError ? "errMsg" : "result"]);
                } catch (e) {
                    let errMsg = "";
                    if (typeof e === "string" || e instanceof Error) errMsg = e.toString();
                    this.errHandler(self, errMsg); // before delete self.resultCallback[taskID];
                    return;
                }
                delete self.resultCallback[taskID];
                if (nextTask == undefined) {
                    self.idle = true;
                } else {
                    self.hcaWorker.postMessage(nextTask);
                }
                return;
            }
        }
        throw new Error("taskID not found in cmdQueue");
    }
    private errHandler(self: HCAWorker, err: any): void {
        self.hasError = true;
        try {
            self.hcaWorker.terminate();
        } catch (e) {console.error(e);}
        try {
            for (let taskID in self.resultCallback) try {
                self.resultCallback[taskID].onErr(err);
            } catch (e) {console.error(e);}
        } catch (e) {console.error(e);}
        try {
            self.errHandlerCallback(err);
        } catch (e) {console.error(e);}
    }
    sendCmdList(cmdlist: Array<{cmd: string, args: Array<any>, onResult: Function, onErr: Function}>): void {
        for (let i=0; i<cmdlist.length; i++) {
            let taskID = ++this.lastTaskID;
            this.resultCallback[taskID] = {onResult: cmdlist[i].onResult, onErr: cmdlist[i].onErr};
            this.cmdQueue.push({taskID: taskID, cmd: cmdlist[i].cmd, args: cmdlist[i].args});
        }
        this.execCmdQueueIfIdle();
    }
    sendCmd(cmd: string, args: Array<any>): Promise<any> {
        return new Promise((resolve, reject) => this.sendCmdList([{cmd: cmd, args: args, onResult: resolve, onErr: reject}]));
    }
    async shutdown(): Promise<void> {
        await this.sendCmd("nop", []);
        this.hcaWorker.terminate();
        this.isShutdown = true;
    }
    async tick(): Promise<void> {
        await this.sendCmd("nop", []);
        this.lastTick = new Date().getTime();
    }
    async tock(text = ""): Promise<number> {
        let duration = await this.sendCmd("nop", []);
        console.log(`${text} took ${new Date().getTime() - this.lastTick} ms`);
        return duration;
    }
    constructor (selfUrl: URL, errHandlerCallback: Function | undefined) {
        this.selfUrl = selfUrl;
        this.cmdQueue = [];
        this.resultCallback = {};
        this.hcaWorker = new Worker(selfUrl);
        this.errHandlerCallback = errHandlerCallback != null ? errHandlerCallback : () => {};
        this.hcaWorker.onmessage = (msg) => this.resultHandler(this, msg);
        this.hcaWorker.onerror = (msg) => this.errHandler(this, msg);
        this.hcaWorker.onmessageerror = (msg) => this.errHandler(this, msg);
    }
    // commands
    async info(hca: Uint8Array): Promise<HCAInfo> {
        return await this.sendCmd("info", [hca]);
    }
    async fixHeaderChecksum(hca: Uint8Array): Promise<Uint8Array> {
        return await this.sendCmd("fixHeaderChecksum", [hca]);
    }
    async fixChecksum(hca: Uint8Array): Promise<Uint8Array> {
        return await this.sendCmd("fixChecksum", [hca]);
    }
    async decrypt(hca: Uint8Array, key1: any = undefined, key2: any = undefined): Promise<Uint8Array> {
        return await this.sendCmd("decrypt", [hca, key1, key2]);
    }
    async encrypt(hca: Uint8Array, key1: any = undefined, key2: any = undefined): Promise<Uint8Array> {
        return await this.sendCmd("encrypt", [hca, key1, key2]);
    }
    async addHeader(hca: Uint8Array, sig: string, newData: Uint8Array): Promise<Uint8Array> {
        return await this.sendCmd("addHeader", [hca, sig, newData]);
    }
    async addCipherHeader(hca: Uint8Array, cipherType: number | undefined = undefined): Promise<Uint8Array> {
        return await this.sendCmd("addCipherHeader", [hca, cipherType]);
    }
    async decode(hca: Uint8Array, mode = 32, loop = 0, volume = 1.0): Promise<Uint8Array> {
        return await this.sendCmd("decode", [hca, mode, loop, volume]);
    }
}