var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var _a, _b;
export class HCAInfo {
    static getSign(raw, offset = 0, changeMask, encrypt) {
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
            if (changeMask)
                raw.setUint32(offset, encrypt ? magic | mask : magic, true);
        }
        let hex = [magic & 0xff, magic >> 8 & 0xff, magic >> 16 & 0xff, magic >> 24 & 0xff];
        hex = hex.slice(0, strLen);
        return String.fromCharCode.apply(String, hex);
    }
    clone() {
        return new HCAInfo(this.rawHeader);
    }
    parseHeader(hca, changeMask, encrypt, modList) {
        let p = new DataView(hca.buffer, hca.byteOffset, 8);
        let head = HCAInfo.getSign(p, 0, false, encrypt); // do not overwrite for now, until checksum verified
        if (head !== "HCA") {
            throw new Error("Not a HCA file");
        }
        const version = {
            main: p.getUint8(4),
            sub: p.getUint8(5)
        };
        this.version = version.main + '.' + version.sub;
        this.dataOffset = p.getUint16(6);
        // verify checksum
        HCACrc16.verify(hca, this.dataOffset - 2);
        let hasModDone = false;
        // checksum verified, now we can overwrite it
        if (changeMask)
            HCAInfo.getSign(p, 0, changeMask, encrypt);
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
                    this.kbps = this.format.samplingRate * this.blockSize / 128000.0;
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
                    this.kbps = this.format.samplingRate * this.blockSize / 128000.0;
                    this.compDec.MinResolution = p.getUint8(ftell + 6);
                    this.compDec.MaxResolution = p.getUint8(ftell + 7);
                    this.compDec.TotalBandCount = p.getUint8(ftell + 8);
                    +1;
                    this.compDec.BaseBandCount = p.getUint8(ftell + 9);
                    +1;
                    let a = p.getUint8(ftell + 10);
                    this.compDec.TrackCount = HCAUtilFunc.GetHighNibble(a);
                    this.compDec.ChannelConfig = HCAUtilFunc.GetLowNibble(a);
                    this.dec.DecStereoType = p.getUint8(ftell + 11);
                    if (this.dec.DecStereoType == 0) {
                        this.compDec.BaseBandCount = this.compDec.TotalBandCount;
                    }
                    else {
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
                if (newData.byteLength > sectionDataLen)
                    throw new Error();
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
        this.fullSampleCount = this.format.blockCount * HCAFrame.SamplesPerFrame;
        this.startAtSample = this.format.droppedHeader;
        this.fullEndAtSample = this.fullSampleCount - this.format.droppedFooter;
        if (this.hasHeader["loop"]) {
            this.loopStartAtSample = this.loop.start * HCAFrame.SamplesPerFrame + this.loop.droppedHeader;
            this.loopEndAtSample = (this.loop.end + 1) * HCAFrame.SamplesPerFrame - this.loop.droppedFooter;
            this.loopSampleCount = this.loopEndAtSample - this.loopStartAtSample;
            this.loopStartTime = (this.loopStartAtSample - this.startAtSample) / this.format.samplingRate;
            this.loopDuration = this.loopSampleCount / this.format.samplingRate;
            this.loopEndTime = this.loopStartTime + this.loopDuration;
        }
        this.endAtSample = this.hasHeader["loop"] ? this.loopEndAtSample : this.fullEndAtSample;
        this.sampleCount = this.endAtSample - this.startAtSample;
        this.duration = this.sampleCount / this.format.samplingRate;
        // calculate file/data size
        this.dataSize = this.blockSize * this.format.blockCount;
        this.fullSize = this.dataOffset + this.dataSize;
        if (changeMask || hasModDone) {
            // fix checksum if requested
            HCACrc16.fix(hca, this.dataOffset - 2);
        }
        let rawHeader = hca.slice(0, this.dataOffset);
        // check validity of parsed values
        this.checkValidity();
        return rawHeader;
    }
    checkValidity() {
        const results = [
            this.blockSize > 0,
            0 < this.format.blockCount,
            0 <= this.startAtSample,
            this.startAtSample < this.fullEndAtSample,
            this.fullEndAtSample <= this.fullSampleCount,
            this.duration > 0,
        ];
        results.find((result, index) => {
            if (!result) {
                throw new Error(`did not pass normal check on rule ${index}`);
            }
        });
        if (this.hasHeader["loop"]) {
            const loopChecks = [
                this.startAtSample <= this.loopStartAtSample,
                this.loopStartAtSample < this.loopEndAtSample,
                this.loopEndAtSample <= this.fullEndAtSample,
                0 <= this.loopStartTime,
                this.loopStartTime < this.loopEndTime,
                this.loopEndTime <= this.duration + 1.0 / this.format.samplingRate,
            ];
            loopChecks.find((result, index) => {
                if (!result) {
                    throw new Error(`did not pass loop check on rule ${index}`);
                }
            });
        }
    }
    getRawHeader() {
        return this.rawHeader.slice(0);
    }
    isHeaderChanged(hca) {
        if (hca.length >= this.rawHeader.length) {
            for (let i = 0; i < this.rawHeader.length; i++) {
                if (hca[i] != this.rawHeader[i]) {
                    return true;
                }
            }
        }
        else
            return true;
        return false;
    }
    modify(hca, sig, newData) {
        // reparse header if needed
        if (this.isHeaderChanged(hca)) {
            this.parseHeader(hca, false, false, {});
        }
        // prepare to modify data in-place
        let modList = {};
        modList[sig] = newData;
        let encrypt = this.cipher != 0;
        if (sig === "ciph") {
            encrypt = new DataView(newData.buffer, newData.byteOffset, newData.byteLength).getUint16(0) != 0;
        }
        // do actual modification & check validity
        this.rawHeader = this.parseHeader(hca, true, encrypt, modList);
    }
    static addHeader(hca, sig, newData) {
        // sig must consist of 1-4 ASCII characters
        if (sig.length < 1 || sig.length > 4)
            throw new Error();
        let newSig = new Uint8Array(4);
        for (let i = 0; i < 4; i++) {
            let c = sig.charCodeAt(i);
            if (c >= 0x80)
                throw new Error();
            newSig[i] = c;
        }
        // parse header & check validty
        let info = new HCAInfo(hca);
        // check whether specified header section already exists
        if (info.hasHeader[sig])
            throw new Error(`header section ${sig} already exists`);
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
    static addCipherHeader(hca, cipherType) {
        let newData = new Uint8Array(2);
        if (cipherType != null)
            new DataView(newData.buffer).setUint16(0, cipherType);
        return this.addHeader(hca, "ciph", newData);
    }
    static fixHeaderChecksum(hca) {
        let p = new DataView(hca.buffer, hca.byteOffset, 8);
        let head = this.getSign(p, 0, false, false);
        if (head !== "HCA") {
            throw new Error("Not a HCA file");
        }
        let dataOffset = p.getUint16(6);
        HCACrc16.fix(hca, dataOffset - 2);
        return hca;
    }
    calcInWavSize(mode = 32) {
        switch (mode) {
            case 0: // float
            case 8:
            case 16:
            case 24:
            case 32: // integer
                break;
            default:
                mode = 32;
        }
        let bitsPerSample = mode == 0 ? 32 : mode;
        let sampleSizeInWav = this.format.channelCount * bitsPerSample / 8;
        return this.inWavSize = {
            bitsPerSample: bitsPerSample,
            sample: sampleSizeInWav,
            block: HCAFrame.SamplesPerFrame * sampleSizeInWav,
            dropped: {
                header: this.format.droppedHeader * sampleSizeInWav,
                footer: this.format.droppedFooter * sampleSizeInWav,
            },
            loop: this.hasHeader["loop"] ? {
                loopPart: (this.loopEndAtSample - this.loopStartAtSample) * sampleSizeInWav,
                dropped: {
                    header: this.loop.droppedHeader * sampleSizeInWav,
                    footer: this.loop.droppedFooter * sampleSizeInWav,
                }
            } : undefined,
        };
    }
    constructor(hca, changeMask = false, encrypt = false) {
        this.version = "";
        this.dataOffset = 0;
        this.format = {
            channelCount: 0,
            samplingRate: 0,
            blockCount: 0,
            droppedHeader: 0,
            droppedFooter: 0
        };
        this.blockSize = 0;
        this.hasHeader = {};
        this.headerOffset = {}; // [start (inclusive), end (exclusive)]
        this.kbps = 0;
        this.compDec = {
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
        this.dec = {
            DecStereoType: 0,
        };
        this.loop = {
            start: 0,
            end: 0,
            // count: 0, // Nyagamon's interpretation
            // r01: 0,
            droppedHeader: 0,
            droppedFooter: 0,
        };
        this.vbr = {
            MaxBlockSize: 0,
            NoiseLevel: 0,
        };
        this.UseAthCurve = false;
        this.cipher = 0;
        this.rva = 0.0;
        this.comment = "";
        // computed sample count/offsets
        this.HfrGroupCount = 0;
        this.fullSampleCount = 0;
        this.startAtSample = 0;
        this.fullEndAtSample = 0;
        this.loopStartAtSample = 0;
        this.loopEndAtSample = 0;
        this.loopSampleCount = 0;
        this.loopStartTime = 0; // in seconds
        this.loopEndTime = 0; // in seconds
        this.loopDuration = 0; // in seconds
        this.endAtSample = 0;
        this.sampleCount = 0;
        this.duration = 0; // in seconds
        // full file size / data part (excluding header, just blocks/frames) size
        this.fullSize = 0;
        this.dataSize = 0;
        // if changeMask == true, (un)mask the header sigs in-place
        this.rawHeader = this.parseHeader(hca, changeMask, encrypt, {});
    }
}
class HCAUtilFunc {
    static DivideByRoundUp(value, divisor) {
        return Math.ceil(value / divisor);
    }
    static GetHighNibble(value) {
        if (value > 0xff)
            throw new Error();
        if (value < -0x80)
            throw new Error();
        return (value >>> 4) & 0xF;
    }
    static GetLowNibble(value) {
        if (value > 0xff)
            throw new Error();
        if (value < -0x80)
            throw new Error();
        return value & 0xF;
    }
    static GetHighNibbleSigned(value) {
        if (value > 0xff)
            throw new Error();
        if (value < -0x80)
            throw new Error();
        return this.SignedNibbles[(value >>> 4) & 0xF];
    }
    static GetLowNibbleSigned(value) {
        if (value > 0xff)
            throw new Error();
        if (value < -0x80)
            throw new Error();
        return this.SignedNibbles[value & 0xF];
    }
    static CombineNibbles(high, low) {
        return ((high << 4) | (low & 0xF)) & 0xFF;
    }
    static GetNextMultiple(value, multiple) {
        if (multiple <= 0)
            return value;
        if (value % multiple == 0)
            return value;
        return value + multiple - value % multiple;
    }
    static SignedBitReverse32(value) {
        if (value > 0xffffffff)
            throw new Error();
        if (value < -0x80000000)
            throw new Error();
        value = ((value & 0xaaaaaaaa) >>> 1) | ((value & 0x55555555) << 1);
        value = ((value & 0xcccccccc) >>> 2) | ((value & 0x33333333) << 2);
        value = ((value & 0xf0f0f0f0) >>> 4) | ((value & 0x0f0f0f0f) << 4);
        value = ((value & 0xff00ff00) >>> 8) | ((value & 0x00ff00ff) << 8);
        return ((value & 0xffff0000) >>> 16) | ((value & 0x0000ffff) << 16);
    }
    static UnsignedBitReverse32(value) {
        return this.SignedBitReverse32(value) >>> 0;
    }
    static UnsignedBitReverse32Trunc(value, bitCount) {
        return this.UnsignedBitReverse32(value) >>> (32 - bitCount);
    }
    static SignedBitReverse32Trunc(value, bitCount) {
        return this.UnsignedBitReverse32Trunc(value >>> 0, bitCount);
    }
    static BitReverse8(value) {
        if (value > 0xff)
            throw new Error();
        if (value < -0x80)
            throw new Error();
        value >>>= 0;
        value = ((value & 0xaa) >>> 1) | ((value & 0x55) << 1);
        value = ((value & 0xcc) >>> 2) | ((value & 0x33) << 2);
        return (((value & 0xf0) >>> 4) | ((value & 0x0f) << 4)) >>> 0;
    }
    static Clamp(value, min, max) {
        if (value < min)
            return min;
        if (value > max)
            return max;
        return value;
    }
    static DebugAssert(condition) {
        if (!condition)
            throw new Error("DebugAssert failed");
    }
}
HCAUtilFunc.SignedNibbles = [0, 1, 2, 3, 4, 5, 6, 7, -8, -7, -6, -5, -4, -3, -2, -1];
export class HCA {
    constructor() {
    }
    static decrypt(hca, key1, key2) {
        return this.decryptOrEncrypt(hca, false, key1, key2);
    }
    static encrypt(hca, key1, key2) {
        return this.decryptOrEncrypt(hca, true, key1, key2);
    }
    static decryptOrEncrypt(hca, encrypt, key1, key2) {
        // in-place decryption/encryption
        // parse header
        let info = new HCAInfo(hca); // throws "Not a HCA file" if mismatch
        if (!encrypt && !info.hasHeader["ciph"]) {
            return hca; // not encrypted
        }
        else if (encrypt && !info.hasHeader["ciph"]) {
            throw new Error("Input hca lacks \"ciph\" header section. Please call HCAInfo.addCipherHeader(hca) first.");
        }
        let cipher;
        switch (info.cipher) {
            case 0:
                // not encrypted
                if (encrypt)
                    cipher = new HCACipher(key1, key2).invertTable();
                else
                    return hca;
                break;
            case 1:
                // encrypted with "no key"
                if (encrypt)
                    throw new Error("already encrypted with \"no key\", please decrypt first");
                else
                    cipher = new HCACipher("none"); // ignore given keys
                break;
            case 0x38:
                // encrypted with keys - will yield incorrect waveform if incorrect keys are given!
                if (encrypt)
                    throw new Error("already encrypted with specific keys, please decrypt with correct keys first");
                else
                    cipher = new HCACipher(key1, key2);
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
    static decode(hca, mode = 32, loop = 0, volume = 1.0) {
        switch (mode) {
            case 0: // float
            case 8:
            case 16:
            case 24:
            case 32: // integer
                break;
            default:
                mode = 32;
        }
        if (volume > 1)
            volume = 1;
        else if (volume < 0)
            volume = 0;
        let info = new HCAInfo(hca); // throws "Not a HCA file" if mismatch
        let frame = new HCAFrame(info);
        if (info.hasHeader["ciph"] && info.cipher != 0) {
            throw new Error("HCA is encrypted, please decrypt it first before decoding");
        }
        // prepare output WAV file
        const outputWav = new HCAWav(info, mode, loop);
        const fileBuf = outputWav.fileBuf;
        const dataPart = outputWav.dataPart;
        // calculate in-WAV size
        let inWavSize = info.calcInWavSize(mode);
        // decode blocks (frames)
        let failedBlocks = [], lastError = undefined;
        for (let i = 0, offset = 0; i < info.format.blockCount; i++) {
            let lastDecodedSamples = i * HCAFrame.SamplesPerFrame;
            let currentDecodedSamples = lastDecodedSamples + HCAFrame.SamplesPerFrame;
            if (currentDecodedSamples <= info.startAtSample || lastDecodedSamples >= info.endAtSample) {
                continue;
            }
            let startOffset = info.dataOffset + info.blockSize * i;
            let block = hca.subarray(startOffset, startOffset + info.blockSize);
            try {
                this.decodeBlock(frame, block);
            }
            catch (e) {
                failedBlocks.push(i);
                lastError = e;
                frame = new HCAFrame(info);
            }
            let wavebuff;
            if (lastDecodedSamples < info.startAtSample || currentDecodedSamples > info.endAtSample) {
                // crossing startAtSample/endAtSample, skip/drop specified bytes
                wavebuff = this.writeToPCM(frame, mode, volume);
                if (lastDecodedSamples < info.startAtSample) {
                    let skippedSize = (info.startAtSample - lastDecodedSamples) * inWavSize.sample;
                    wavebuff = wavebuff.subarray(skippedSize, inWavSize.block);
                }
                else if (currentDecodedSamples > info.endAtSample) {
                    let writeSize = (info.endAtSample - lastDecodedSamples) * inWavSize.sample;
                    wavebuff = wavebuff.subarray(0, writeSize);
                }
                else
                    throw Error("should never go here");
                dataPart.set(wavebuff, offset);
            }
            else {
                wavebuff = this.writeToPCM(frame, mode, volume, dataPart, offset);
            }
            offset += wavebuff.byteLength;
        }
        if (failedBlocks.length > 0) {
            console.error(`error decoding following blocks, filled zero`, failedBlocks, lastError);
        }
        // decoding done, then just copy looping part
        if (info.hasHeader["loop"] && loop) {
            // "tail" beyond loop end is dropped
            // copy looping audio clips
            if (inWavSize.loop == null)
                throw new Error();
            let preLoopSizeInWav = inWavSize.sample * (info.loopStartAtSample - info.startAtSample);
            let src = dataPart.subarray(preLoopSizeInWav, preLoopSizeInWav + inWavSize.loop.loopPart);
            for (let i = 0, start = preLoopSizeInWav + inWavSize.loop.loopPart; i < loop; i++) {
                let dst = dataPart.subarray(start, start + inWavSize.loop.loopPart);
                dst.set(src);
                start += inWavSize.loop.loopPart;
            }
        }
        return fileBuf;
    }
    static decodeBlock(frame, block) {
        let info = frame.Hca;
        if (block.byteLength != info.blockSize)
            throw new Error();
        // verify checksum
        HCACrc16.verify(block, info.blockSize - 2);
        // decode
        HCADecoder.DecodeFrame(block, frame);
    }
    static writeToPCM(frame, mode = 32, volume = 1.0, writer, ftell) {
        switch (mode) {
            case 0: // float
            case 8:
            case 16:
            case 24:
            case 32: // integer
                break;
            default:
                mode = 32;
        }
        if (volume > 1)
            volume = 1;
        else if (volume < 0)
            volume = 0;
        // create new writer if not specified
        let info = frame.Hca;
        if (writer == null) {
            writer = new Uint8Array(HCAFrame.SamplesPerFrame * info.format.channelCount * (mode == 0 ? 32 : mode) / 8);
            if (ftell == null) {
                ftell = 0;
            }
        }
        else {
            if (ftell == null)
                throw new Error();
        }
        // write decoded data into writer
        let p = new DataView(writer.buffer, writer.byteOffset, writer.byteLength);
        let ftellBegin = ftell;
        for (let sf = 0; sf < HCAFrame.SubframesPerFrame; sf++) {
            for (let s = 0; s < HCAFrame.SamplesPerSubFrame; s++) {
                for (let c = 0; c < frame.Channels.length; c++) {
                    let f = frame.Channels[c].PcmFloat[sf][s] * volume;
                    if (f > 1)
                        f = 1;
                    else if (f < -1)
                        f = -1;
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
                            p.setUint8(ftell, f & 0xFF);
                            p.setUint8(ftell + 1, f >> 8 & 0xFF);
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
        return writer.subarray(ftellBegin, ftell);
    }
    static fixChecksum(hca) {
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
class HCAWav {
    constructor(info, mode = 32, loop = 0) {
        switch (mode) {
            case 0: // float
            case 8:
            case 16:
            case 24:
            case 32: // integer
                break;
            default:
                mode = 32;
        }
        if (isNaN(loop))
            throw new Error("loop is not number");
        loop = Math.floor(loop);
        if (loop < 0)
            throw new Error();
        let inWavSize = info.calcInWavSize(mode);
        let dataSize = inWavSize.sample * info.sampleCount;
        if (loop > 0) {
            if (inWavSize.loop == null)
                throw new Error();
            dataSize += inWavSize.loop.loopPart * loop;
        }
        // prepare metadata chunks and data chunk header
        this.fmt = new HCAWavFmtChunk(info, mode);
        if (info.hasHeader["comm"])
            this.note = new HCAWavCommentChunk(info);
        if (info.hasHeader["loop"])
            this.smpl = new HCAWaveSmplChunk(info);
        this.waveRiff = new HCAWavWaveRiffHeader(8 + this.fmt.size
            + (this.note == null ? 0 : 8 + this.note.size)
            + 8 + dataSize
            + (this.smpl == null ? 0 : 8 + this.smpl.size));
        // get bytes of prepared chunks
        let waveRiffHeader = this.waveRiff.get();
        let fmtChunk = this.fmt.get();
        let noteChunk = this.note != null ? this.note.get() : new Uint8Array(0);
        let dataChunkHeader = new Uint8Array(8);
        dataChunkHeader.set(new TextEncoder().encode("data"));
        new DataView(dataChunkHeader.buffer).setUint32(4, dataSize, true);
        let smplChunk = this.smpl != null ? this.smpl.get() : new Uint8Array(0);
        // create whole-file buffer
        this.fileBuf = new Uint8Array(8 + this.waveRiff.size);
        // copy prepared metadata chunks and data chunk header to whole-file buffer
        let writtenLength = 0;
        [waveRiffHeader, fmtChunk, noteChunk, dataChunkHeader].forEach((chunk) => {
            this.fileBuf.set(chunk, writtenLength);
            writtenLength += chunk.byteLength;
        });
        // skip dataPart since it's empty
        this.dataPart = this.fileBuf.subarray(writtenLength, writtenLength + dataSize);
        writtenLength += dataSize;
        // copy the last prepared chunk to whole-file buffer
        this.fileBuf.set(smplChunk, writtenLength);
        writtenLength += smplChunk.byteLength;
        if (writtenLength != this.fileBuf.byteLength)
            throw new Error();
    }
}
class HCAWavWaveRiffHeader {
    constructor(size) {
        if (isNaN(size))
            throw new Error("size must be number");
        size = Math.floor(size);
        if (size <= 0)
            throw new Error();
        this.size = 4 + size; // "WAVE" + remaining part
    }
    get() {
        let buf = new ArrayBuffer(12);
        let ret = new Uint8Array(buf);
        let p = new DataView(buf);
        let te = new TextEncoder();
        ret.set(te.encode("RIFF"), 0);
        p.setUint32(4, this.size, true);
        ret.set(te.encode("WAVE"), 8);
        return ret;
    }
}
class HCAWavFmtChunk {
    constructor(info, mode = 32) {
        this.size = 16;
        switch (mode) {
            case 0: // float
            case 8:
            case 16:
            case 24:
            case 32: // integer
                break;
            default:
                mode = 32;
        }
        let inWavSize = info.calcInWavSize(mode);
        this.formatTag = mode > 0 ? 1 : 3;
        this.channelCount = info.format.channelCount;
        this.samplesPerSec = info.format.samplingRate;
        this.bytesPerSec = inWavSize.sample * info.format.samplingRate;
        this.blockAlign = inWavSize.sample;
        this.bitsPerSample = inWavSize.bitsPerSample;
    }
    get() {
        let buf = new ArrayBuffer(8 + this.size);
        let ret = new Uint8Array(buf);
        let p = new DataView(buf);
        let te = new TextEncoder();
        ret.set(te.encode("fmt "), 0);
        p.setUint32(4, this.size, true);
        p.setUint16(8, this.formatTag, true);
        p.setUint16(10, this.channelCount, true);
        p.setUint32(12, this.samplesPerSec, true);
        p.setUint32(16, this.bytesPerSec, true);
        p.setUint16(20, this.blockAlign, true);
        p.setUint16(22, this.bitsPerSample, true);
        return ret;
    }
}
class HCAWavCommentChunk {
    constructor(info) {
        this.commentBuf = new TextEncoder().encode(info.comment);
        let size = this.commentBuf.byteLength;
        size += 4;
        if (size % 4)
            size += 4 - size % 4;
        this.size = size;
    }
    get() {
        let buf = new ArrayBuffer(8 + this.size);
        let ret = new Uint8Array(buf);
        let p = new DataView(buf);
        let te = new TextEncoder();
        ret.set(te.encode("note"), 0);
        p.setUint32(4, this.size, true);
        ret.set(this.commentBuf, 8);
        return ret;
    }
}
class HCAWaveSmplChunk {
    constructor(info) {
        this.size = 60;
        this.manufacturer = 0;
        this.product = 0;
        this.MIDIUnityNote = 0x3c;
        this.MIDIPitchFraction = 0;
        this.SMPTEFormat = 0;
        this.sampleLoops = 1;
        this.samplerData = 0x18;
        this.loop_Identifier = 0;
        this.loop_Type = 0;
        this.loop_Fraction = 0;
        this.loop_PlayCount = 0;
        if (!info.hasHeader["loop"])
            throw new Error("missing \"loop\" header");
        this.samplePeriod = (1 / info.format.samplingRate * 1000000000);
        this.loop_Start = info.loopStartAtSample - info.startAtSample;
        this.loop_End = info.loopEndAtSample - info.startAtSample;
        this.SMPTEOffset = 1;
    }
    get() {
        let buf = new ArrayBuffer(8 + this.size);
        let ret = new Uint8Array(buf);
        let p = new DataView(buf);
        let te = new TextEncoder();
        ret.set(te.encode("smpl"), 0);
        p.setUint32(4, this.size, true);
        p.setUint32(8, this.manufacturer, true);
        p.setUint32(12, this.product, true);
        p.setUint32(16, this.samplePeriod, true);
        p.setUint32(20, this.MIDIUnityNote, true);
        p.setUint32(24, this.MIDIPitchFraction, true);
        p.setUint32(28, this.SMPTEFormat, true);
        p.setUint32(32, this.SMPTEOffset, true);
        p.setUint32(36, this.sampleLoops, true);
        p.setUint32(40, this.samplerData, true);
        p.setUint32(44, this.loop_Identifier, true);
        p.setUint32(48, this.loop_Type, true);
        p.setUint32(52, this.loop_Start, true);
        p.setUint32(56, this.loop_End, true);
        p.setUint32(60, this.loop_Fraction, true);
        p.setUint32(64, this.loop_PlayCount, true);
        return ret;
    }
}
class HCABitReader {
    get Remaining() {
        return this.LengthBits - this.Position;
    }
    constructor(buffer) {
        this.Buffer = buffer;
        this.dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        this.LengthBits = buffer.length * 8;
        this.Position = 0;
    }
    ReadInt(bitCount) {
        let value = this.PeekInt(bitCount);
        this.Position += bitCount;
        return value;
    }
    ReadBool() {
        return this.ReadInt(1) == 1;
    }
    ReadOffsetBinary(bitCount, bias) {
        let offset = (1 << (bitCount - 1)) - bias;
        let value = this.PeekInt(bitCount) - offset;
        this.Position += bitCount;
        return value;
    }
    AlignPosition(multiple) {
        this.Position = HCAUtilFunc.GetNextMultiple(this.Position, multiple);
    }
    PeekInt(bitCount) {
        HCAUtilFunc.DebugAssert(bitCount >= 0 && bitCount <= 32);
        if (bitCount > this.Remaining) {
            if (this.Position >= this.LengthBits)
                return 0;
            let extraBits = bitCount - this.Remaining;
            return this.PeekIntFallback(this.Remaining) << extraBits;
        }
        let byteIndex = this.Position / 8;
        let bitIndex = this.Position % 8;
        if (bitCount <= 9 && this.Remaining >= 16) {
            let value = this.dv.getUint16(byteIndex);
            value &= 0xFFFF >> bitIndex;
            value >>= 16 - bitCount - bitIndex;
            return value;
        }
        if (bitCount <= 17 && this.Remaining >= 24) {
            let value = this.dv.getUint16(byteIndex) << 8 | this.dv.getUint8(byteIndex + 2);
            value &= 0xFFFFFF >> bitIndex;
            value >>= 24 - bitCount - bitIndex;
            return value;
        }
        if (bitCount <= 25 && this.Remaining >= 32) {
            let value = this.dv.getUint32(byteIndex);
            value &= 0xFFFFFFFF >>> bitIndex;
            value >>= 32 - bitCount - bitIndex;
            return value;
        }
        return this.PeekIntFallback(bitCount);
    }
    PeekIntFallback(bitCount) {
        let value = 0;
        let byteIndex = this.Position / 8;
        let bitIndex = this.Position % 8;
        while (bitCount > 0) {
            if (bitIndex >= 8) {
                bitIndex = 0;
                byteIndex++;
            }
            let bitsToRead = Math.min(bitCount, 8 - bitIndex);
            let mask = 0xFF >> bitIndex;
            let currentByte = (mask & this.dv.getUint8(byteIndex)) >> (8 - bitIndex - bitsToRead);
            value = (value << bitsToRead) | currentByte;
            bitIndex += bitsToRead;
            bitCount -= bitsToRead;
        }
        return value;
    }
}
var HCAOffsetBias;
(function (HCAOffsetBias) {
    /// <summary>
    /// Specifies the bias of an offset binary value. A positive bias can represent one more
    /// positive value than negative value, and a negative bias can represent one more
    /// negative value than positive value.
    /// </summary>
    /// <remarks>Example:
    /// A 4-bit offset binary value with a positive bias can store
    /// the values 8 through -7 inclusive.
    /// A 4-bit offset binary value with a negative bias can store
    /// the values 7 through -8 inclusive.</remarks>
    HCAOffsetBias[HCAOffsetBias["Positive"] = 1] = "Positive";
    HCAOffsetBias[HCAOffsetBias["Negative"] = 0] = "Negative";
})(HCAOffsetBias || (HCAOffsetBias = {}));
class HCABitWriter {
    get Remaining() { return this.LengthBits - this.Position; }
    constructor(buffer) {
        this.Position = 0;
        this.Buffer = buffer;
        this.dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        this.LengthBits = buffer.length * 8;
    }
    AlignPosition(multiple) {
        let newPosition = HCAUtilFunc.GetNextMultiple(this.Position, multiple);
        let bits = newPosition - this.Position;
        this.Write(0, bits);
    }
    Write(value, bitCount) {
        HCAUtilFunc.DebugAssert(bitCount >= 0 && bitCount <= 32);
        if (bitCount > this.Remaining) {
            throw new Error("Not enough bits left in output buffer");
        }
        let byteIndex = this.Position / 8;
        let bitIndex = this.Position % 8;
        if (bitCount <= 9 && this.Remaining >= 16) {
            let outValue = ((value << (16 - bitCount)) & 0xFFFF) >> bitIndex;
            outValue |= this.dv.getUint16(byteIndex);
            this.dv.setUint16(byteIndex, outValue);
        }
        else if (bitCount <= 17 && this.Remaining >= 24) {
            let outValue = ((value << (24 - bitCount)) & 0xFFFFFF) >> bitIndex;
            outValue |= this.dv.getUint16(byteIndex) << 8 | this.dv.getUint8(byteIndex + 2);
            this.dv.setUint16(byteIndex, outValue >>> 8);
            this.dv.setUint8(byteIndex + 2, outValue & 0xFF);
        }
        else if (bitCount <= 25 && this.Remaining >= 32) {
            let outValue = (((value << (32 - bitCount)) & 0xFFFFFFFF) >>> bitIndex);
            outValue |= this.dv.getUint32(byteIndex);
            this.dv.setUint32(byteIndex, outValue);
        }
        else {
            this.WriteFallback(value, bitCount);
        }
        this.Position += bitCount;
    }
    WriteFallback(value, bitCount) {
        let byteIndex = this.Position / 8;
        let bitIndex = this.Position % 8;
        while (bitCount > 0) {
            if (bitIndex >= 8) {
                bitIndex = 0;
                byteIndex++;
            }
            let toShift = 8 - bitIndex - bitCount;
            let shifted = toShift < 0 ? value >>> -toShift : value << toShift;
            let bitsToWrite = Math.min(bitCount, 8 - bitIndex);
            let mask = ((1 << bitsToWrite) - 1) << 8 - bitIndex - bitsToWrite;
            let outByte = this.dv.getUint8(byteIndex) & ~mask;
            outByte |= shifted & mask;
            this.dv.setUint8(byteIndex, outByte);
            bitIndex += bitsToWrite;
            bitCount -= bitsToWrite;
        }
    }
}
class HCAFrame {
    constructor(hca) {
        this.AcceptableNoiseLevel = 0;
        this.EvaluationBoundary = 0;
        this.Hca = hca;
        let channelTypes = HCAFrame.GetChannelTypes(hca);
        this.Channels = [];
        for (let i = 0; i < hca.format.channelCount; i++) {
            this.Channels.push(new HCAChannel({
                Type: channelTypes[i],
                CodedScaleFactorCount: channelTypes[i] == HCAChannelType.StereoSecondary
                    ? hca.compDec.BaseBandCount
                    : hca.compDec.BaseBandCount + hca.compDec.StereoBandCount
            }));
        }
        this.AthCurve = hca.UseAthCurve ? HCAFrame.ScaleAthCurve(hca.format.samplingRate) : new Uint8Array(HCAFrame.SamplesPerSubFrame);
    }
    static GetChannelTypes(hca) {
        let channelsPerTrack = hca.format.channelCount / hca.compDec.TrackCount;
        if (hca.compDec.StereoBandCount == 0 || channelsPerTrack == 1) {
            return new Array(8).fill(HCAChannelType);
        }
        const Discrete = HCAChannelType.Discrete;
        const StereoPrimary = HCAChannelType.StereoPrimary;
        const StereoSecondary = HCAChannelType.StereoSecondary;
        switch (channelsPerTrack) {
            case 2: return [StereoPrimary, StereoSecondary];
            case 3: return [StereoPrimary, StereoSecondary, Discrete];
            case 4: if (hca.compDec.ChannelConfig != 0)
                return [StereoPrimary, StereoSecondary, Discrete, Discrete];
            else
                return [StereoPrimary, StereoSecondary, StereoPrimary, StereoSecondary];
            case 5: if (hca.compDec.ChannelConfig > 2)
                return [StereoPrimary, StereoSecondary, Discrete, Discrete, Discrete];
            else
                return [StereoPrimary, StereoSecondary, Discrete, StereoPrimary, StereoSecondary];
            case 6: return [StereoPrimary, StereoSecondary, Discrete, Discrete, StereoPrimary, StereoSecondary];
            case 7: return [StereoPrimary, StereoSecondary, Discrete, Discrete, StereoPrimary, StereoSecondary, Discrete];
            case 8: return [StereoPrimary, StereoSecondary, Discrete, Discrete, StereoPrimary, StereoSecondary, StereoPrimary, StereoSecondary];
            default: return new Array(channelsPerTrack).fill(HCAChannelType);
        }
    }
    /// <summary>
    /// Scales an ATH curve to the specified frequency.
    /// </summary>
    /// <param name="frequency">The frequency to scale the curve to.</param>
    /// <returns>The scaled ATH curve</returns>
    /// <remarks>The original ATH curve is for a frequency of 41856 Hz.</remarks>
    static ScaleAthCurve(frequency) {
        var ath = new Uint8Array(HCAFrame.SamplesPerSubFrame);
        let acc = 0;
        let i;
        for (i = 0; i < ath.length; i++) {
            acc += frequency;
            let index = acc >> 13;
            if (index >= HCATables.AthCurve.length) {
                break;
            }
            ath[i] = HCATables.AthCurve[index];
        }
        for (; i < ath.length; i++) {
            ath[i] = 0xff;
        }
        return ath;
    }
}
_a = HCAFrame;
HCAFrame.SubframesPerFrame = 8;
HCAFrame.SubFrameSamplesBits = 7;
HCAFrame.SamplesPerSubFrame = 1 << _a.SubFrameSamplesBits;
HCAFrame.SamplesPerFrame = _a.SubframesPerFrame * _a.SamplesPerSubFrame;
class HCAChannel {
    constructor(values) {
        this.Type = 0;
        this.CodedScaleFactorCount = 0;
        this.PcmFloat = Array.from({ length: HCAFrame.SubframesPerFrame }, () => new Float64Array(HCAFrame.SamplesPerSubFrame));
        this.Spectra = Array.from({ length: HCAFrame.SubframesPerFrame }, () => new Float64Array(HCAFrame.SamplesPerSubFrame));
        this.ScaledSpectra = Array.from({ length: HCAFrame.SamplesPerSubFrame }, () => new Float64Array(HCAFrame.SubframesPerFrame));
        this.QuantizedSpectra = Array.from({ length: HCAFrame.SubframesPerFrame }, () => new Int32Array(HCAFrame.SamplesPerSubFrame));
        this.Gain = new Float64Array(HCAFrame.SamplesPerSubFrame);
        this.Intensity = new Int32Array(HCAFrame.SubframesPerFrame);
        this.HfrScales = new Int32Array(8);
        this.HfrGroupAverageSpectra = new Float64Array(8);
        this.Mdct = new HCAMdct(HCAFrame.SubFrameSamplesBits, HCATables.MdctWindow, Math.sqrt(2.0 / HCAFrame.SamplesPerSubFrame));
        this.ScaleFactors = new Int32Array(HCAFrame.SamplesPerSubFrame);
        this.Resolution = new Int32Array(HCAFrame.SamplesPerSubFrame);
        this.HeaderLengthBits = 0;
        this.ScaleFactorDeltaBits = 0;
        let t = this;
        for (let key in values) {
            t[key] = values[key];
        }
    }
}
var HCAChannelType;
(function (HCAChannelType) {
    HCAChannelType[HCAChannelType["Discrete"] = 0] = "Discrete";
    HCAChannelType[HCAChannelType["StereoPrimary"] = 1] = "StereoPrimary";
    HCAChannelType[HCAChannelType["StereoSecondary"] = 2] = "StereoSecondary";
})(HCAChannelType || (HCAChannelType = {}));
class HCADecoder {
    static DecodeFrame(audio, frame) {
        let reader = new HCABitReader(audio);
        HCAPacking.UnpackFrame(frame, reader);
        this.DequantizeFrame(frame);
        this.RestoreMissingBands(frame);
        this.RunImdct(frame);
    }
    static DequantizeFrame(frame) {
        for (let channel of frame.Channels) {
            this.CalculateGain(channel);
        }
        for (let sf = 0; sf < HCAFrame.SubframesPerFrame; sf++) {
            for (let channel of frame.Channels) {
                for (let s = 0; s < channel.CodedScaleFactorCount; s++) {
                    channel.Spectra[sf][s] = channel.QuantizedSpectra[sf][s] * channel.Gain[s];
                }
            }
        }
    }
    static RestoreMissingBands(frame) {
        this.ReconstructHighFrequency(frame);
        this.ApplyIntensityStereo(frame);
    }
    static CalculateGain(channel) {
        for (let i = 0; i < channel.CodedScaleFactorCount; i++) {
            channel.Gain[i] = HCATables.DequantizerScalingTable[channel.ScaleFactors[i]] * HCATables.QuantizerStepSize[channel.Resolution[i]];
        }
    }
    static ReconstructHighFrequency(frame) {
        let hca = frame.Hca;
        if (hca.HfrGroupCount == 0)
            return;
        // The last spectral coefficient should always be 0;
        let totalBandCount = Math.min(hca.compDec.TotalBandCount, 127);
        let hfrStartBand = hca.compDec.BaseBandCount + hca.compDec.StereoBandCount;
        let hfrBandCount = Math.min(hca.compDec.HfrBandCount, totalBandCount - hca.compDec.HfrBandCount);
        for (let channel of frame.Channels) {
            if (channel.Type == HCAChannelType.StereoSecondary)
                continue;
            for (let group = 0, band = 0; group < hca.HfrGroupCount; group++) {
                for (let i = 0; i < hca.compDec.BandsPerHfrGroup && band < hfrBandCount; band++, i++) {
                    let highBand = hfrStartBand + band;
                    let lowBand = hfrStartBand - band - 1;
                    let index = channel.HfrScales[group] - channel.ScaleFactors[lowBand] + 64;
                    for (let sf = 0; sf < HCAFrame.SubframesPerFrame; sf++) {
                        channel.Spectra[sf][highBand] = HCATables.ScaleConversionTable[index] * channel.Spectra[sf][lowBand];
                    }
                }
            }
        }
    }
    static ApplyIntensityStereo(frame) {
        if (frame.Hca.compDec.StereoBandCount <= 0)
            return;
        for (let c = 0; c < frame.Channels.length; c++) {
            if (frame.Channels[c].Type != HCAChannelType.StereoPrimary)
                continue;
            for (let sf = 0; sf < HCAFrame.SubframesPerFrame; sf++) {
                let l = frame.Channels[c].Spectra[sf];
                let r = frame.Channels[c + 1].Spectra[sf];
                let ratioL = HCATables.IntensityRatioTable[frame.Channels[c + 1].Intensity[sf]];
                let ratioR = ratioL - 2.0;
                for (let b = frame.Hca.compDec.BaseBandCount; b < frame.Hca.compDec.TotalBandCount; b++) {
                    r[b] = l[b] * ratioR;
                    l[b] *= ratioL;
                }
            }
        }
    }
    static RunImdct(frame) {
        for (let sf = 0; sf < HCAFrame.SubframesPerFrame; sf++) {
            for (let channel of frame.Channels) {
                channel.Mdct.RunImdct(channel.Spectra[sf], channel.PcmFloat[sf]);
            }
        }
    }
}
class HCAPacking {
    static UnpackFrame(frame, reader) {
        if (!this.UnpackFrameHeader(frame, reader))
            return false;
        this.ReadSpectralCoefficients(frame, reader);
        return this.UnpackingWasSuccessful(frame, reader);
    }
    static PackFrame(frame, outBuffer) {
        var writer = new HCABitWriter(outBuffer);
        writer.Write(0xffff, 16);
        writer.Write(frame.AcceptableNoiseLevel, 9);
        writer.Write(frame.EvaluationBoundary, 7);
        for (let channel of frame.Channels) {
            this.WriteScaleFactors(writer, channel);
            if (channel.Type == HCAChannelType.StereoSecondary) {
                for (let i = 0; i < HCAFrame.SubframesPerFrame; i++) {
                    writer.Write(channel.Intensity[i], 4);
                }
            }
            else if (frame.Hca.HfrGroupCount > 0) {
                for (let i = 0; i < frame.Hca.HfrGroupCount; i++) {
                    writer.Write(channel.HfrScales[i], 6);
                }
            }
        }
        for (let sf = 0; sf < HCAFrame.SubframesPerFrame; sf++) {
            for (let channel of frame.Channels) {
                this.WriteSpectra(writer, channel, sf);
            }
        }
        writer.AlignPosition(8);
        for (let i = writer.Position / 8; i < frame.Hca.blockSize - 2; i++) {
            writer.dv.setUint8(i, 0);
        }
        this.WriteChecksum(writer, outBuffer);
    }
    static CalculateResolution(scaleFactor, noiseLevel) {
        if (scaleFactor == 0) {
            return 0;
        }
        let curvePosition = noiseLevel - (5 * scaleFactor >> 1) + 2;
        curvePosition = HCAUtilFunc.Clamp(curvePosition, 0, 58);
        return HCATables.ScaleToResolutionCurve[curvePosition];
    }
    static UnpackFrameHeader(frame, reader) {
        let syncWord = reader.ReadInt(16);
        if (syncWord != 0xffff) {
            throw new Error("Invalid frame header");
        }
        let athCurve = frame.AthCurve;
        frame.AcceptableNoiseLevel = reader.ReadInt(9);
        frame.EvaluationBoundary = reader.ReadInt(7);
        for (let channel of frame.Channels) {
            if (!this.ReadScaleFactors(channel, reader))
                return false;
            for (let i = 0; i < frame.EvaluationBoundary; i++) {
                channel.Resolution[i] = this.CalculateResolution(channel.ScaleFactors[i], athCurve[i] + frame.AcceptableNoiseLevel - 1);
            }
            for (let i = frame.EvaluationBoundary; i < channel.CodedScaleFactorCount; i++) {
                channel.Resolution[i] = this.CalculateResolution(channel.ScaleFactors[i], athCurve[i] + frame.AcceptableNoiseLevel);
            }
            if (channel.Type == HCAChannelType.StereoSecondary) {
                this.ReadIntensity(reader, channel.Intensity);
            }
            else if (frame.Hca.HfrGroupCount > 0) {
                this.ReadHfrScaleFactors(reader, frame.Hca.HfrGroupCount, channel.HfrScales);
            }
        }
        return true;
    }
    static ReadScaleFactors(channel, reader) {
        channel.ScaleFactorDeltaBits = reader.ReadInt(3);
        if (channel.ScaleFactorDeltaBits == 0) {
            channel.ScaleFactors.fill(0, 0, channel.ScaleFactors.length);
            return true;
        }
        if (channel.ScaleFactorDeltaBits >= 6) {
            for (let i = 0; i < channel.CodedScaleFactorCount; i++) {
                channel.ScaleFactors[i] = reader.ReadInt(6);
            }
            return true;
        }
        return this.DeltaDecode(reader, channel.ScaleFactorDeltaBits, 6, channel.CodedScaleFactorCount, channel.ScaleFactors);
    }
    static ReadIntensity(reader, intensity) {
        for (let i = 0; i < HCAFrame.SubframesPerFrame; i++) {
            intensity[i] = reader.ReadInt(4);
        }
    }
    static ReadHfrScaleFactors(reader, groupCount, hfrScale) {
        for (let i = 0; i < groupCount; i++) {
            hfrScale[i] = reader.ReadInt(6);
        }
    }
    static ReadSpectralCoefficients(frame, reader) {
        for (let sf = 0; sf < HCAFrame.SubframesPerFrame; sf++) {
            for (let channel of frame.Channels) {
                for (let s = 0; s < channel.CodedScaleFactorCount; s++) {
                    let resolution = channel.Resolution[s];
                    let bits = HCATables.QuantizedSpectrumMaxBits[resolution];
                    let code = reader.PeekInt(bits);
                    if (resolution < 8) {
                        bits = HCATables.QuantizedSpectrumBits[resolution][code];
                        channel.QuantizedSpectra[sf][s] = HCATables.QuantizedSpectrumValue[resolution][code];
                    }
                    else {
                        // Read the sign-magnitude value. The low bit is the sign
                        let quantizedCoefficient = (code >> 1) * (1 - (code % 2 * 2));
                        if (quantizedCoefficient == 0) {
                            bits--;
                        }
                        channel.QuantizedSpectra[sf][s] = quantizedCoefficient;
                    }
                    reader.Position += bits;
                }
                channel.Spectra[sf].fill(0, channel.CodedScaleFactorCount, channel.CodedScaleFactorCount + 0x80 - channel.CodedScaleFactorCount);
            }
        }
    }
    static DeltaDecode(reader, deltaBits, dataBits, count, output) {
        output[0] = reader.ReadInt(dataBits);
        let maxDelta = 1 << (deltaBits - 1);
        let maxValue = (1 << dataBits) - 1;
        for (let i = 1; i < count; i++) {
            let delta = reader.ReadOffsetBinary(deltaBits, HCAOffsetBias.Positive);
            if (delta < maxDelta) {
                let value = output[i - 1] + delta;
                if (value < 0 || value > maxValue) {
                    return false;
                }
                output[i] = value;
            }
            else {
                output[i] = reader.ReadInt(dataBits);
            }
        }
        return true;
    }
    static UnpackingWasSuccessful(frame, reader) {
        // 128 leftover bits after unpacking should be high enough to get rid of false negatives,
        // and low enough that false positives will be uncommon.
        return reader.Remaining >= 16 && reader.Remaining <= 128
            || this.FrameEmpty(frame)
            || frame.AcceptableNoiseLevel == 0 && reader.Remaining >= 16;
    }
    static FrameEmpty(frame) {
        if (frame.AcceptableNoiseLevel > 0)
            return false;
        // If all the scale factors are 0, the frame is empty
        for (let channel of frame.Channels) {
            if (channel.ScaleFactorDeltaBits > 0) {
                return false;
            }
        }
        return true;
    }
    static WriteChecksum(writer, hcaBuffer) {
        writer.Position = writer.LengthBits - 16;
        let crc16 = HCACrc16.calc(hcaBuffer, hcaBuffer.length - 2);
        writer.Write(crc16, 16);
    }
    static WriteSpectra(writer, channel, subFrame) {
        for (let i = 0; i < channel.CodedScaleFactorCount; i++) {
            let resolution = channel.Resolution[i];
            let quantizedSpectra = channel.QuantizedSpectra[subFrame][i];
            if (resolution == 0)
                continue;
            if (resolution < 8) {
                let bits = HCATables.QuantizeSpectrumBits[resolution][quantizedSpectra + 8];
                writer.Write(HCATables.QuantizeSpectrumValue[resolution][quantizedSpectra + 8], bits);
            }
            else if (resolution < 16) {
                let bits = HCATables.QuantizedSpectrumMaxBits[resolution] - 1;
                writer.Write(Math.abs(quantizedSpectra), bits);
                if (quantizedSpectra != 0) {
                    writer.Write(quantizedSpectra > 0 ? 0 : 1, 1);
                }
            }
        }
    }
    static WriteScaleFactors(writer, channel) {
        let deltaBits = channel.ScaleFactorDeltaBits;
        let scales = channel.ScaleFactors;
        writer.Write(deltaBits, 3);
        if (deltaBits == 0)
            return;
        if (deltaBits == 6) {
            for (let i = 0; i < channel.CodedScaleFactorCount; i++) {
                writer.Write(scales[i], 6);
            }
            return;
        }
        writer.Write(scales[0], 6);
        let maxDelta = (1 << (deltaBits - 1)) - 1;
        let escapeValue = (1 << deltaBits) - 1;
        for (let i = 1; i < channel.CodedScaleFactorCount; i++) {
            let delta = scales[i] - scales[i - 1];
            if (Math.abs(delta) > maxDelta) {
                writer.Write(escapeValue, deltaBits);
                writer.Write(scales[i], 6);
            }
            else {
                writer.Write(maxDelta + delta, deltaBits);
            }
        }
    }
}
class HCAMdct {
    constructor(mdctBits, window, scale = 1) {
        HCAMdct.SetTables(mdctBits);
        this.MdctBits = mdctBits;
        this.MdctSize = 1 << mdctBits;
        this.Scale = scale;
        if (window.length < this.MdctSize) {
            throw new Error("Window must be as long as the MDCT size.");
        }
        this._mdctPrevious = new Float64Array(this.MdctSize);
        this._imdctPrevious = new Float64Array(this.MdctSize);
        this._scratchMdct = new Float64Array(this.MdctSize);
        this._scratchDct = new Float64Array(this.MdctSize);
        this._imdctWindow = window;
    }
    static SetTables(maxBits) {
        if (maxBits > this._tableBits) {
            for (let i = this._tableBits + 1; i <= maxBits; i++) {
                let out = this.GenerateTrigTables(i);
                this.SinTables.push(out.sin);
                this.CosTables.push(out.cos);
                this.ShuffleTables.push(this.GenerateShuffleTable(i));
            }
            this._tableBits = maxBits;
        }
    }
    RunMdct(input, output) {
        if (input.length < this.MdctSize) {
            throw new Error("Input must be as long as the MDCT size.");
        }
        if (output.length < this.MdctSize) {
            throw new Error("Output must be as long as the MDCT size.");
        }
        let size = this.MdctSize;
        let half = (size >> 1);
        let dctIn = this._scratchMdct;
        for (let i = 0; i < half; i++) {
            let a = this._imdctWindow[half - i - 1] * -input[half + i];
            let b = this._imdctWindow[half + i] * input[half - i - 1];
            let c = this._imdctWindow[i] * this._mdctPrevious[i];
            let d = this._imdctWindow[size - i - 1] * this._mdctPrevious[size - i - 1];
            dctIn[i] = a - b;
            dctIn[half + i] = c - d;
        }
        this.Dct4(dctIn, output);
        this._mdctPrevious.set(input, input.length);
    }
    RunImdct(input, output) {
        if (input.length < this.MdctSize) {
            throw new Error("Input must be as long as the MDCT size.");
        }
        if (output.length < this.MdctSize) {
            throw new Error("Output must be as long as the MDCT size.");
        }
        let size = this.MdctSize;
        let half = (size >> 1);
        let dctOut = this._scratchMdct;
        this.Dct4(input, dctOut);
        for (let i = 0; i < half; i++) {
            output[i] = this._imdctWindow[i] * dctOut[i + half] + this._imdctPrevious[i];
            output[i + half] = this._imdctWindow[i + half] * -dctOut[size - 1 - i] - this._imdctPrevious[i + half];
            this._imdctPrevious[i] = this._imdctWindow[size - 1 - i] * -dctOut[half - i - 1];
            this._imdctPrevious[i + half] = this._imdctWindow[half - i - 1] * dctOut[i];
        }
    }
    /// <summary>
    /// Does a Type-4 DCT.
    /// </summary>
    /// <param name="input">The input array containing the time or frequency-domain samples</param>
    /// <param name="output">The output array that will contain the transformed time or frequency-domain samples</param>
    Dct4(input, output) {
        let shuffleTable = HCAMdct.ShuffleTables[this.MdctBits];
        let sinTable = HCAMdct.SinTables[this.MdctBits];
        let cosTable = HCAMdct.CosTables[this.MdctBits];
        let dctTemp = this._scratchDct;
        let size = this.MdctSize;
        let lastIndex = size - 1;
        let halfSize = (size >> 1);
        for (let i = 0; i < halfSize; i++) {
            let i2 = i * 2;
            let a = input[i2];
            let b = input[lastIndex - i2];
            let sin = sinTable[i];
            let cos = cosTable[i];
            dctTemp[i2] = a * cos + b * sin;
            dctTemp[i2 + 1] = a * sin - b * cos;
        }
        let stageCount = this.MdctBits - 1;
        for (let stage = 0; stage < stageCount; stage++) {
            let blockCount = 1 << stage;
            let blockSizeBits = stageCount - stage;
            let blockHalfSizeBits = blockSizeBits - 1;
            let blockSize = 1 << blockSizeBits;
            let blockHalfSize = 1 << blockHalfSizeBits;
            sinTable = HCAMdct.SinTables[blockHalfSizeBits];
            cosTable = HCAMdct.CosTables[blockHalfSizeBits];
            for (let block = 0; block < blockCount; block++) {
                for (let i = 0; i < blockHalfSize; i++) {
                    let frontPos = (block * blockSize + i) * 2;
                    let backPos = frontPos + blockSize;
                    let a = dctTemp[frontPos] - dctTemp[backPos];
                    let b = dctTemp[frontPos + 1] - dctTemp[backPos + 1];
                    let sin = sinTable[i];
                    let cos = cosTable[i];
                    dctTemp[frontPos] += dctTemp[backPos];
                    dctTemp[frontPos + 1] += dctTemp[backPos + 1];
                    dctTemp[backPos] = a * cos + b * sin;
                    dctTemp[backPos + 1] = a * sin - b * cos;
                }
            }
        }
        for (let i = 0; i < this.MdctSize; i++) {
            output[i] = dctTemp[shuffleTable[i]] * this.Scale;
        }
    }
    static GenerateTrigTables(sizeBits) {
        let size = 1 << sizeBits;
        let out = {
            sin: new Float64Array(size),
            cos: new Float64Array(size)
        };
        for (let i = 0; i < size; i++) {
            let value = Math.PI * (4 * i + 1) / (4 * size);
            out.sin[i] = Math.sin(value);
            out.cos[i] = Math.cos(value);
        }
        return out;
    }
    static GenerateShuffleTable(sizeBits) {
        let size = 1 << sizeBits;
        var table = new Int32Array(size);
        for (let i = 0; i < size; i++) {
            table[i] = HCAUtilFunc.SignedBitReverse32Trunc(i ^ (i >> 1), sizeBits);
        }
        return table;
    }
    // ReSharper disable once UnusedMember.Local
    /// <summary>
    /// Does a Type-4 DCT. Intended for reference.
    /// </summary>
    /// <param name="input">The input array containing the time or frequency-domain samples</param>
    /// <param name="output">The output array that will contain the transformed time or frequency-domain samples</param>
    Dct4Slow(input, output) {
        for (let k = 0; k < this.MdctSize; k++) {
            let sample = 0;
            for (let n = 0; n < this.MdctSize; n++) {
                let angle = Math.PI / this.MdctSize * (k + 0.5) * (n + 0.5);
                sample += Math.cos(angle) * input[n];
            }
            output[k] = sample * this.Scale;
        }
    }
}
HCAMdct._tableBits = -1;
HCAMdct.SinTables = [];
HCAMdct.CosTables = [];
HCAMdct.ShuffleTables = [];
class HCATables {
    static isLittleEndian() {
        let test = new Float64Array([1.0]);
        let dv = new DataView(test.buffer);
        if (dv.getUint32(0) != 0)
            return false;
        return true;
    }
    static adaptEndianness6432(a) {
        if (a.byteLength % 8 != 0)
            throw new Error();
        if (!this.isLittleEndian()) {
            for (let i = 0; i < a.length; i += 2) {
                let temp = a[i];
                a[i] = a[i + 1];
                a[i + 1] = temp;
            }
        }
        return a;
    }
}
_b = HCATables;
HCATables.QuantizeSpectrumBits = [
    new Uint8Array([
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ]),
    new Uint8Array([
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x01, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ]),
    new Uint8Array([
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0x02, 0x02, 0x02, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00
    ]),
    new Uint8Array([
        0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0x03, 0x03, 0x02, 0x03, 0x03, 0x03, 0x00, 0x00, 0x00, 0x00
    ]),
    new Uint8Array([
        0x00, 0x00, 0x00, 0x00, 0x04, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x04, 0x00, 0x00, 0x00
    ]),
    new Uint8Array([
        0x00, 0x00, 0x00, 0x04, 0x04, 0x04, 0x03, 0x03, 0x03, 0x03, 0x03, 0x04, 0x04, 0x04, 0x00, 0x00
    ]),
    new Uint8Array([
        0x00, 0x00, 0x04, 0x04, 0x04, 0x04, 0x04, 0x03, 0x03, 0x03, 0x04, 0x04, 0x04, 0x04, 0x04, 0x00
    ]),
    new Uint8Array([
        0x00, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x03, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04
    ]),
];
HCATables.QuantizeSpectrumValue = [
    new Uint8Array([
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ]),
    new Uint8Array([
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ]),
    new Uint8Array([
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x07, 0x02, 0x00, 0x01, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00
    ]),
    new Uint8Array([
        0x00, 0x00, 0x00, 0x00, 0x00, 0x07, 0x05, 0x03, 0x00, 0x02, 0x04, 0x06, 0x00, 0x00, 0x00, 0x00
    ]),
    new Uint8Array([
        0x00, 0x00, 0x00, 0x00, 0x0F, 0x06, 0x04, 0x02, 0x00, 0x01, 0x03, 0x05, 0x0E, 0x00, 0x00, 0x00
    ]),
    new Uint8Array([
        0x00, 0x00, 0x00, 0x0F, 0x0D, 0x0B, 0x04, 0x02, 0x00, 0x01, 0x03, 0x0A, 0x0C, 0x0E, 0x00, 0x00
    ]),
    new Uint8Array([
        0x00, 0x00, 0x0F, 0x0D, 0x0B, 0x09, 0x07, 0x02, 0x00, 0x01, 0x06, 0x08, 0x0A, 0x0C, 0x0E, 0x00
    ]),
    new Uint8Array([
        0x00, 0x0F, 0x0D, 0x0B, 0x09, 0x07, 0x05, 0x03, 0x00, 0x02, 0x04, 0x06, 0x08, 0x0A, 0x0C, 0x0E
    ]),
];
HCATables.QuantizedSpectrumBits = [
    new Uint8Array([
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ]),
    new Uint8Array([
        0x01, 0x01, 0x02, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ]),
    new Uint8Array([
        0x02, 0x02, 0x02, 0x02, 0x02, 0x02, 0x03, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ]),
    new Uint8Array([
        0x02, 0x02, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ]),
    new Uint8Array([
        0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x04, 0x04
    ]),
    new Uint8Array([
        0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04
    ]),
    new Uint8Array([
        0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04
    ]),
    new Uint8Array([
        0x03, 0x03, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04
    ]),
];
HCATables.QuantizedSpectrumMaxBits = new Uint8Array([
    0x00, 0x02, 0x03, 0x03, 0x04, 0x04, 0x04, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C
]);
HCATables.QuantizedSpectrumValue = [
    new Int8Array([
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ]),
    new Int8Array([
        0x00, 0x00, 0x01, 0xFF, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ]),
    new Int8Array([
        0x00, 0x00, 0x01, 0x01, 0xFF, 0xFF, 0x02, 0xFE, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ]),
    new Int8Array([
        0x00, 0x00, 0x01, 0xFF, 0x02, 0xFE, 0x03, 0xFD, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ]),
    new Int8Array([
        0x00, 0x00, 0x01, 0x01, 0xFF, 0xFF, 0x02, 0x02, 0xFE, 0xFE, 0x03, 0x03, 0xFD, 0xFD, 0x04, 0xFC
    ]),
    new Int8Array([
        0x00, 0x00, 0x01, 0x01, 0xFF, 0xFF, 0x02, 0x02, 0xFE, 0xFE, 0x03, 0xFD, 0x04, 0xFC, 0x05, 0xFB
    ]),
    new Int8Array([
        0x00, 0x00, 0x01, 0x01, 0xFF, 0xFF, 0x02, 0xFE, 0x03, 0xFD, 0x04, 0xFC, 0x05, 0xFB, 0x06, 0xFA
    ]),
    new Int8Array([
        0x00, 0x00, 0x01, 0xFF, 0x02, 0xFE, 0x03, 0xFD, 0x04, 0xFC, 0x05, 0xFB, 0x06, 0xFA, 0x07, 0xF9
    ]),
];
HCATables.ScaleToResolutionCurve = new Uint8Array([
    0x0F, 0x0E, 0x0E, 0x0E, 0x0E, 0x0E, 0x0E, 0x0D, 0x0D, 0x0D, 0x0D, 0x0D, 0x0D, 0x0C, 0x0C, 0x0C,
    0x0C, 0x0C, 0x0C, 0x0B, 0x0B, 0x0B, 0x0B, 0x0B, 0x0B, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A,
    0x09, 0x09, 0x09, 0x09, 0x09, 0x09, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x07, 0x06, 0x06, 0x05,
    0x04, 0x04, 0x04, 0x03, 0x03, 0x03, 0x02, 0x02, 0x02, 0x02, 0x01
]);
HCATables.AthCurve = new Uint8Array([
    0x78, 0x5F, 0x56, 0x51, 0x4E, 0x4C, 0x4B, 0x49, 0x48, 0x48, 0x47, 0x46, 0x46, 0x45, 0x45, 0x45,
    0x44, 0x44, 0x44, 0x44, 0x43, 0x43, 0x43, 0x43, 0x43, 0x43, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42,
    0x42, 0x42, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x40, 0x40, 0x40, 0x40,
    0x40, 0x40, 0x40, 0x40, 0x40, 0x3F, 0x3F, 0x3F, 0x3F, 0x3F, 0x3F, 0x3F, 0x3F, 0x3F, 0x3F, 0x3F,
    0x3F, 0x3F, 0x3F, 0x3E, 0x3E, 0x3E, 0x3E, 0x3E, 0x3E, 0x3D, 0x3D, 0x3D, 0x3D, 0x3D, 0x3D, 0x3D,
    0x3C, 0x3C, 0x3C, 0x3C, 0x3C, 0x3C, 0x3C, 0x3C, 0x3B, 0x3B, 0x3B, 0x3B, 0x3B, 0x3B, 0x3B, 0x3B,
    0x3B, 0x3B, 0x3B, 0x3B, 0x3B, 0x3B, 0x3B, 0x3B, 0x3B, 0x3B, 0x3B, 0x3B, 0x3B, 0x3B, 0x3B, 0x3B,
    0x3B, 0x3B, 0x3B, 0x3B, 0x3B, 0x3B, 0x3B, 0x3B, 0x3C, 0x3C, 0x3C, 0x3C, 0x3C, 0x3C, 0x3C, 0x3C,
    0x3D, 0x3D, 0x3D, 0x3D, 0x3D, 0x3D, 0x3D, 0x3D, 0x3E, 0x3E, 0x3E, 0x3E, 0x3E, 0x3E, 0x3E, 0x3F,
    0x3F, 0x3F, 0x3F, 0x3F, 0x3F, 0x3F, 0x3F, 0x3F, 0x3F, 0x3F, 0x3F, 0x3F, 0x3F, 0x3F, 0x3F, 0x3F,
    0x3F, 0x3F, 0x3F, 0x3F, 0x40, 0x40, 0x40, 0x40, 0x40, 0x40, 0x40, 0x40, 0x40, 0x40, 0x40, 0x40,
    0x40, 0x40, 0x40, 0x40, 0x40, 0x40, 0x40, 0x40, 0x40, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41,
    0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41,
    0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42,
    0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x43, 0x43, 0x43,
    0x43, 0x43, 0x43, 0x43, 0x43, 0x43, 0x43, 0x43, 0x43, 0x43, 0x43, 0x43, 0x43, 0x43, 0x44, 0x44,
    0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x45, 0x45, 0x45, 0x45,
    0x45, 0x45, 0x45, 0x45, 0x45, 0x45, 0x45, 0x45, 0x46, 0x46, 0x46, 0x46, 0x46, 0x46, 0x46, 0x46,
    0x46, 0x46, 0x47, 0x47, 0x47, 0x47, 0x47, 0x47, 0x47, 0x47, 0x47, 0x47, 0x48, 0x48, 0x48, 0x48,
    0x48, 0x48, 0x48, 0x48, 0x49, 0x49, 0x49, 0x49, 0x49, 0x49, 0x49, 0x49, 0x4A, 0x4A, 0x4A, 0x4A,
    0x4A, 0x4A, 0x4A, 0x4A, 0x4B, 0x4B, 0x4B, 0x4B, 0x4B, 0x4B, 0x4B, 0x4C, 0x4C, 0x4C, 0x4C, 0x4C,
    0x4C, 0x4D, 0x4D, 0x4D, 0x4D, 0x4D, 0x4D, 0x4E, 0x4E, 0x4E, 0x4E, 0x4E, 0x4E, 0x4F, 0x4F, 0x4F,
    0x4F, 0x4F, 0x4F, 0x50, 0x50, 0x50, 0x50, 0x50, 0x51, 0x51, 0x51, 0x51, 0x51, 0x52, 0x52, 0x52,
    0x52, 0x52, 0x53, 0x53, 0x53, 0x53, 0x54, 0x54, 0x54, 0x54, 0x54, 0x55, 0x55, 0x55, 0x55, 0x56,
    0x56, 0x56, 0x56, 0x57, 0x57, 0x57, 0x57, 0x57, 0x58, 0x58, 0x58, 0x59, 0x59, 0x59, 0x59, 0x5A,
    0x5A, 0x5A, 0x5A, 0x5B, 0x5B, 0x5B, 0x5B, 0x5C, 0x5C, 0x5C, 0x5D, 0x5D, 0x5D, 0x5D, 0x5E, 0x5E,
    0x5E, 0x5F, 0x5F, 0x5F, 0x60, 0x60, 0x60, 0x61, 0x61, 0x61, 0x61, 0x62, 0x62, 0x62, 0x63, 0x63,
    0x63, 0x64, 0x64, 0x64, 0x65, 0x65, 0x66, 0x66, 0x66, 0x67, 0x67, 0x67, 0x68, 0x68, 0x68, 0x69,
    0x69, 0x6A, 0x6A, 0x6A, 0x6B, 0x6B, 0x6B, 0x6C, 0x6C, 0x6D, 0x6D, 0x6D, 0x6E, 0x6E, 0x6F, 0x6F,
    0x70, 0x70, 0x70, 0x71, 0x71, 0x72, 0x72, 0x73, 0x73, 0x73, 0x74, 0x74, 0x75, 0x75, 0x76, 0x76,
    0x77, 0x77, 0x78, 0x78, 0x78, 0x79, 0x79, 0x7A, 0x7A, 0x7B, 0x7B, 0x7C, 0x7C, 0x7D, 0x7D, 0x7E,
    0x7E, 0x7F, 0x7F, 0x80, 0x80, 0x81, 0x81, 0x82, 0x83, 0x83, 0x84, 0x84, 0x85, 0x85, 0x86, 0x86,
    0x87, 0x88, 0x88, 0x89, 0x89, 0x8A, 0x8A, 0x8B, 0x8C, 0x8C, 0x8D, 0x8D, 0x8E, 0x8F, 0x8F, 0x90,
    0x90, 0x91, 0x92, 0x92, 0x93, 0x94, 0x94, 0x95, 0x95, 0x96, 0x97, 0x97, 0x98, 0x99, 0x99, 0x9A,
    0x9B, 0x9B, 0x9C, 0x9D, 0x9D, 0x9E, 0x9F, 0xA0, 0xA0, 0xA1, 0xA2, 0xA2, 0xA3, 0xA4, 0xA5, 0xA5,
    0xA6, 0xA7, 0xA7, 0xA8, 0xA9, 0xAA, 0xAA, 0xAB, 0xAC, 0xAD, 0xAE, 0xAE, 0xAF, 0xB0, 0xB1, 0xB1,
    0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xBA, 0xBB, 0xBC, 0xBD, 0xBE, 0xBF,
    0xC0, 0xC1, 0xC1, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9, 0xC9, 0xCA, 0xCB, 0xCC, 0xCD,
    0xCE, 0xCF, 0xD0, 0xD1, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xDB, 0xDC, 0xDD,
    0xDE, 0xDF, 0xE0, 0xE1, 0xE2, 0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xEB, 0xED, 0xEE,
    0xEF, 0xF0, 0xF1, 0xF2, 0xF3, 0xF4, 0xF5, 0xF7, 0xF8, 0xF9, 0xFA, 0xFB, 0xFC, 0xFD
]);
HCATables.MdctWindow = new Float64Array(_b.adaptEndianness6432(new Uint32Array([
    0x00000000, 0x3F46A09E, 0x00000000, 0x3F603077, 0x00000000, 0x3F6E18A7, 0x00000000, 0x3F77724D,
    0x20000000, 0x3F809501, 0x00000000, 0x3F861040, 0x80000000, 0x3F8C2509, 0xE0000000, 0x3F9167E2,
    0x40000000, 0x3F950732, 0xA0000000, 0x3F98EFF7, 0x00000000, 0x3F9D2222, 0xA0000000, 0x3FA0CEF9,
    0x80000000, 0x3FA331F8, 0x80000000, 0x3FA5BA6B, 0x60000000, 0x3FA868C8, 0x20000000, 0x3FAB3D98,
    0x00000000, 0x3FAE3975, 0xC0000000, 0x3FB0AE83, 0x60000000, 0x3FB25482, 0x80000000, 0x3FB40F16,
    0x40000000, 0x3FB5DEA4, 0xC0000000, 0x3FB7C393, 0x60000000, 0x3FB9BE4F, 0xA0000000, 0x3FBBCF43,
    0xA0000000, 0x3FBDF6DD, 0x60000000, 0x3FC01AC5, 0x40000000, 0x3FC145DB, 0x40000000, 0x3FC27CE5,
    0x20000000, 0x3FC3C016, 0x40000000, 0x3FC50F9E, 0xA0000000, 0x3FC66BAA, 0x20000000, 0x3FC7D464,
    0xA0000000, 0x3FC949EE, 0xE0000000, 0x3FCACC67, 0xE0000000, 0x3FCC5BE6, 0x20000000, 0x3FCDF87A,
    0x00000000, 0x3FCFA227, 0x40000000, 0x3FD0AC74, 0xE0000000, 0x3FD18E56, 0x20000000, 0x3FD276AC,
    0xE0000000, 0x3FD3655D, 0xE0000000, 0x3FD45A4D, 0x60000000, 0x3FD55555, 0x40000000, 0x3FD65644,
    0xC0000000, 0x3FD75CE0, 0xE0000000, 0x3FD868E6, 0xA0000000, 0x3FD97A07, 0xC0000000, 0x3FDA8FE8,
    0x00000000, 0x3FDBAA25, 0x80000000, 0x3FDCC84B, 0xE0000000, 0x3FDDE9DF, 0xE0000000, 0x3FDF0E5A,
    0x20000000, 0x3FE01A95, 0x40000000, 0x3FE0AED9, 0x60000000, 0x3FE143A7, 0x00000000, 0x3FE1D8A9,
    0xA0000000, 0x3FE26D84, 0x40000000, 0x3FE301DE, 0x40000000, 0x3FE39558, 0x40000000, 0x3FE42794,
    0xA0000000, 0x3FE4B834, 0xE0000000, 0x3FE546DC, 0x00000000, 0x3FE5D333, 0xA0000000, 0x3FE65CE0,
    0xC0000000, 0x3FE6E393, 0xC0000000, 0x3FE766FF, 0x40000000, 0x3FE7E6DE, 0x00000000, 0x3FE862F0,
    0xC0000000, 0x3FE8DAFC, 0x80000000, 0x3FE94ED4, 0x80000000, 0x3FE9BE4F, 0xE0000000, 0x3FEA294D,
    0xA0000000, 0x3FEA8FB8, 0x60000000, 0x3FEAF180, 0xC0000000, 0x3FEB4E9D, 0xE0000000, 0x3FEBA710,
    0xE0000000, 0x3FEBFAE0, 0x40000000, 0x3FEC4A1B, 0x20000000, 0x3FEC94D3, 0x00000000, 0x3FECDB21,
    0xC0000000, 0x3FED1D21, 0x20000000, 0x3FED5AF6, 0x20000000, 0x3FED94C2, 0x40000000, 0x3FEDCAAC,
    0xE0000000, 0x3FEDFCDC, 0xE0000000, 0x3FEE2B7D, 0x20000000, 0x3FEE56BA, 0xC0000000, 0x3FEE7EBC,
    0x20000000, 0x3FEEA3B1, 0x60000000, 0x3FEEC5C2, 0xE0000000, 0x3FEEE51A, 0x00000000, 0x3FEF01E4,
    0x80000000, 0x3FEF1C46, 0x80000000, 0x3FEF3469, 0xE0000000, 0x3FEF4A72, 0x20000000, 0x3FEF5E87,
    0x00000000, 0x3FEF70C9, 0xC0000000, 0x3FEF8159, 0x00000000, 0x3FEF9059, 0xC0000000, 0x3FEF9DE4,
    0x60000000, 0x3FEFAA19, 0xC0000000, 0x3FEFB511, 0xE0000000, 0x3FEFBEE6, 0xC0000000, 0x3FEFC7B0,
    0x40000000, 0x3FEFCF85, 0x80000000, 0x3FEFD679, 0xE0000000, 0x3FEFDCA0, 0x80000000, 0x3FEFE20D,
    0x60000000, 0x3FEFE6D0, 0x40000000, 0x3FEFEAF9, 0xC0000000, 0x3FEFEE96, 0xC0000000, 0x3FEFF1B6,
    0xC0000000, 0x3FEFF465, 0x60000000, 0x3FEFF6AF, 0xC0000000, 0x3FEFF89E, 0xA0000000, 0x3FEFFA3D,
    0xA0000000, 0x3FEFFB95, 0x20000000, 0x3FEFFCAF, 0x00000000, 0x3FEFFD92, 0xC0000000, 0x3FEFFE45,
    0x00000000, 0x3FEFFED1, 0x00000000, 0x3FEFFF3A, 0x40000000, 0x3FEFFF86, 0x40000000, 0x3FEFFFBB,
    0xA0000000, 0x3FEFFFDD, 0xE0000000, 0x3FEFFFF1, 0xE0000000, 0x3FEFFFFB, 0x80000000, 0x3FEFFFFF
])).buffer);
HCATables.DefaultChannelMapping = new Uint8Array([
    0x00, 0x01, 0x00, 0x04, 0x00, 0x01, 0x03, 0x07, 0x03
]);
HCATables.ValidChannelMappings = [
    new Uint8Array([
        0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ]),
    new Uint8Array([
        0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ]),
    new Uint8Array([
        0x00, 0x01, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00
    ]),
    new Uint8Array([
        0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00
    ]),
    new Uint8Array([
        0x00, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x01
    ]),
    new Uint8Array([
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00
    ]),
    new Uint8Array([
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01
    ]),
    new Uint8Array([
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00
    ]),
];
HCATables.DequantizerScalingTable = new Float64Array(_b.adaptEndianness6432(new Uint32Array([
    0xCA5D9201, 0x3E8551A4, 0x2E57D139, 0x3E8C67F1, 0xA93E2F4A, 0x3E92ECAF, 0xB0CDC5D5, 0x3E993737,
    0x2B7247ED, 0x3EA0CC92, 0x82552217, 0x3EA66238, 0xF301B44F, 0x3EADD321, 0x4C123416, 0x3EB3DEA6,
    0x1330B349, 0x3EBA799E, 0xEB6FCB6C, 0x3EC1A35B, 0x4FDE5D33, 0x3EC78069, 0x5B6E452F, 0x3ECF5076,
    0x99FDDD03, 0x3ED4DCB2, 0x904BC1C3, 0x3EDBCC1E, 0xE1F56378, 0x3EE284DF, 0x422AA0CF, 0x3EE8ACE5,
    0x29DDF6D6, 0x3EF0706B, 0x15AD213E, 0x3EF5E76F, 0x080D89E3, 0x3EFD2F87, 0x373AA9C2, 0x3F0371A7,
    0x19E32318, 0x3F09E863, 0xAEA92DD8, 0x3F11429A, 0xF951947B, 0x3F16FF7D, 0xA2A490CD, 0x3F1EA4AF,
    0xED1D0050, 0x3F246A41, 0xB84F15F0, 0x3F2B33A2, 0x917DDC90, 0x3F321F49, 0x994CCE0A, 0x3F382589,
    0xA9FB332F, 0x3F40163D, 0x36B527D3, 0x3F456F47, 0x9406E7AC, 0x3F4C8F6D, 0x0A31B70F, 0x3F5306FE,
    0xCBC85207, 0x3F595A44, 0x32D3D19D, 0x3F60E3EC, 0xD44CA96C, 0x3F668155, 0x337B9B56, 0x3F6DFC97,
    0x04AC8016, 0x3F73FA45, 0x5579FDB8, 0x3F7A9E6B, 0x84045CCF, 0x3F81BBE0, 0x73EB0181, 0x3F87A114,
    0xAD9CBE0C, 0x3F8F7BFD, 0x769D2CA2, 0x3F94F9B2, 0x5BD71E03, 0x3F9BF2C2, 0xF51FDEDE, 0x3FA29E9D,
    0x16B54487, 0x3FA8CF32, 0x18759BC5, 0x3FB08745, 0xB976DC05, 0x3FB605E1, 0xDCFBA483, 0x3FBD5818,
    0x6D05D863, 0x3FC38CAE, 0x7B5DE561, 0x3FCA0C66, 0xC8A58E4F, 0x3FD15A98, 0xE8EC5F71, 0x3FD71F75,
    0x2D8E67ED, 0x3FDECF48, 0xB5C13CCE, 0x3FE486A2, 0x8DE55938, 0x3FEB5972, 0x6E756237, 0x3FF2387A,
    0x4623C7AC, 0x3FF8471A, 0x3E778060, 0x40002C9A, 0xD497C7FD, 0x40058D12, 0xDCEF9068, 0x400CB720,
    0xFC4CD831, 0x40132170, 0x9FDE4E50, 0x40197D82, 0xAFFED31B, 0x4020FB66, 0x667F3BCD, 0x4026A09E
])).buffer);
HCATables.QuantizerStepSize = new Float64Array(_b.adaptEndianness6432(new Uint32Array([
    0x00000000, 0x00000000, 0x55555555, 0x3FE55555, 0x9999999A, 0x3FD99999, 0x92492492, 0x3FD24924,
    0x1C71C71C, 0x3FCC71C7, 0x745D1746, 0x3FC745D1, 0x13B13B14, 0x3FC3B13B, 0x11111111, 0x3FC11111,
    0x08421084, 0x3FB08421, 0x10410410, 0x3FA04104, 0x81020408, 0x3F902040, 0x10101010, 0x3F801010,
    0x02010080, 0x3F700804, 0x00401004, 0x3F600401, 0x40080100, 0x3F500200, 0x10010010, 0x3F400100
])).buffer);
HCATables.QuantizerDeadZone = new Float64Array(_b.adaptEndianness6432(new Uint32Array([
    0xFFFFFFFF, 0xFFFFFFFF, 0x55555553, 0x3FD55555, 0x99999997, 0x3FC99999, 0x9249248E, 0x3FC24924,
    0x1C71C717, 0x3FBC71C7, 0x745D1740, 0x3FB745D1, 0x13B13B0D, 0x3FB3B13B, 0x11111109, 0x3FB11111,
    0x08421074, 0x3FA08421, 0x104103F0, 0x3F904104, 0x810203C8, 0x3F802040, 0x10100F90, 0x3F701010,
    0x0200FF80, 0x3F600804, 0x00400E04, 0x3F500401, 0x4007FD00, 0x3F400200, 0x1000F810, 0x3F300100
])).buffer);
HCATables.QuantizerScalingTable = new Float64Array(_b.adaptEndianness6432(new Uint32Array([
    0x543E1A21, 0x41580427, 0x88628CE2, 0x4152063B, 0x298DB677, 0x414B0E07, 0x6061893A, 0x41444E08,
    0xFBC74C96, 0x413E7A51, 0x3C651A3D, 0x4136DFB2, 0xC06C31D6, 0x41312ABD, 0x82A3F0A0, 0x4129C491,
    0x5F929FFC, 0x412356C5, 0x4A07898B, 0x411D072D, 0x8A5946C2, 0x4115C926, 0xD315857D, 0x411059B0,
    0xD98A66A6, 0x41088AC7, 0x65E27CE7, 0x41026B45, 0x30A10656, 0x40FBA5B0, 0xD5362A32, 0x40F4BFDA,
    0x376BBAA6, 0x40EF252B, 0x564267D4, 0x40E75FEB, 0x388C8DF2, 0x40E18AF9, 0xB23E2568, 0x40DA5503,
    0xC313A8ED, 0x40D3C32D, 0x03DB3293, 0x40CDA9E6, 0x34CCC328, 0x40C64346, 0x6CF98916, 0x40C0B558,
    0x0B91FFCF, 0x40B9145B, 0xA6E40313, 0x40B2D285, 0x5FFFD084, 0x40AC40AB, 0x569D4F89, 0x40A5342B,
    0x2B8F71FE, 0x409FD3C2, 0x36CF4E6A, 0x4097E2F3, 0x22FCD922, 0x4091ED50, 0x995AD3B6, 0x408AE89F,
    0xD950A89D, 0x408431F5, 0xE78B3FFF, 0x407E502E, 0x750BDAC6, 0x4076C012, 0xD0125B56, 0x40711301,
    0x70CA07C1, 0x4069A0F1, 0xB2641705, 0x40633C08, 0x555DC401, 0x405CDF0B, 0xDD48542F, 0x4055AB07,
    0xE86E7F89, 0x40504315, 0x9B4492F2, 0x404868D9, 0x4FB2A643, 0x404251CE, 0xF2FB5E4C, 0x403B7F76,
    0xF0D7D3E3, 0x4034A32A, 0xEE615A2D, 0x402EFA1B, 0x48A58178, 0x40273F9A, 0x3C7D517D, 0x402172B8,
    0xEC4A2D37, 0x401A309B, 0x34E59FFA, 0x4013A7DB, 0x16C9839B, 0x400D80E3, 0xB03A5587, 0x4006247E,
    0xCAC6F385, 0x40009E3E, 0x99157739, 0x3FF8F1AE, 0xD0DAD991, 0x3FF2B87F, 0xDD85529E, 0x3FEC199B,
    0xA2CF6642, 0x3FE516DA, 0x819E90DA, 0x3FDFA7C1, 0x0130C133, 0x3FD7C1ED, 0x3168B9AB, 0x3FD1D487,
    0xBFD3F37A, 0x3FCAC36B, 0x21F72E2A, 0x3FC4160A, 0x14F5A129, 0x3FBE2646, 0x667F3BCC, 0x3FB6A09E
])).buffer);
HCATables.QuantizerInverseStepSize = new Float64Array(_b.adaptEndianness6432(new Uint32Array([
    0x00000000, 0x3FE00000, 0x00000000, 0x3FF80000, 0x00000000, 0x40040000, 0x00000000, 0x400C0000,
    0x00000000, 0x40120000, 0x00000000, 0x40160000, 0x00000000, 0x401A0000, 0x00000000, 0x401E0000,
    0x00000000, 0x402F0000, 0x00000000, 0x403F8000, 0x00000000, 0x404FC000, 0x00000000, 0x405FE000,
    0x00000000, 0x406FF000, 0x00000000, 0x407FF800, 0x00000000, 0x408FFC00, 0x00000000, 0x409FFE00
])).buffer);
HCATables.ResolutionMaxValues = new Int32Array([
    0x00000000, 0x00000001, 0x00000002, 0x00000003, 0x00000004, 0x00000005, 0x00000006, 0x00000007,
    0x0000000F, 0x0000001F, 0x0000003F, 0x0000007F, 0x000000FF, 0x000001FF, 0x000003FF, 0x000007FF
]);
HCATables.IntensityRatioTable = new Float64Array(_b.adaptEndianness6432(new Uint32Array([
    0x00000000, 0x40000000, 0x6DB6DB6E, 0x3FFDB6DB, 0xDB6DB6DB, 0x3FFB6DB6, 0x49249249, 0x3FF92492,
    0xB6DB6DB7, 0x3FF6DB6D, 0x24924925, 0x3FF49249, 0x92492492, 0x3FF24924, 0x00000000, 0x3FF00000,
    0xDB6DB6DB, 0x3FEB6DB6, 0xB6DB6DB7, 0x3FE6DB6D, 0x92492492, 0x3FE24924, 0xDB6DB6DB, 0x3FDB6DB6,
    0x92492492, 0x3FD24924, 0x92492492, 0x3FC24924, 0x00000000, 0x00000000
])).buffer);
HCATables.IntensityRatioBoundsTable = new Float64Array(_b.adaptEndianness6432(new Uint32Array([
    0xB6DB6DB7, 0x3FFEDB6D, 0x24924925, 0x3FFC9249, 0x92492492, 0x3FFA4924, 0x00000000, 0x3FF80000,
    0x6DB6DB6E, 0x3FF5B6DB, 0xDB6DB6DB, 0x3FF36DB6, 0x49249249, 0x3FF12492, 0x6DB6DB6E, 0x3FEDB6DB,
    0x49249249, 0x3FE92492, 0x24924925, 0x3FE49249, 0x00000000, 0x3FE00000, 0xB6DB6DB7, 0x3FD6DB6D,
    0xDB6DB6DB, 0x3FCB6DB6, 0x92492492, 0x3FB24924
])).buffer);
HCATables.ScaleConversionTable = new Float64Array(_b.adaptEndianness6432(new Uint32Array([
    0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x21F72E1D, 0x3E54160A, 0xBFD3F368, 0x3E5AC36B,
    0x3168B99F, 0x3E61D487, 0x0130C123, 0x3E67C1ED, 0x819E90C4, 0x3E6FA7C1, 0xA2CF6635, 0x3E7516DA,
    0xDD85528B, 0x3E7C199B, 0xD0DAD985, 0x3E82B87F, 0x99157728, 0x3E88F1AE, 0xCAC6F37A, 0x3E909E3E,
    0xB03A5578, 0x3E96247E, 0x16C98388, 0x3E9D80E3, 0x34E59FEC, 0x3EA3A7DB, 0xEC4A2D26, 0x3EAA309B,
    0x3C7D5172, 0x3EB172B8, 0x48A58168, 0x3EB73F9A, 0xEE615A18, 0x3EBEFA1B, 0xF0D7D3D4, 0x3EC4A32A,
    0xF2FB5E3A, 0x3ECB7F76, 0x4FB2A637, 0x3ED251CE, 0x9B4492E1, 0x3ED868D9, 0xE86E7F7E, 0x3EE04315,
    0xDD485420, 0x3EE5AB07, 0x555DC3EE, 0x3EECDF0B, 0xB26416F7, 0x3EF33C08, 0x70CA07B0, 0x3EF9A0F1,
    0xD0125B4A, 0x3F011301, 0x750BDAB6, 0x3F06C012, 0xE78B3FEB, 0x3F0E502E, 0xD950A890, 0x3F1431F5,
    0x995AD3A4, 0x3F1AE89F, 0x22FCD917, 0x3F21ED50, 0x36CF4E5A, 0x3F27E2F3, 0x2B8F71E7, 0x3F2FD3C2,
    0x569D4F7B, 0x3F35342B, 0x5FFFD072, 0x3F3C40AB, 0xA6E40306, 0x3F42D285, 0x0B91FFBF, 0x3F49145B,
    0x6CF9890B, 0x3F50B558, 0x34CCC31A, 0x3F564346, 0x03DB327E, 0x3F5DA9E6, 0xC313A8E0, 0x3F63C32D,
    0xB23E2557, 0x3F6A5503, 0x388C8DE6, 0x3F718AF9, 0x564267C4, 0x3F775FEB, 0x376BBA92, 0x3F7F252B,
    0xD5362A24, 0x3F84BFDA, 0x30A10645, 0x3F8BA5B0, 0x65E27CDA, 0x3F926B45, 0xD98A6696, 0x3F988AC7,
    0xD3158572, 0x3FA059B0, 0x8A5946B4, 0x3FA5C926, 0x4A078978, 0x3FAD072D, 0x5F929FEF, 0x3FB356C5,
    0x82A3F08E, 0x3FB9C491, 0xC06C31CB, 0x3FC12ABD, 0x3C651A2D, 0x3FC6DFB2, 0xFBC74C82, 0x3FCE7A51,
    0x6061892C, 0x3FD44E08, 0x298DB665, 0x3FDB0E07, 0x88628CD6, 0x3FE2063B, 0x543E1A11, 0x3FE80427,
    0x00000000, 0x3FF00000, 0xCA5D920F, 0x3FF551A4, 0x2E57D14C, 0x3FFC67F1, 0xA93E2F57, 0x4002ECAF,
    0xB0CDC5E6, 0x40093737, 0x2B7247F8, 0x4010CC92, 0x82552226, 0x40166238, 0xF301B463, 0x401DD321,
    0x4C123424, 0x4023DEA6, 0x1330B35B, 0x402A799E, 0xEB6FCB77, 0x4031A35B, 0x4FDE5D42, 0x40378069,
    0x5B6E4544, 0x403F5076, 0x99FDDD10, 0x4044DCB2, 0x904BC1D6, 0x404BCC1E, 0xE1F56384, 0x405284DF,
    0x422AA0E0, 0x4058ACE5, 0x29DDF6E1, 0x4060706B, 0x15AD214D, 0x4065E76F, 0x080D89F8, 0x406D2F87,
    0x373AA9CF, 0x407371A7, 0x19E32329, 0x4079E863, 0xAEA92DE4, 0x4081429A, 0xF951948A, 0x4086FF7D,
    0xA2A490E1, 0x408EA4AF, 0xED1D005D, 0x40946A41, 0xB84F1603, 0x409B33A2, 0x917DDC9B, 0x40A21F49,
    0x994CCE1A, 0x40A82589, 0xA9FB333A, 0x40B0163D, 0x36B527E1, 0x40B56F47, 0x9406E7BF, 0x40BC8F6D,
    0x0A31B71C, 0x40C306FE, 0xCBC85218, 0x40C95A44, 0x32D3D1A8, 0x40D0E3EC, 0xD44CA97C, 0x40D68155,
    0x337B9B6A, 0x40DDFC97, 0x04AC8024, 0x40E3FA45, 0x5579FDCA, 0x40EA9E6B, 0x84045CDB, 0x40F1BBE0,
    0x73EB0191, 0x40F7A114, 0xAD9CBE21, 0x40FF7BFD, 0x769D2CB0, 0x4104F9B2, 0x5BD71E15, 0x410BF2C2,
    0xF51FDEEA, 0x41129E9D, 0x16B54498, 0x4118CF32, 0x18759BD0, 0x41208745, 0xB976DC14, 0x412605E1,
    0xDCFBA496, 0x412D5818, 0x6D05D870, 0x41338CAE, 0x7B5DE573, 0x413A0C66, 0xC8A58E5B, 0x41415A98,
    0xE8EC5F81, 0x41471F75, 0x2D8E6802, 0x414ECF48, 0xB5C13CDC, 0x415486A2, 0x8DE5594A, 0x415B5972,
    0x6E756243, 0x4162387A, 0x4623C7BC, 0x4168471A, 0x3E77806B, 0x41702C9A, 0xD497C80B, 0x41758D12,
    0xDCEF907C, 0x417CB720, 0xFC4CD83E, 0x41832170, 0x9FDE4E61, 0x41897D82, 0x00000000, 0x00000000
])).buffer);
class HCACrc16 {
    static calc(data, size) {
        if (size > data.byteLength)
            throw new Error();
        if (size < 0)
            throw new Error();
        let sum = 0;
        for (let i = 0; i < size; i++)
            sum = ((sum << 8) ^ this._v[(sum >> 8) ^ data[i]]) & 0x0000ffff;
        return sum & 0x0000ffff;
    }
    static verify(data, size, expected, doNotThrow = false) {
        if (expected == null) {
            expected = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(size);
        }
        let actual = this.calc(data, size);
        let result = expected == actual;
        if (!result) {
            function toHex(num) {
                const padding = "0000";
                let hex = padding + num.toString(padding.length * 4).toUpperCase();
                return "0x" + hex.substring(hex.length - padding.length, hex.length);
            }
            let msg = `checksum mismatch (expected=${toHex(expected)} actual=${toHex(actual)})`;
            if (doNotThrow)
                console.error(msg);
            else
                throw new Error(msg);
        }
        return result;
    }
    static fix(data, size) {
        let newCrc16 = this.calc(data, size);
        new DataView(data.buffer, data.byteOffset, data.byteLength).setUint16(size, newCrc16);
        return data;
    }
}
HCACrc16._v = new Uint16Array([
    0x0000, 0x8005, 0x800F, 0x000A, 0x801B, 0x001E, 0x0014, 0x8011, 0x8033, 0x0036, 0x003C, 0x8039, 0x0028, 0x802D, 0x8027, 0x0022,
    0x8063, 0x0066, 0x006C, 0x8069, 0x0078, 0x807D, 0x8077, 0x0072, 0x0050, 0x8055, 0x805F, 0x005A, 0x804B, 0x004E, 0x0044, 0x8041,
    0x80C3, 0x00C6, 0x00CC, 0x80C9, 0x00D8, 0x80DD, 0x80D7, 0x00D2, 0x00F0, 0x80F5, 0x80FF, 0x00FA, 0x80EB, 0x00EE, 0x00E4, 0x80E1,
    0x00A0, 0x80A5, 0x80AF, 0x00AA, 0x80BB, 0x00BE, 0x00B4, 0x80B1, 0x8093, 0x0096, 0x009C, 0x8099, 0x0088, 0x808D, 0x8087, 0x0082,
    0x8183, 0x0186, 0x018C, 0x8189, 0x0198, 0x819D, 0x8197, 0x0192, 0x01B0, 0x81B5, 0x81BF, 0x01BA, 0x81AB, 0x01AE, 0x01A4, 0x81A1,
    0x01E0, 0x81E5, 0x81EF, 0x01EA, 0x81FB, 0x01FE, 0x01F4, 0x81F1, 0x81D3, 0x01D6, 0x01DC, 0x81D9, 0x01C8, 0x81CD, 0x81C7, 0x01C2,
    0x0140, 0x8145, 0x814F, 0x014A, 0x815B, 0x015E, 0x0154, 0x8151, 0x8173, 0x0176, 0x017C, 0x8179, 0x0168, 0x816D, 0x8167, 0x0162,
    0x8123, 0x0126, 0x012C, 0x8129, 0x0138, 0x813D, 0x8137, 0x0132, 0x0110, 0x8115, 0x811F, 0x011A, 0x810B, 0x010E, 0x0104, 0x8101,
    0x8303, 0x0306, 0x030C, 0x8309, 0x0318, 0x831D, 0x8317, 0x0312, 0x0330, 0x8335, 0x833F, 0x033A, 0x832B, 0x032E, 0x0324, 0x8321,
    0x0360, 0x8365, 0x836F, 0x036A, 0x837B, 0x037E, 0x0374, 0x8371, 0x8353, 0x0356, 0x035C, 0x8359, 0x0348, 0x834D, 0x8347, 0x0342,
    0x03C0, 0x83C5, 0x83CF, 0x03CA, 0x83DB, 0x03DE, 0x03D4, 0x83D1, 0x83F3, 0x03F6, 0x03FC, 0x83F9, 0x03E8, 0x83ED, 0x83E7, 0x03E2,
    0x83A3, 0x03A6, 0x03AC, 0x83A9, 0x03B8, 0x83BD, 0x83B7, 0x03B2, 0x0390, 0x8395, 0x839F, 0x039A, 0x838B, 0x038E, 0x0384, 0x8381,
    0x0280, 0x8285, 0x828F, 0x028A, 0x829B, 0x029E, 0x0294, 0x8291, 0x82B3, 0x02B6, 0x02BC, 0x82B9, 0x02A8, 0x82AD, 0x82A7, 0x02A2,
    0x82E3, 0x02E6, 0x02EC, 0x82E9, 0x02F8, 0x82FD, 0x82F7, 0x02F2, 0x02D0, 0x82D5, 0x82DF, 0x02DA, 0x82CB, 0x02CE, 0x02C4, 0x82C1,
    0x8243, 0x0246, 0x024C, 0x8249, 0x0258, 0x825D, 0x8257, 0x0252, 0x0270, 0x8275, 0x827F, 0x027A, 0x826B, 0x026E, 0x0264, 0x8261,
    0x0220, 0x8225, 0x822F, 0x022A, 0x823B, 0x023E, 0x0234, 0x8231, 0x8213, 0x0216, 0x021C, 0x8219, 0x0208, 0x820D, 0x8207, 0x0202
]);
class HCACipher {
    init1() {
        for (let i = 1, v = 0; i < 0xFF; i++) {
            v = (v * 13 + 11) & 0xFF;
            if (v == 0 || v == 0xFF)
                v = (v * 13 + 11) & 0xFF;
            this._table[i] = v;
        }
        this._table[0] = 0;
        this._table[0xFF] = 0xFF;
    }
    init56() {
        let key1 = this.getKey1();
        let key2 = this.getKey2();
        if (!key1)
            key2--;
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
            if (a != 0 && a != 0xFF)
                this._table[t++] = a;
        }
        this._table[0] = 0;
        this._table[0xFF] = 0xFF;
    }
    createTable(r, key) {
        let mul = ((key & 1) << 3) | 5;
        let add = (key & 0xE) | 1;
        let t = 0;
        key >>= 4;
        for (let i = 0; i < 0x10; i++) {
            key = (key * mul + add) & 0xF;
            r[t++] = key;
        }
    }
    invertTable() {
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
            if (bitMap[higher4] & flag)
                throw new Error("_table is not bijective");
            // update table
            this._table[key] = val;
        }
        return this;
    }
    getType() {
        return this.cipherType;
    }
    getEncrypt() {
        return this.encrypt;
    }
    getKey1() {
        return this.dv1.getUint32(0, true);
    }
    getKey2() {
        return this.dv2.getUint32(0, true);
    }
    getBytesOfTwoKeys() {
        let buf = new Uint8Array(8);
        buf.set(new Uint8Array(this.key1buf), 0);
        buf.set(new Uint8Array(this.key2buf), 4);
        return buf;
    }
    setKey1(key) {
        this.dv1.setUint32(0, key, true);
        this.init56();
        this.cipherType = 0x38;
        return this;
    }
    setKey2(key) {
        this.dv2.setUint32(0, key, true);
        this.init56();
        this.cipherType = 0x38;
        return this;
    }
    setKeys(key1, key2) {
        this.dv1.setUint32(0, key1, true);
        this.dv2.setUint32(0, key2, true);
        this.init56();
        this.cipherType = 0x38;
        return this;
    }
    setToDefKeys() {
        return this.setKeys(HCACipher.defKey1, HCACipher.defKey2);
    }
    setToNoKey() {
        this.init1();
        this.cipherType = 0x01;
        return this;
    }
    mask(block, offset, size) {
        // encrypt or decrypt block data
        for (let i = 0; i < size; i++)
            block[offset + i] = this._table[block[offset + i]];
    }
    static isHCAHeaderMasked(hca) {
        // fast & dirty way to determine whether encrypted, not recommended
        if (hca[0] & 0x80 || hca[1] & 0x80 || hca[2] & 0x80)
            return true;
        else
            return false;
    }
    static parseKey(key) {
        switch (typeof key) {
            case "number":
                return key;
            case "string":
                // avoid ambiguity: always treat as hex
                if (!key.match(/^0x/))
                    key = "0x" + key;
                key = parseInt(key);
                if (isNaN(key))
                    throw new Error("cannot parse as integer");
                return key;
            case "object":
                // avoid endianness ambiguity: only accepting Uint8Array, then read as little endian
                if (key instanceof Uint8Array && key.byteLength == 4) {
                    return new DataView(key.buffer, key.byteOffset, key.byteLength).getUint32(0, true);
                }
            default:
                throw new Error("can only accept number/hex string/Uint8Array[4]");
        }
    }
    constructor(key1, key2) {
        this.cipherType = 0;
        this.encrypt = false;
        this.key1buf = new ArrayBuffer(4);
        this.key2buf = new ArrayBuffer(4);
        this._table = new Uint8Array(256);
        this.dv1 = new DataView(this.key1buf);
        this.dv2 = new DataView(this.key2buf);
        if (key1 == null)
            throw new Error("no keys given. use \"defaultkey\" if you want to use the default key");
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
                    key2 = 0;
                }
                else {
                    key2 = HCACipher.parseKey(key2);
                }
                this.setKeys(key1, key2);
        }
    }
}
HCACipher.defKey1 = 0x01395C51;
HCACipher.defKey2 = 0x00000000;
const suspendAudioCtxIfUnlocked = (audioCtx) => __awaiter(void 0, void 0, void 0, function* () {
    // suspend audio context for now
    // in apple webkit it's already suspended & calling suspend yet again will block
    switch (audioCtx.state) {
        case "running":
            yield audioCtx.suspend();
            return true;
        case "suspended":
            console.warn(`audio context for sampleRate=${audioCtx.sampleRate} is suspended/locked,`
                + ` which can only be resumed/unlocked by UI event.`);
            return false;
        default:
            throw new Error(`audio context is neither running nor suspended`);
    }
});
// WebAudio-based loop player
export class HCAWebAudioLoopPlayer {
    get unlocked() {
        return this._unlocked;
    }
    get volume() {
        return this.gainNode.gain.value;
    }
    set volume(val) {
        if (isNaN(val))
            return;
        if (val > 1.0)
            val = 1.0;
        if (val < 0)
            val = 0;
        this.gainNode.gain.value = val;
    }
    constructor(info, bufSrc, audioCtx, unlocked, gainNode, volume) {
        this.started = false;
        this.closed = false;
        this.info = info;
        this.bufSrc = bufSrc;
        this.audioCtx = audioCtx;
        this._unlocked = unlocked;
        this.gainNode = gainNode;
        this.volume = volume;
    }
    static create(decrypted, worker, volume = 100) {
        return __awaiter(this, void 0, void 0, function* () {
            const info = new HCAInfo(decrypted);
            if (info.cipher != 0)
                throw new Error("only decrypted hca is accepted");
            const audioCtx = new AudioContext({
                sampleRate: info.format.samplingRate,
            });
            const wav = yield worker.decode(decrypted, 16); // first
            const unlocked = yield suspendAudioCtxIfUnlocked(audioCtx);
            const buffer = yield audioCtx.decodeAudioData(wav.buffer);
            const bufSrc = audioCtx.createBufferSource();
            bufSrc.buffer = buffer;
            if (info.loop != null && info.loop.end > info.loop.start) {
                bufSrc.loopStart = info.loopStartTime;
                bufSrc.loopEnd = info.loopEndTime;
                bufSrc.loop = true;
            }
            const gainNode = audioCtx.createGain();
            bufSrc.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            return new HCAWebAudioLoopPlayer(info, bufSrc, audioCtx, unlocked, gainNode, volume);
        });
    }
    play() {
        this.audioCtx.resume();
        if (!this.started) {
            this.bufSrc.start();
            this.started = true;
        }
        // mark as unlocked
        if (!this._unlocked) {
            this._unlocked = true;
            console.warn(`audio context for sampleRate=${this.audioCtx.sampleRate} is now resumed/unlocked`);
        }
    }
    pause() {
        if (this.audioCtx.state !== "running")
            return;
        this.audioCtx.suspend();
    }
    stop() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this._unlocked)
                throw new Error("audio context is not unlocked, cannot stop and destroy");
            if (this.closed)
                return;
            this.bufSrc.disconnect();
            yield this.audioCtx.close();
            this.closed = true;
        });
    }
}
// convert non-transferable typed array to transferable array buffer
class HCATransTypedArray {
    static convert(arg, transferList) {
        if (this.getType(arg) != null)
            return new HCATransTypedArray(arg, transferList);
        else
            return arg;
    }
    static restore(arg) {
        const type = this.getType(arg);
        if (type != null && type.converted)
            return arg.array;
        else
            return arg;
    }
    static getType(arg) {
        if (arg == null || typeof arg !== "object")
            return undefined;
        else if (arg instanceof Int8Array)
            return { converted: false, type: "Int8" };
        else if (arg instanceof Int16Array)
            return { converted: false, type: "Int16" };
        else if (arg instanceof Int32Array)
            return { converted: false, type: "Int32" };
        else if (arg instanceof Uint8Array)
            return { converted: false, type: "Uint8" };
        else if (arg instanceof Uint16Array)
            return { converted: false, type: "Uint16" };
        else if (arg instanceof Uint32Array)
            return { converted: false, type: "Uint32" };
        else if (arg instanceof Float32Array)
            return { converted: false, type: "Float32" };
        else if (arg instanceof Float64Array)
            return { converted: false, type: "Float64" };
        else if (arg.buffer instanceof ArrayBuffer && typeof arg.type === "string")
            return { converted: true, type: arg.type };
        else
            return undefined;
    }
    constructor(ta, transferList) {
        const type = HCATransTypedArray.getType(ta);
        if (type != null)
            this.type = type.type;
        else
            throw new Error("unexpected type");
        this.buffer = ta.buffer;
        this.byteOffset = ta.byteOffset;
        this.length = ta.length;
        if (!transferList.find((val) => val === this.buffer))
            transferList.push(this.buffer);
    }
    get array() {
        switch (this.type) {
            case "Int8": return new Int8Array(this.buffer, this.byteOffset, this.length);
            case "Int16": return new Int16Array(this.buffer, this.byteOffset, this.length);
            case "Int32": return new Int32Array(this.buffer, this.byteOffset, this.length);
            case "Uint8": return new Uint8Array(this.buffer, this.byteOffset, this.length);
            case "Uint16": return new Uint16Array(this.buffer, this.byteOffset, this.length);
            case "Uint32": return new Uint32Array(this.buffer, this.byteOffset, this.length);
            case "Float32": return new Float32Array(this.buffer, this.byteOffset, this.length);
            case "Float64": return new Float64Array(this.buffer, this.byteOffset, this.length);
        }
        throw new Error("unexpected type");
    }
}
class HCATask {
    get args() {
        var _c;
        return (_c = this._args) === null || _c === void 0 ? void 0 : _c.map((arg) => HCATransTypedArray.restore(arg));
    }
    get hasResult() {
        return this._hasResult;
    }
    get result() {
        if (!this._hasResult)
            throw new Error("no result");
        return HCATransTypedArray.restore(this._result);
    }
    set result(result) {
        if (this.hasErr)
            throw new Error("already has error, cannot set result");
        if (this._hasResult)
            throw new Error("cannot set result again");
        this._result = HCATransTypedArray.convert(result, this.transferList);
        this._hasResult = true;
        if (!this._replyArgs)
            delete this._args;
    }
    get hasErr() {
        return this._errMsg != null;
    }
    get errMsg() {
        return this._errMsg;
    }
    set errMsg(msg) {
        // changing errMsg is allowed, but clearing errMsg is disallowed
        if (typeof msg !== "string")
            throw new Error("error message must be a string");
        delete this._args;
        if (this._hasResult) {
            // clear result on error
            delete this._result;
            this._hasResult = false;
            this.transferList = [];
            this.args.forEach((arg) => HCATransTypedArray.convert(arg, this.transferList));
        }
        this._errMsg = msg;
    }
    constructor(origin, taskID, cmd, args, replyArgs, isDummy) {
        this.transferList = [];
        this._hasResult = false;
        this.origin = origin;
        this.taskID = taskID;
        this.cmd = cmd;
        this._args = args === null || args === void 0 ? void 0 : args.map((arg) => HCATransTypedArray.convert(arg, this.transferList));
        this._replyArgs = replyArgs;
        if (isDummy != null && isDummy)
            this.isDummy = true;
    }
    static recreate(task) {
        const recreated = new HCATask(task.origin, task.taskID, task.cmd, task._args, task._replyArgs);
        if (task._errMsg != null)
            recreated.errMsg = task._errMsg;
        else if (task._hasResult)
            recreated.result = task._result;
        return recreated;
    }
}
class HCATaskQueue {
    getNextTaskID() {
        const max = HCATaskQueue.maxTaskID - 1;
        if (this._lastTaskID < 0 || this._lastTaskID > max)
            throw new Error("lastTaskID out of range");
        const start = this._lastTaskID + 1;
        for (let i = start; i <= start + max; i++) {
            const taskID = i % (max + 1);
            if (this.callbacks[taskID] == null)
                return this._lastTaskID = taskID;
        }
        throw new Error("cannot find next taskID");
    }
    sendTask(task) {
        if (task.origin !== this.origin)
            throw new Error("the task to be sent must have the same origin as the task queue");
        this.postMessage(task, this.transferArgs ? task.transferList : []);
    }
    sendReply(task) {
        if (task.origin === this.origin)
            throw new Error("the reply to be sent must not have the same origin as the task queue");
        this.postMessage(task, task.transferList); // always use transferring to send back arguments
    }
    sendNextTask() {
        return __awaiter(this, void 0, void 0, function* () {
            let task = this.queue.shift();
            if (task == null) {
                this.isIdle = true;
            }
            else {
                this.isIdle = false;
                // apply hook first
                const registered = this.callbacks[task.taskID];
                const taskHook = registered != null && registered.hook != null && registered.hook.task != null
                    ? registered.hook.task
                    : undefined;
                if (taskHook != null)
                    try {
                        task = yield taskHook(task);
                    }
                    catch (e) {
                        task.errMsg = `[${this.origin}] error when applying hook `
                            + `before executing cmd ${task.cmd} from ${task.origin}`;
                        if (typeof e === "string" || e instanceof Error)
                            task.errMsg += "\n" + e.toString();
                        task.isDummy = true;
                    }
                // send task
                if (task.isDummy) {
                    if (!task.hasErr && !task.hasResult)
                        task.result = null;
                    const ev = new MessageEvent("message", { data: task }); // not actually sending, use a fake reply
                    this.msgHandler(ev); // won't await
                }
                else {
                    this.sendTask(task);
                }
            }
        });
    }
    constructor(origin, postMessage, taskHandler, destroy) {
        this._isAlive = true;
        this.isIdle = true;
        // comparing to structured copy (by default), if data size is big (because of zero-copy),
        // transferring is generally much faster. however it obviously has a drawback,
        // that transferred arguments are no longer accessible in the sender thread
        this.transferArgs = false;
        // the receiver/callee will always use transferring to send back arguments,
        // not sending the arguments back is supposed to save a little time/overhead
        this.replyArgs = false;
        this.queue = [];
        this._lastTaskID = 0;
        this.callbacks = {};
        this.origin = origin;
        this.postMessage = postMessage;
        this.taskHandler = taskHandler;
        this.destroy = destroy;
    }
    get isAlive() {
        return this._isAlive;
    }
    // these following two methods/functions are supposed to be callbacks
    msgHandler(ev) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const task = HCATask.recreate(ev.data);
                if (task.origin !== this.origin) {
                    // incoming cmd to execute
                    try {
                        task.result = yield this.taskHandler(task);
                    }
                    catch (e) {
                        // it's observed that Firefox refuses to postMessage an Error object:
                        // "DataCloneError: The object could not be cloned."
                        // (observed in Firefox 97, not clear about other versions)
                        // Chrome doesn't seem to have this problem,
                        // however, in order to keep compatible with Firefox,
                        // we still have to avoid posting an Error object
                        task.errMsg = `[${this.origin}] error when executing cmd ${task.cmd} from ${task.origin}`;
                        if (typeof e === "string" || e instanceof Error)
                            task.errMsg += "\n" + e.toString();
                    }
                    if (task.taskID != HCATaskQueue.discardReplyTaskID)
                        try {
                            this.sendReply(task);
                        }
                        catch (e) {
                            console.error(`[${this.origin}] sendReply failed.`, e);
                            task.errMsg = (task.errMsg == null ? "" : task.errMsg + "\n\n") + "postMessage from Worker failed";
                            if (typeof e === "string" || e instanceof Error)
                                task.errMsg += "\n" + e.toString();
                            // try again
                            this.sendReply(task); // if it throws, just let it throw
                        }
                }
                else {
                    // receiving cmd result
                    // find & unregister callback
                    const registered = this.callbacks[task.taskID];
                    delete this.callbacks[task.taskID];
                    // apply hook
                    let result = task.hasResult ? task.result : undefined;
                    const hook = registered.hook;
                    if (hook != null)
                        try {
                            if (task.hasErr && hook.error != null)
                                yield hook.error(task.errMsg);
                            else if (task.hasResult && hook.result != null)
                                result = yield hook.result(task.result);
                        }
                        catch (e) {
                            if (!task.hasErr)
                                task.errMsg = "";
                            task.errMsg += `[${this.origin}] error when applying hook `
                                + `after executing cmd ${task.cmd} from ${task.origin}`;
                            if (typeof e === "string" || e instanceof Error)
                                task.errMsg += "\n" + e.toString();
                        }
                    // settle promise
                    if (task.hasErr) {
                        registered.reject(task.errMsg);
                    }
                    else if (task.hasResult) {
                        registered.resolve(result);
                    }
                    else
                        throw new Error(`task (origin=${task.origin} taskID=${task.taskID} cmd=${task.cmd}) `
                            + `has neither error nor result`); // should never happen
                    // start next task
                    yield this.sendNextTask();
                }
            }
            catch (e) {
                // irrecoverable error
                yield this.errHandler(e);
            }
        });
    }
    errHandler(data) {
        return __awaiter(this, void 0, void 0, function* () {
            // irrecoverable error
            if (this._isAlive) {
                // print error message
                console.error(`[${this.origin}] destroying background worker on irrecoverable error`, data);
                // destroy background worker
                try {
                    yield this.destroy();
                }
                catch (e) {
                    console.error(`[${this.origin}] error when trying to destroy()`, e);
                }
                // after destroy, mark isAlive as false (otherwise sendCmd will fail)
                this._isAlive = false;
                // reject all pending promises
                for (let taskID in this.callbacks) {
                    const reject = this.callbacks[taskID].reject;
                    delete this.callbacks[taskID];
                    try {
                        reject();
                    }
                    catch (e) {
                        console.error(`[${this.origin}] error rejecting taskID=${taskID}`, e);
                    }
                }
            }
        });
    }
    getTransferConfig() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this._isAlive)
                throw new Error("dead");
            return yield this.execCmd("nop", [], {
                result: () => ({
                    transferArgs: this.transferArgs,
                    replyArgs: this.replyArgs
                })
            });
        });
    }
    configTransfer(transferArgs, replyArgs) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this._isAlive)
                throw new Error("dead");
            return yield this.execCmd("nop", [], {
                result: () => {
                    this.transferArgs = transferArgs ? true : false;
                    this.replyArgs = replyArgs ? true : false;
                }
            });
        });
    }
    execCmd(cmd, args, hook) {
        return __awaiter(this, void 0, void 0, function* () {
            // can be modified to simply wrap execMultiCmd but I just want to let it alone for no special reason
            if (!this._isAlive)
                throw new Error("dead");
            // assign new taskID
            const taskID = this.getNextTaskID();
            const task = new HCATask(this.origin, taskID, cmd, args, this.replyArgs);
            // register callback
            if (this.callbacks[taskID] != null)
                throw new Error(`taskID=${taskID} is already occupied`);
            const resultPromise = new Promise((resolve, reject) => this.callbacks[taskID] = {
                resolve: resolve, reject: reject,
                hook: hook
            });
            // append to command queue
            this.queue.push(task);
            // start executing tasks
            if (this.isIdle)
                yield this.sendNextTask();
            // return result
            return yield resultPromise;
        });
    }
    execMultiCmd(cmdList) {
        return __awaiter(this, void 0, void 0, function* () {
            // the point is to ensure "atomicity" between cmds
            if (!this._isAlive)
                throw new Error("dead");
            let resultPromises = [];
            for (let i = 0; i < cmdList.length; i++) {
                // assign new taskID
                const taskID = this.getNextTaskID();
                const listItem = cmdList[i];
                const task = new HCATask(this.origin, taskID, listItem.cmd, listItem.args, this.replyArgs);
                // register callback
                if (this.callbacks[taskID] != null)
                    throw new Error(`taskID=${taskID} is already occupied`);
                resultPromises.push(new Promise((resolve, reject) => this.callbacks[taskID] = {
                    resolve: resolve, reject: reject,
                    hook: listItem.hook
                }));
                // append to command queue
                this.queue.push(task);
            }
            // start executing tasks
            if (this.isIdle)
                yield this.sendNextTask();
            // return results
            return yield Promise.all(resultPromises);
        });
    }
    sendCmd(cmd, args) {
        // send cmd without registering callback
        // generally not recommended
        if (!this._isAlive)
            throw new Error("dead");
        const task = new HCATask(this.origin, HCATaskQueue.discardReplyTaskID, cmd, args, false);
        this.sendTask(task);
    }
    shutdown(forcibly = false) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this._isAlive) {
                if (forcibly) {
                    try {
                        yield this.destroy();
                    }
                    catch (e) {
                        console.error(`[${this.origin}] error when trying to forcibly shutdown.`, e);
                    }
                    this._isAlive = false;
                }
                else
                    yield this.execCmd("nop", [], {
                        result: () => __awaiter(this, void 0, void 0, function* () {
                            yield this.destroy();
                            this._isAlive = false;
                        })
                    });
            }
        });
    }
}
HCATaskQueue.maxTaskID = 256; // there's recursion in sendNextTask when making fake reply
HCATaskQueue.discardReplyTaskID = -1;
if (typeof document === "undefined") {
    if (typeof onmessage === "undefined") {
        // AudioWorklet
        class HCAFramePlayerContext {
            get isStalling() {
                return this._isStalling;
            }
            set isStalling(val) {
                this._isStalling = val;
                if (val)
                    this.onceStalled = true;
            }
            constructor(procOpts) {
                this.isPlaying = false;
                this.defaultPullBlockCount = 128;
                this.failedBlocks = [];
                this.printErrorCountDownFrom = 256;
                this.printErrorCountDown = this.printErrorCountDownFrom;
                this.totalPulledBlockCount = 0;
                this.isPulling = false;
                this._isStalling = false;
                this.onceStalled = false;
                this.sampleOffset = 0;
                this.lastDecodedBlockIndex = -1;
                this.frame = new HCAFrame(new HCAInfo(procOpts.rawHeader));
                const info = this.frame.Hca;
                const hasLoop = info.hasHeader["loop"] ? true : false;
                if (typeof procOpts.pullBlockCount === "number") {
                    if (isNaN(procOpts.pullBlockCount))
                        throw new Error();
                    let pullBlockCount = Math.floor(procOpts.pullBlockCount);
                    if (pullBlockCount < 2)
                        throw new Error();
                    this.pullBlockCount = pullBlockCount;
                }
                else
                    this.pullBlockCount = this.defaultPullBlockCount;
                const bufferedBlockCount = hasLoop ? (info.loop.end + 1) : this.pullBlockCount * 2;
                this.encoded = new Uint8Array(info.blockSize * bufferedBlockCount);
                this.decoded = Array.from({ length: info.format.channelCount }, () => new Float32Array(HCAFrame.SamplesPerFrame * 2));
            }
        }
        class HCAFramePlayer extends AudioWorkletProcessor {
            constructor(options) {
                super();
                this.unsettled = [];
                this.waitCountDownFrom = 32;
                if (options == null || options.processorOptions == null)
                    throw new Error();
                this.ctx = new HCAFramePlayerContext(options.processorOptions);
                this.taskQueue = new HCATaskQueue("Background-HCAFramePlayer", (msg, trans) => this.port.postMessage(msg, trans), (task) => __awaiter(this, void 0, void 0, function* () {
                    switch (task.cmd) {
                        case "nop":
                            return;
                        case "initialize":
                            this.ctx = new HCAFramePlayerContext(task.args[0]);
                            break;
                        case "reset":
                            yield new Promise((resolve) => {
                                delete this.ctx;
                                this.unsettled.push({ resolve: resolve, counter: this.waitCountDownFrom });
                            });
                            break;
                        case "pause":
                        case "resume":
                            if (this.ctx == null)
                                throw new Error(`not initialized`);
                            this.ctx.isPlaying = task.cmd === "resume";
                            if (!this.ctx.isPlaying)
                                yield new Promise((resolve) => {
                                    this.unsettled.push({ resolve: resolve, counter: this.waitCountDownFrom });
                                });
                            break;
                        default:
                            throw new Error(`unknown cmd ${task.cmd}`);
                    }
                }), () => { this.taskQueue.sendCmd("self-destruct", []); });
                this.taskQueue.configTransfer(true, false);
                this.port.onmessage = (ev) => this.taskQueue.msgHandler(ev);
            }
            handleNewBlocks(ctx, newBlocks) {
                const info = ctx.frame.Hca;
                const hasLoop = info.hasHeader["loop"] ? true : false;
                const pullBlockCount = ctx.pullBlockCount;
                const encoded = ctx.encoded;
                if (newBlocks.length % info.blockSize != 0) {
                    throw new Error(`newBlocks.length=${newBlocks.length} should be multiple of blockSize`);
                }
                const newBlockCount = newBlocks.length / info.blockSize;
                const expected = info.blockSize * pullBlockCount;
                if (hasLoop) {
                    let encodedOffset = info.blockSize * ctx.totalPulledBlockCount;
                    if (encodedOffset + newBlocks.length > encoded.length) {
                        throw new Error(`has loop header, buffer will overflow`);
                    }
                    encoded.set(newBlocks, encodedOffset);
                }
                else {
                    if (newBlocks.length != expected) {
                        throw new Error(`no loop header, newBlocks.length (${newBlocks.length}) != expected (${expected})`);
                    }
                    switch (ctx.totalPulledBlockCount % (pullBlockCount * 2)) {
                        case 0:
                            encoded.set(newBlocks);
                            break;
                        case pullBlockCount:
                            encoded.set(newBlocks, expected);
                            break;
                        default:
                            throw new Error();
                    }
                }
                ctx.totalPulledBlockCount += newBlockCount;
                ctx.isPulling = false;
            }
            pullNewBlocks(ctx) {
                // if ctx passed in had been actually deleted, it won't affect the current using ctx
                if (ctx.isPulling)
                    return; // already pulling. will be called again if still not enough
                ctx.isPulling = true;
                // request to pull & continue decoding
                this.taskQueue.execCmd("pull", [], {
                    result: (newBlocks) => this.handleNewBlocks(ctx, newBlocks),
                    error: () => { ctx.isPulling = false; },
                })
                    .catch((e) => {
                    console.warn(`pullNewBlocks failed.`, e);
                });
            }
            writeToDecodedBuffer(frame, decoded) {
                const halfSize = HCAFrame.SamplesPerFrame;
                for (let c = 0; c < frame.Channels.length; c++) {
                    const firstHalf = decoded[c].subarray(0, halfSize);
                    const lastHalf = decoded[c].subarray(halfSize, halfSize * 2);
                    firstHalf.set(lastHalf);
                    for (let sf = 0, offset = 0; sf < HCAFrame.SubframesPerFrame; sf++) {
                        lastHalf.set(frame.Channels[c].PcmFloat[sf], offset);
                        offset += HCAFrame.SamplesPerSubFrame;
                    }
                    for (let i = 0; i < lastHalf.length; i++) {
                        if (lastHalf[i] > 1)
                            lastHalf[i] = 1;
                        else if (lastHalf[i] < -1)
                            lastHalf[i] = -1;
                    }
                }
            }
            mapToUnLooped(info, sampleOffset) {
                const hasLoop = info.hasHeader["loop"] ? true : false;
                if (sampleOffset <= info.endAtSample) {
                    return sampleOffset;
                }
                else {
                    if (hasLoop) {
                        let offset = (sampleOffset - info.loopStartAtSample) % info.loopSampleCount;
                        return info.loopStartAtSample + offset;
                    }
                    else {
                        return info.endAtSample;
                    }
                }
            }
            process(inputs, outputs, parameters) {
                if (this.ctx == null || !this.ctx.isPlaying) {
                    // workaround the "residue" burst noise issue in Chrome
                    const unsettled = this.unsettled.shift();
                    if (unsettled != null) {
                        if (--unsettled.counter > 0)
                            this.unsettled.unshift(unsettled);
                        else
                            try {
                                unsettled.resolve();
                            }
                            catch (e) {
                                console.error(`error when settling promise of "reset" or "setPlaying" cmd`);
                            }
                    }
                    return true; // wait for new source or resume
                }
                if (this.ctx.failedBlocks.length > 0) {
                    if (this.ctx.failedBlocks.length >= 64 || --this.ctx.printErrorCountDown <= 0) {
                        console.error(`error decoding following blocks`, this.ctx.failedBlocks, this.ctx.lastError);
                        this.ctx.failedBlocks = [];
                        this.ctx.lastError = undefined;
                        this.ctx.printErrorCountDown = this.ctx.printErrorCountDownFrom;
                    }
                }
                const output = outputs[0];
                const renderQuantumSize = output[0].length;
                const samplesPerBlock = HCAFrame.SamplesPerFrame;
                // no more than one block will be decoded each time this function being called,
                // therefore one block must cover the whole renderQuantumSize
                if (samplesPerBlock < renderQuantumSize)
                    throw new Error("render quantum requires more sample than a full block");
                const info = this.ctx.frame.Hca;
                const hasLoop = info.hasHeader["loop"] ? true : false;
                const encoded = this.ctx.encoded;
                const decoded = this.ctx.decoded;
                // skip droppedHeader
                if (this.ctx.sampleOffset < info.format.droppedHeader) {
                    this.ctx.sampleOffset = info.format.droppedHeader;
                }
                if (this.ctx.sampleOffset >= info.endAtSample) {
                    if (hasLoop) {
                        // rewind back if beyond loop end
                        this.ctx.sampleOffset = this.mapToUnLooped(info, this.ctx.sampleOffset);
                    }
                    else {
                        // nothing more to play
                        this.taskQueue.sendCmd("end", []); // not waiting for result
                        delete this.ctx; // avoid sending "end" cmd for more than one time
                        return true;
                    }
                }
                // decode block & pull new block (if needed)
                const mappedStartOffset = this.mapToUnLooped(info, this.ctx.sampleOffset);
                const mappedEndOffset = this.mapToUnLooped(info, this.ctx.sampleOffset + renderQuantumSize);
                const inBlockStartOffset = mappedStartOffset % samplesPerBlock;
                const inBlockEndOffset = mappedEndOffset % samplesPerBlock;
                const startBlockIndex = (mappedStartOffset - inBlockStartOffset) / samplesPerBlock;
                const endBlockIndex = (mappedEndOffset - inBlockEndOffset) / samplesPerBlock;
                if (endBlockIndex != this.ctx.lastDecodedBlockIndex) {
                    if (endBlockIndex < this.ctx.totalPulledBlockCount) {
                        // block is available for decoding
                        this.ctx.isStalling = false;
                        let start = info.blockSize * (hasLoop
                            ? endBlockIndex
                            : endBlockIndex % (this.ctx.pullBlockCount * 2));
                        let end = start + info.blockSize;
                        if (end > encoded.length)
                            throw new Error("block end offset exceeds buffer size");
                        try {
                            HCA.decodeBlock(this.ctx.frame, encoded.subarray(start, end));
                        }
                        catch (e) {
                            this.ctx.failedBlocks.push(endBlockIndex);
                            this.ctx.lastError = e;
                            this.ctx.frame.Channels.forEach((c) => { c.PcmFloat.forEach((sf) => sf.fill(0)); });
                        }
                        this.writeToDecodedBuffer(this.ctx.frame, this.ctx.decoded);
                        this.ctx.lastDecodedBlockIndex = endBlockIndex;
                        if (this.ctx.totalPulledBlockCount < (hasLoop ? info.loop.end : info.format.blockCount)) {
                            // pull blocks in advance
                            let availableBlockCount = hasLoop && this.ctx.totalPulledBlockCount >= info.loop.end + 1
                                ? "all_pulled"
                                : this.ctx.totalPulledBlockCount - (this.ctx.lastDecodedBlockIndex + 1);
                            if (typeof availableBlockCount === 'number' && availableBlockCount < this.ctx.pullBlockCount) {
                                this.pullNewBlocks(this.ctx);
                            }
                        }
                    }
                    else {
                        // block is unavailable
                        if (!this.ctx.isStalling && this.ctx.onceStalled) {
                            // print error about stalling
                            console.warn(`[HCAFramePlayer] waiting until block ${endBlockIndex} become available...`);
                        }
                        this.ctx.isStalling = true;
                        this.pullNewBlocks(this.ctx);
                        return true;
                    }
                }
                // copy decoded data
                if (output.length != info.format.channelCount)
                    throw new Error("channel count mismatch");
                const inBufferStartOffset = (endBlockIndex != startBlockIndex ? 0 : samplesPerBlock) + inBlockStartOffset;
                const inBufferEndOffset = samplesPerBlock + inBlockEndOffset;
                const inBufferSrcSize = inBufferEndOffset - inBufferStartOffset;
                if (inBufferSrcSize <= 0)
                    throw new Error("size in decoded buffer should be positive");
                const copySize = Math.min(inBufferSrcSize, renderQuantumSize);
                for (let channel = 0; channel < output.length; channel++) {
                    let src = decoded[channel].subarray(inBufferStartOffset, inBufferStartOffset + copySize);
                    output[channel].set(src);
                }
                this.ctx.sampleOffset += copySize;
                return true;
            }
        }
        registerProcessor("hca-frame-player", HCAFramePlayer);
    }
    else {
        // Web Worker
        const taskQueue = new HCATaskQueue("Background-HCAWorker", (msg, trans) => postMessage(msg, trans), (task) => {
            switch (task.cmd) {
                case "nop":
                    return;
                case "fixHeaderChecksum":
                    return HCAInfo.fixHeaderChecksum.apply(HCAInfo, task.args);
                case "fixChecksum":
                    return HCA.fixChecksum.apply(HCA, task.args);
                case "decrypt":
                    return HCA.decrypt.apply(HCA, task.args);
                case "encrypt":
                    return HCA.encrypt.apply(HCA, task.args);
                case "addCipherHeader":
                    return HCAInfo.addCipherHeader.apply(HCAInfo, task.args);
                case "decode":
                    return HCA.decode.apply(HCA, task.args);
                default:
                    throw new Error(`unknown cmd ${task.cmd}`);
            }
        }, () => { taskQueue.sendCmd("self-destruct", []); });
        onmessage = (ev) => taskQueue.msgHandler(ev);
    }
}
// create & control audio worklet
class HCAAudioWorkletHCAPlayer {
    get isAlive() {
        return this.taskQueue.isAlive;
    }
    get initialized() {
        return this._initialized;
    }
    get unlocked() {
        return this._unlocked;
    }
    get blockChecksumVerification() {
        return this.verifyCsum;
    }
    set blockChecksumVerification(val) {
        if (typeof val !== "boolean")
            throw new Error();
        this.verifyCsum = val;
    }
    get feedSize() {
        return this.info.blockSize * this.feedBlockCount;
    }
    get remainingBlockCount() {
        let total = this.hasLoop ? this.info.loop.end + 1 : this.info.format.blockCount;
        let remaining = total - this.totalFedBlockCount;
        if (remaining <= 0)
            throw new Error();
        return remaining;
    }
    get downloadBufferSize() {
        const bytesPerSec = this.info.kbps * 1000 / 8;
        return bytesPerSec * 4;
    }
    taskHandler(task) {
        return __awaiter(this, void 0, void 0, function* () {
            switch (task.cmd) {
                case "nop":
                    return;
                case "self-destruct": // doesn't seem to have a chance to be called
                    console.error(`HCAFramePlayer requested to self-destruct`);
                    yield this.taskQueue.shutdown(true);
                    return;
                case "end":
                    yield this.stop();
                    return; // actually not sending back reply
                case "pull":
                    if (this.source == null)
                        throw new Error(`nothing to feed`); // should never happen
                    let blockCount = Math.min(this.feedBlockCount, this.remainingBlockCount);
                    let size = this.info.blockSize * blockCount;
                    let newBlocks;
                    if (this.source instanceof Uint8Array) {
                        // whole HCA mode
                        let start = this.info.dataOffset + this.info.blockSize * this.totalFedBlockCount;
                        let end = start + size;
                        newBlocks = this.source.subarray(start, end);
                        //} else if (this.source instanceof ReadableStreamDefaultReader) {
                        // commented out because Firefox throws "ReferenceError: ReadableStreamDefaultReader is not defined"
                    }
                    else {
                        // URL mode
                        if (this.srcBuf == null)
                            throw new Error("srcBuf is undefined");
                        let maxDownlaodSize = this.info.blockSize * this.remainingBlockCount;
                        let downloadSize = Math.max(this.downloadBufferSize, size);
                        downloadSize = Math.min(downloadSize, maxDownlaodSize);
                        let remaining = downloadSize - this.srcBuf.length;
                        if (remaining > 0) {
                            // FIXME connection loss is not handled/recovered
                            this.srcBuf = yield HCAAudioWorkletHCAPlayer.readAndAppend(this.source, this.srcBuf, remaining);
                        }
                        if (this.srcBuf.length < size)
                            throw new Error("srcBuf still smaller than expected");
                        newBlocks = this.srcBuf.subarray(0, size);
                        this.srcBuf = this.srcBuf.slice(size);
                    }
                    for (let i = 0, start = 0; i < blockCount; i++, start += this.info.blockSize) {
                        let block = newBlocks.subarray(start, start + this.info.blockSize);
                        // verify checksum (if enabled)
                        // will throw & stop playing on mismatch!
                        if (this.verifyCsum)
                            HCACrc16.verify(block, this.info.blockSize - 2);
                        // decrypt (if encrypted)
                        if (this.cipher != null)
                            this.cipher.mask(block, 0, this.info.blockSize - 2);
                        // fix checksum
                        HCACrc16.fix(block, this.info.blockSize - 2);
                    }
                    if (this.hasLoop) {
                        // just copy, no need to enlarge
                        newBlocks = newBlocks.slice();
                    }
                    else {
                        // enlarge & copy
                        let data = newBlocks;
                        newBlocks = new Uint8Array(this.feedSize);
                        newBlocks.set(data);
                    }
                    this.totalFedBlockCount += blockCount;
                    return newBlocks;
                default:
                    throw new Error(`unknown cmd "${task.cmd}"`);
            }
        });
    }
    static create(selfUrl, source, key1, key2) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!(selfUrl instanceof URL))
                throw new Error();
            if (!(source instanceof Uint8Array || source instanceof URL))
                throw new Error();
            let actualSource;
            let info;
            let srcBuf = undefined;
            if (source instanceof Uint8Array) {
                actualSource = source.slice(0);
                info = new HCAInfo(actualSource);
            }
            else if (source instanceof URL) {
                const fetched = yield this.getHCAInfoFromURL(source);
                actualSource = fetched.reader;
                info = fetched.info;
                srcBuf = fetched.buffer;
            }
            else
                throw Error();
            let feedByteMax = Math.floor(this.feedByteMax);
            if (feedByteMax < info.blockSize)
                throw new Error();
            feedByteMax -= feedByteMax % info.blockSize;
            const feedBlockCount = feedByteMax / info.blockSize;
            // initialize cipher
            const cipher = this.getCipher(info, key1, key2);
            // create audio context
            const audioCtx = new AudioContext({
                //latencyHint: "playback", // FIXME "playback" seems to glitch if switched to background in Android
                sampleRate: info.format.samplingRate,
            });
            // create audio worklet node (not yet connected)
            yield audioCtx.audioWorklet.addModule(selfUrl);
            const options = {
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [info.format.channelCount],
                processorOptions: {
                    rawHeader: info.getRawHeader(),
                    pullBlockCount: feedBlockCount,
                },
            };
            const hcaPlayerNode = new AudioWorkletNode(audioCtx, "hca-frame-player", options);
            // create gain node
            const gainNode = audioCtx.createGain();
            const unlocked = yield suspendAudioCtxIfUnlocked(audioCtx);
            // create controller object
            return new HCAAudioWorkletHCAPlayer(selfUrl, audioCtx, unlocked, hcaPlayerNode, gainNode, feedBlockCount, info, actualSource, srcBuf, cipher);
        });
    }
    _terminate() {
        return __awaiter(this, void 0, void 0, function* () {
            // I didn't find terminate() for AudioWorklet so I made one
            try {
                this.hcaPlayerNode.port.close();
            }
            catch (e) {
                console.error(`error trying to close message port`, e);
            }
            try {
                this.hcaPlayerNode.disconnect();
            }
            catch (e) {
                console.error(`error trying to disconnect hcaPlayerNode`, e);
            }
            try {
                this.gainNode.disconnect();
            }
            catch (e) {
                console.error(`error trying to disconnect gainNode`, e);
            }
            try {
                yield this.audioCtx.close();
            }
            catch (e) {
                console.error(`error trying to close audio context`, e);
            }
        });
    }
    constructor(selfUrl, audioCtx, unlocked, hcaPlayerNode, gainNode, feedBlockCount, info, source, srcBuf, cipher) {
        this._initialized = true; // initially there must be something to play
        this.isPlaying = false;
        this.verifyCsum = false;
        this.totalFedBlockCount = 0;
        this.stopCmdItem = {
            // exec "reset" cmd first, in order to avoid "residue" burst noise to be played in the future (observed in Chrome)
            cmd: "reset", args: [], hook: {
                task: (task) => __awaiter(this, void 0, void 0, function* () {
                    if (!this.isAlive)
                        throw new Error("dead");
                    if (!this.isPlaying)
                        yield this._resume();
                    return task;
                }),
                result: () => __awaiter(this, void 0, void 0, function* () {
                    yield this._suspend(); // can now suspend
                    this._initialized = false; // now we have nothing to play until next setSource
                    if (this.source != null && !(this.source instanceof Uint8Array)) {
                        yield this.source.cancel();
                        delete this.source;
                    }
                }),
            }
        };
        this.selfUrl = selfUrl;
        this.audioCtx = audioCtx;
        this._unlocked = unlocked;
        this.taskQueue = new HCATaskQueue("Main-HCAAudioWorkletHCAPlayer", (msg, trans) => hcaPlayerNode.port.postMessage(msg, trans), (task) => this.taskHandler(task), () => __awaiter(this, void 0, void 0, function* () { return yield this._terminate(); }));
        hcaPlayerNode.port.onmessage = (ev) => this.taskQueue.msgHandler(ev);
        hcaPlayerNode.port.onmessageerror = (ev) => this.taskQueue.errHandler(ev);
        hcaPlayerNode.onprocessorerror = (ev) => this.taskQueue.errHandler(ev);
        this.hcaPlayerNode = hcaPlayerNode;
        this.gainNode = gainNode;
        this.feedBlockCount = feedBlockCount;
        this.info = info;
        this.source = source;
        this.cipher = cipher;
        this.srcBuf = srcBuf;
        this.sampleRate = info.format.samplingRate;
        this.channelCount = info.format.channelCount;
        this.hasLoop = info.hasHeader["loop"] ? true : false;
    }
    static getCipher(info, key1, key2) {
        switch (info.cipher) {
            case 0:
                // not encrypted
                return undefined;
            case 1:
                // encrypted with "no key"
                return new HCACipher("none"); // ignore given keys
            case 0x38:
                // encrypted with keys - will yield incorrect waveform if incorrect keys are given!
                return new HCACipher(key1, key2);
            default:
                throw new Error("unknown ciph.type");
        }
    }
    static readAndAppend(reader, data, minCount) {
        return __awaiter(this, void 0, void 0, function* () {
            if (minCount < 0)
                throw new Error();
            const desired = data.length + minCount;
            let newData = new Uint8Array(desired);
            newData.set(data);
            for (let offset = data.length; offset < desired;) {
                const res = yield reader.read();
                if (res.done)
                    throw new Error(`unexpected stream end. `
                        + `it is possible that the download has been canceled (by later setSource), or the file data is incomplete`);
                const bytes = res.value;
                if (bytes.length > 0) {
                    const required = offset + bytes.length;
                    if (required > newData.length) {
                        const existing = newData;
                        newData = new Uint8Array(required);
                        newData.set(existing);
                    }
                    newData.set(bytes, offset);
                    offset += bytes.length;
                }
            }
            return newData;
        });
    }
    static getHCAInfoFromURL(url) {
        return __awaiter(this, void 0, void 0, function* () {
            // FIXME send HTTP Range request to avoid blocking later requests (especially in Firefox)
            const resp = yield fetch(url.href);
            if (resp.status != 200)
                throw new Error(`status ${resp.status}`);
            if (resp.body == null)
                throw new Error("response has no body");
            const reader = resp.body.getReader();
            let buffer = yield this.readAndAppend(reader, new Uint8Array(0), 8);
            const dataOffset = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getUint16(6);
            const remaining = dataOffset - buffer.length;
            if (remaining > 0) {
                buffer = yield this.readAndAppend(reader, buffer, remaining);
            }
            return {
                reader: reader,
                info: new HCAInfo(buffer),
                buffer: buffer.slice(dataOffset),
            };
        });
    }
    setSource(source, key1, key2) {
        return __awaiter(this, void 0, void 0, function* () {
            let newInfo;
            let newSource;
            let newBuffer = undefined;
            const initializeCmdItem = {
                cmd: "initialize", args: [null], hook: {
                    task: (task) => __awaiter(this, void 0, void 0, function* () {
                        if (!this.isAlive)
                            throw new Error("dead");
                        const oldSource = this.source;
                        //if (oldSource instanceof ReadableStreamDefaultReader) {
                        if (oldSource != null && !(oldSource instanceof Uint8Array)) {
                            try {
                                yield oldSource.cancel(); // stop downloading from previous URL
                                // FIXME Firefox doesn't seem to abort previous download
                            }
                            catch (e) {
                                console.error(`error when cancelling previous download.`, e);
                            }
                        }
                        if (source instanceof Uint8Array) {
                            newSource = source.slice(0);
                            newInfo = new HCAInfo(newSource);
                        }
                        else if (source instanceof URL) {
                            const result = yield HCAAudioWorkletHCAPlayer.getHCAInfoFromURL(source);
                            newSource = result.reader;
                            newInfo = result.info;
                            newBuffer = result.buffer;
                        }
                        else
                            throw new Error("invalid source");
                        // sample rate and channel count is immutable,
                        // therefore, the only way to change them is to recreate a new instance.
                        // however, there is a memleak bug in Chromium, that:
                        // (no-longer-used) audio worklet node(s) won't be recycled:
                        // https://bugs.chromium.org/p/chromium/issues/detail?id=1298955
                        if (newInfo.format.samplingRate != this.sampleRate)
                            throw new Error("sample rate mismatch");
                        if (newInfo.format.channelCount != this.channelCount)
                            throw new Error("channel count mismatch");
                        yield this._resume(); // resume it, so that cmd can then be executed
                        const newProcOpts = {
                            rawHeader: newInfo.getRawHeader(),
                            pullBlockCount: this.feedBlockCount,
                        };
                        return new HCATask(task.origin, task.taskID, task.cmd, [newProcOpts], false);
                    }), result: () => __awaiter(this, void 0, void 0, function* () {
                        yield this._suspend(); // initialized, but it's paused, until being requested to start/play (resume)
                        this.totalFedBlockCount = 0;
                        this.cipher = HCAAudioWorkletHCAPlayer.getCipher(newInfo, key1, key2);
                        this.info = newInfo;
                        this.source = newSource;
                        this.srcBuf = newBuffer;
                        this.hasLoop = newInfo.hasHeader["loop"] ? true : false;
                        this._initialized = true; // again we now have something to play
                    })
                }
            };
            yield this.taskQueue.execMultiCmd([this.stopCmdItem, initializeCmdItem]); // ensure atomicity
        });
    }
    // not supposed to be used directly
    _resume() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.isAlive)
                throw new Error("dead");
            if (this.isPlaying)
                return;
            yield this.audioCtx.resume();
            this.hcaPlayerNode.connect(this.gainNode);
            this.gainNode.connect(this.audioCtx.destination);
            this.isPlaying = true;
            // mark as unlocked
            if (!this._unlocked) {
                this._unlocked = true;
                console.warn(`audio context for sampleRate=${this.audioCtx.sampleRate} is now resumed/unlocked`);
            }
        });
    }
    _suspend() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.isAlive)
                throw new Error("dead");
            if (!this.isPlaying)
                return;
            this.hcaPlayerNode.disconnect();
            this.gainNode.disconnect();
            yield this.audioCtx.suspend();
            this.isPlaying = false;
        });
    }
    // wraped to ensure atomicity
    setPlaying(toPlay) {
        return __awaiter(this, void 0, void 0, function* () {
            // simlilar to stopCmdItem above, send "pause" cmd to avoid "residue" burst noise
            yield this.taskQueue.execCmd(toPlay ? "resume" : "pause", [], {
                task: (task) => __awaiter(this, void 0, void 0, function* () {
                    if (!this.isAlive)
                        throw new Error("dead");
                    if (this.isPlaying) {
                        if (toPlay)
                            task.isDummy = true; // already resumed, not sending cmd
                        // else should still keep playing until "pause" cmd returns
                    }
                    else {
                        if (toPlay) {
                            if (!this._initialized)
                                throw new Error(`not initialized but still attempt to resume`);
                            yield this._resume();
                        }
                        else
                            task.isDummy = true; // already paused, not sending cmd
                    }
                    return task;
                }),
                result: () => __awaiter(this, void 0, void 0, function* () {
                    if (toPlay)
                        yield this._resume();
                    else
                        yield this._suspend();
                })
            });
        });
    }
    pause() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.setPlaying(false);
        });
    }
    play() {
        return __awaiter(this, void 0, void 0, function* () {
            // in apple webkit, audio context is suspended/locked initially,
            // (other browsers like Firefox may have similar but less strict restrictions)
            // to resume/unlock it, first resume() call must be triggered by from UI event,
            // which must not be after await
            yield this.setPlaying(true);
        });
    }
    stop() {
        return __awaiter(this, void 0, void 0, function* () {
            // can unlock the locked audio context as well because it's resumed firstly before finally suspended
            const item = this.stopCmdItem;
            yield this.taskQueue.execCmd(item.cmd, item.args, item.hook);
        });
    }
    shutdown(forcibly = false) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.isAlive) {
                console.error(`already shutdown`);
                return;
            }
            yield this.taskQueue.shutdown(forcibly);
        });
    }
}
HCAAudioWorkletHCAPlayer.feedByteMax = 32768;
// create & control worker
export class HCAWorker {
    get isAlive() {
        return this.taskQueue.isAlive;
    }
    shutdown(forcibly = false) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.taskQueue.isAlive)
                yield this.taskQueue.shutdown(forcibly);
            if (this.awHcaPlayer != null && this.awHcaPlayer.isAlive)
                yield this.awHcaPlayer.shutdown(forcibly);
        });
    }
    tick() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.taskQueue.execCmd("nop", []);
            this.lastTick = new Date().getTime();
        });
    }
    tock(text = "") {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.taskQueue.execCmd("nop", []);
            const duration = new Date().getTime() - this.lastTick;
            console.log(`${text} took ${duration} ms`);
            return duration;
        });
    }
    static create(selfUrl) {
        return __awaiter(this, void 0, void 0, function* () {
            if (typeof selfUrl === "string")
                selfUrl = new URL(selfUrl, document.baseURI);
            else if (!(selfUrl instanceof URL))
                throw new Error("selfUrl must be either string or URL");
            // fetch & save hca.js as blob in advance, to avoid creating worker being blocked later, like:
            // (I observed this problem in Firefox)
            // creating HCAAudioWorkletHCAPlayer requires information from HCA, which is sample rate and channel count;
            // however, fetching HCA (originally supposed to be progressive/streamed) blocks later request to fetch hca.js,
            // so that HCAAudioWorkletHCAPlayer can only be created after finishing downloading the whole HCA,
            // which obviously defeats the purpose of streaming HCA
            const response = yield fetch(selfUrl.href);
            // Firefox currently does not support ECMAScript modules in Worker,
            // therefore we must strip all export declarations
            const origText = yield response.text();
            const convertedText = ("\n" + origText).replace(/((\n|;)[ \t]*)((export[ \t]+\{.*?\}[ \t]*;{0,1})+|(export[ \t]+))/g, "$1").slice(1);
            const blob = new Blob([convertedText], { type: "text/javascript" });
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            const dataURI = yield new Promise((res) => {
                reader.onloadend = function () {
                    res(reader.result);
                };
            });
            selfUrl = new URL(dataURI, document.baseURI);
            return new HCAWorker(selfUrl, blob);
        });
    }
    constructor(selfUrl, selfBlob) {
        this.lastTick = 0;
        try {
            this.hcaWorker = new Worker(selfUrl, { type: "module" }); // setting type to "module" is currently bogus in Firefox
        }
        catch (e) {
            // workaround for legacy iOS Safari
            if (selfBlob == null || !(selfBlob instanceof Blob))
                throw e;
            const objUrl = URL.createObjectURL(selfBlob);
            this.hcaWorker = new Worker(objUrl, { type: "module" });
            URL.revokeObjectURL(objUrl);
        }
        this.selfUrl = selfUrl;
        this.taskQueue = new HCATaskQueue("Main-HCAWorker", (msg, trans) => this.hcaWorker.postMessage(msg, trans), (task) => __awaiter(this, void 0, void 0, function* () {
            switch (task.cmd) {
                case "self-destruct": // doesn't seem to have a chance to be called
                    console.error(`hcaWorker requested to self-destruct`);
                    yield this.taskQueue.shutdown(true);
                    break;
            }
        }), () => this.hcaWorker.terminate());
        this.hcaWorker.onmessage = (msg) => this.taskQueue.msgHandler(msg);
        this.hcaWorker.onerror = (msg) => this.taskQueue.errHandler(msg);
        this.hcaWorker.onmessageerror = (msg) => this.taskQueue.errHandler(msg);
    }
    // commands
    getTransferConfig() {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.taskQueue.getTransferConfig();
        });
    }
    configTransfer(transferArgs, replyArgs) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.taskQueue.configTransfer(transferArgs, replyArgs);
        });
    }
    fixHeaderChecksum(hca) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.taskQueue.execCmd("fixHeaderChecksum", [hca]);
        });
    }
    fixChecksum(hca) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.taskQueue.execCmd("fixChecksum", [hca]);
        });
    }
    decrypt(hca, key1, key2) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.taskQueue.execCmd("decrypt", [hca, key1, key2]);
        });
    }
    encrypt(hca, key1, key2) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.taskQueue.execCmd("encrypt", [hca, key1, key2]);
        });
    }
    addHeader(hca, sig, newData) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.taskQueue.execCmd("addHeader", [hca, sig, newData]);
        });
    }
    addCipherHeader(hca, cipherType) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.taskQueue.execCmd("addCipherHeader", [hca, cipherType]);
        });
    }
    decode(hca, mode = 32, loop = 0, volume = 1.0) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.taskQueue.execCmd("decode", [hca, mode, loop, volume]);
        });
    }
    loadHCAForPlaying(hca, key1, key2) {
        return __awaiter(this, void 0, void 0, function* () {
            if (typeof hca === "string") {
                if (hca === "")
                    throw new Error("empty URL");
                hca = new URL(hca, document.baseURI);
            }
            else if (!(hca instanceof URL) && !(hca instanceof Uint8Array))
                throw new Error("hca must be either URL or Uint8Array");
            if (this.awHcaPlayer == null) {
                this.awHcaPlayer = yield HCAAudioWorkletHCAPlayer.create(this.selfUrl, hca, key1, key2);
            }
            else {
                yield this.awHcaPlayer.setSource(hca, key1, key2);
            }
        });
    }
    pausePlaying() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.awHcaPlayer == null)
                throw new Error();
            yield this.awHcaPlayer.pause();
        });
    }
    resumePlaying() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.awHcaPlayer == null)
                throw new Error();
            yield this.awHcaPlayer.play();
        });
    }
    stopPlaying() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.awHcaPlayer == null)
                throw new Error();
            yield this.awHcaPlayer.stop();
        });
    }
}
