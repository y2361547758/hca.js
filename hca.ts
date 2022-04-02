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
    kbps = 0;
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
    fullEndAtSample = 0;
    loopStartAtSample = 0;
    loopEndAtSample = 0;
    loopSampleCount = 0;
    endAtSample = 0;
    sampleCount = 0;
    // full file size / data part (excluding header, just blocks/frames) size
    fullSize = 0;
    dataSize = 0;
    // depends on decoding mode (bit count)
    inWavSize?: HCAInfoInWavSize;
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
                if (newData.byteLength > sectionDataLen) throw new Error();
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
        }
        this.endAtSample = this.hasHeader["loop"] ? this.loopEndAtSample : this.fullEndAtSample;
        this.sampleCount = this.endAtSample - this.startAtSample;
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
    private checkValidity(): void {
        const results: Array<boolean> = [
            this.blockSize > 0,
            0 < this.format.blockCount,
            0 <= this.startAtSample,
            this.startAtSample < this.fullEndAtSample,
            this.fullEndAtSample <= this.fullSampleCount,
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
                this.loopEndAtSample <= this.fullEndAtSample,
            ];
            loopChecks.find((result, index) => {
                if (!result) {
                    throw new Error(`did not pass loop check on rule ${index}`);
                }
            });
        }
    }
    getRawHeader(): Uint8Array {
        return this.rawHeader.slice(0);
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
        if (sig.length < 1 || sig.length > 4) throw new Error();
        let newSig = new Uint8Array(4);
        for (let i = 0; i < 4; i++) {
            let c = sig.charCodeAt(i);
            if (c >= 0x80) throw new Error();
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
    static addCipherHeader(hca: Uint8Array, cipherType?: number): Uint8Array {
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
    calcInWavSize(mode = 32): HCAInfoInWavSize {
        switch (mode) {
            case 0: // float
            case 8: case 16: case 24: case 32: // integer
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
        }
    }
    constructor (hca: Uint8Array, changeMask: boolean = false, encrypt: boolean = false) {
        // if changeMask == true, (un)mask the header sigs in-place
        this.rawHeader = this.parseHeader(hca, changeMask, encrypt, {});
    }
}
interface HCAInfoInWavSize
{
    bitsPerSample: number,
    sample: number,
    block: number,
    dropped: {
        header: number,
        footer: number,
    }
    loop?: {
        loopPart: number,
        dropped: {
            header: number,
            footer: number,
        }
    }
}

class HCAUtilFunc
{
    static DivideByRoundUp(value: number, divisor: number): number
    {
        return Math.ceil(value / divisor);
    }
    static GetHighNibble(value: number): number
    {
        if (value > 0xff) throw new Error();
        if (value < -0x80) throw new Error();
        return (value >>> 4) & 0xF;
    }
    static GetLowNibble(value: number): number
    {
        if (value > 0xff) throw new Error();
        if (value < -0x80) throw new Error();
        return value & 0xF;
    }
    private static readonly SignedNibbles = [0, 1, 2, 3, 4, 5, 6, 7, -8, -7, -6, -5, -4, -3, -2, -1];
    static GetHighNibbleSigned(value: number)
    {
        if (value > 0xff) throw new Error();
        if (value < -0x80) throw new Error();
        return this.SignedNibbles[(value >>> 4) & 0xF];
    }
    static GetLowNibbleSigned(value: number)
    {
        if (value > 0xff) throw new Error();
        if (value < -0x80) throw new Error();
        return this.SignedNibbles[value & 0xF];
    }
    static CombineNibbles(high: number, low: number)
    {
        return ((high << 4) | (low & 0xF)) & 0xFF;
    }
    static GetNextMultiple(value: number, multiple: number): number
    {
        if (multiple <= 0)
            return value;

        if (value % multiple == 0)
            return value;

        return value + multiple - value % multiple;
    }
    static SignedBitReverse32(value: number): number
    {
        if (value > 0xffffffff) throw new Error();
        if (value < -0x80000000) throw new Error();
        value = ((value & 0xaaaaaaaa) >>> 1) | ((value & 0x55555555) << 1);
        value = ((value & 0xcccccccc) >>> 2) | ((value & 0x33333333) << 2);
        value = ((value & 0xf0f0f0f0) >>> 4) | ((value & 0x0f0f0f0f) << 4);
        value = ((value & 0xff00ff00) >>> 8) | ((value & 0x00ff00ff) << 8);
        return ((value & 0xffff0000) >>> 16) | ((value & 0x0000ffff) << 16);
    }
    static UnsignedBitReverse32(value: number): number
    {
        return this.SignedBitReverse32(value) >>> 0;
    }
    static UnsignedBitReverse32Trunc(value: number, bitCount: number): number {
        return this.UnsignedBitReverse32(value) >>> (32 - bitCount);
    }
    static SignedBitReverse32Trunc(value: number, bitCount: number): number {
        return this.UnsignedBitReverse32Trunc(value >>> 0, bitCount);
    }
    static BitReverse8(value: number): number
    {
        if (value > 0xff) throw new Error();
        if (value < -0x80) throw new Error();
        value >>>= 0;
        value = ((value & 0xaa) >>> 1) | ((value & 0x55) << 1);
        value = ((value & 0xcc) >>> 2) | ((value & 0x33) << 2);
        return (((value & 0xf0) >>> 4) | ((value & 0x0f) << 4)) >>> 0;
    }
    static Clamp(value: number, min: number, max: number): number
    {
        if (value < min)
            return min;
        if (value > max)
            return max;
        return value;
    }
    static DebugAssert(condition: any) {
        if (!condition) throw new Error("DebugAssert failed");
    }
}

class HCA {
    constructor () {
    }

    static decrypt(hca: Uint8Array, key1?: any, key2?: any): Uint8Array {
        return this.decryptOrEncrypt(hca, false, key1, key2);
    }
    static encrypt(hca: Uint8Array, key1?: any, key2?: any): Uint8Array {
        return this.decryptOrEncrypt(hca, true, key1, key2);
    }
    static decryptOrEncrypt(hca: Uint8Array, encrypt: boolean, key1?: any, key2?: any): Uint8Array {
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
        for (let i = 0, offset = 0; i < info.format.blockCount; i++) {
            let lastDecodedSamples = i * HCAFrame.SamplesPerFrame;
            let currentDecodedSamples = lastDecodedSamples + HCAFrame.SamplesPerFrame;
            if (currentDecodedSamples <= info.startAtSample || lastDecodedSamples >= info.endAtSample) {
                continue;
            }
            let startOffset = info.dataOffset + info.blockSize * i;
            let block = hca.subarray(startOffset, startOffset + info.blockSize);
            this.decodeBlock(frame, block);
            let wavebuff: Uint8Array;
            if (lastDecodedSamples < info.startAtSample || currentDecodedSamples > info.endAtSample) {
                // crossing startAtSample/endAtSample, skip/drop specified bytes
                wavebuff = this.writeToPCM(frame, mode, volume);
                if (lastDecodedSamples < info.startAtSample) {
                    let skippedSize = (info.startAtSample - lastDecodedSamples) * inWavSize.sample;
                    wavebuff = wavebuff.subarray(skippedSize, inWavSize.block);
                } else if (currentDecodedSamples > info.endAtSample) {
                    let writeSize = (info.endAtSample - lastDecodedSamples) * inWavSize.sample;
                    wavebuff = wavebuff.subarray(0, writeSize);
                } else throw Error("should never go here");
                dataPart.set(wavebuff, offset);
            } else {
                wavebuff = this.writeToPCM(frame, mode, volume, dataPart, offset);
            }
            offset += wavebuff.byteLength;
        }

        // decoding done, then just copy looping part
        if (info.hasHeader["loop"] && loop) {
            // "tail" beyond loop end is dropped
            // copy looping audio clips
            if (inWavSize.loop == null) throw new Error();
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

    static decodeBlock(frame: HCAFrame, block: Uint8Array): void
    {
        let info = frame.Hca;
        if (block.byteLength != info.blockSize) throw new Error();
        // verify checksum
        HCACrc16.verify(block, info.blockSize - 2);
        // decode
        HCADecoder.DecodeFrame(block, frame);
    }
    static writeToPCM(frame: HCAFrame, mode = 32, volume = 1.0,
        writer?: Uint8Array, ftell?: number): Uint8Array
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
        let info = frame.Hca;
        if (writer == null) {
            writer = new Uint8Array(HCAFrame.SamplesPerFrame * info.format.channelCount * (mode == 0 ? 32 : mode) / 8);
            if (ftell == null) {
                ftell = 0;
            }
        } else {
            if (ftell == null) throw new Error();
        }
        // write decoded data into writer
        let p = new DataView(writer.buffer, writer.byteOffset, writer.byteLength);
        let ftellBegin = ftell;
        for (let sf = 0; sf < HCAFrame.SubframesPerFrame; sf++) {
            for (let s = 0; s < HCAFrame.SamplesPerSubFrame; s++) {
                for (let c = 0; c < frame.Channels.length; c++) {
                    let f = frame.Channels[c].PcmFloat[sf][s] * volume;
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
        return writer.subarray(ftellBegin, ftell);
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
class HCAWav
{
    readonly fileBuf: Uint8Array;
    readonly dataPart: Uint8Array;
    readonly waveRiff: HCAWavWaveRiffHeader;
    readonly fmt: HCAWavFmtChunk;
    readonly note?: HCAWavCommentChunk;
    readonly smpl?: HCAWaveSmplChunk;
    constructor (info: HCAInfo, mode = 32, loop = 0) {
        switch (mode) {
            case 0: // float
            case 8: case 16: case 24: case 32: // integer
                break;
            default:
                mode = 32;
        }
        if (isNaN(loop)) throw new Error("loop is not number");
        loop = Math.floor(loop);
        if (loop < 0) throw new Error();

        let inWavSize = info.calcInWavSize(mode);
        let dataSize = inWavSize.sample * info.sampleCount;
        if (loop > 0) {
            if (inWavSize.loop == null) throw new Error();
            dataSize += inWavSize.loop.loopPart * loop;
        }

        // prepare metadata chunks and data chunk header
        this.fmt = new HCAWavFmtChunk(info, mode);
        if (info.hasHeader["comm"]) this.note = new HCAWavCommentChunk(info);
        if (info.hasHeader["loop"]) this.smpl = new HCAWaveSmplChunk(info);
        this.waveRiff = new HCAWavWaveRiffHeader(
              8 + this.fmt.size
            + (this.note == null ? 0 : 8 + this.note.size)
            + 8 + dataSize
            + (this.smpl == null ? 0 : 8 + this.smpl.size)
        );

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

        if (writtenLength != this.fileBuf.byteLength) throw new Error();
    }
}
class HCAWavWaveRiffHeader
{
    readonly size: number;
    constructor (size: number) {
        if (isNaN(size)) throw new Error("size must be number");
        size = Math.floor(size);
        if (size <= 0) throw new Error();
        this.size = 4 + size; // "WAVE" + remaining part
    }
    get(): Uint8Array {
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
class HCAWavFmtChunk
{
    readonly size = 16;
    readonly formatTag: number;
    readonly channelCount: number;
    readonly samplesPerSec: number;
    readonly bytesPerSec: number;
    readonly blockAlign: number;
    readonly bitsPerSample: number;
    constructor (info: HCAInfo, mode = 32) {
        switch (mode) {
            case 0: // float
            case 8: case 16: case 24: case 32: // integer
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
    get(): Uint8Array {
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
class HCAWavCommentChunk
{
    readonly size: number;
    readonly commentBuf: Uint8Array;
    constructor (info: HCAInfo) {
        this.commentBuf = new TextEncoder().encode(info.comment);
        let size = this.commentBuf.byteLength;
        size += 4;
        if (size % 4) size += 4 - size % 4;
        this.size = size;
    }
    get(): Uint8Array {
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
class HCAWaveSmplChunk
{
    readonly size = 60;
    readonly manufacturer = 0;
    readonly product = 0;
    readonly samplePeriod: number;
    readonly MIDIUnityNote = 0x3c;
    readonly MIDIPitchFraction = 0;
    readonly SMPTEFormat = 0;
    readonly SMPTEOffset: number;
    readonly sampleLoops = 1;
    readonly samplerData = 0x18;
    readonly loop_Identifier = 0;
    readonly loop_Type = 0;
    readonly loop_Start: number;
    readonly loop_End: number;
    readonly loop_Fraction = 0;
    readonly loop_PlayCount= 0;
    constructor (info: HCAInfo) {
        if (!info.hasHeader["loop"]) throw new Error("missing \"loop\" header");
        this.samplePeriod = (1 / info.format.samplingRate * 1000000000);
        this.loop_Start = info.loopStartAtSample - info.startAtSample;
        this.loop_End = info.loopEndAtSample - info.startAtSample;
        this.SMPTEOffset = 1;
    }
    get(): Uint8Array {
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
    Buffer: Uint8Array;
    dv: DataView;
    LengthBits: number;
    Position: number;
    get Remaining(): number {
        return this.LengthBits - this.Position;
    }

    constructor (buffer: Uint8Array)
    {
        this.Buffer = buffer;
        this.dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        this.LengthBits = buffer.length * 8;
        this.Position = 0;
    }

    ReadInt(bitCount: number): number
    {
        let value: number = this.PeekInt(bitCount);
        this.Position += bitCount;
        return value;
    }

    ReadBool(): boolean {
        return this.ReadInt(1) == 1;
    }

    ReadOffsetBinary(bitCount: number, bias: HCAOffsetBias): number
    {
        let offset: number = (1 << (bitCount - 1)) - bias;
        let value: number = this.PeekInt(bitCount) - offset;
        this.Position += bitCount;
        return value;
    }

    AlignPosition(multiple: number): void
    {
        this.Position = HCAUtilFunc.GetNextMultiple(this.Position, multiple);
    }

    PeekInt(bitCount: number): number
    {
        HCAUtilFunc.DebugAssert(bitCount >= 0 && bitCount <= 32);

        if (bitCount > this.Remaining)
        {
            if (this.Position >= this.LengthBits) return 0;

            let extraBits: number = bitCount - this.Remaining;
            return this.PeekIntFallback(this.Remaining) << extraBits;
        }

        let byteIndex: number = this.Position / 8;
        let bitIndex: number = this.Position % 8;

        if (bitCount <= 9 && this.Remaining >= 16)
        {
            let value: number = this.dv.getUint16(byteIndex);
            value &= 0xFFFF >> bitIndex;
            value >>= 16 - bitCount - bitIndex;
            return value;
        }

        if (bitCount <= 17 && this.Remaining >= 24)
        {
            let value: number = this.dv.getUint16(byteIndex) << 8 | this.dv.getUint8(byteIndex + 2);
            value &= 0xFFFFFF >> bitIndex;
            value >>= 24 - bitCount - bitIndex;
            return value;
        }

        if (bitCount <= 25 && this.Remaining >= 32)
        {
            let value: number = this.dv.getUint32(byteIndex);
            value &= 0xFFFFFFFF >>> bitIndex;
            value >>= 32 - bitCount - bitIndex;
            return value;
        }
        return this.PeekIntFallback(bitCount);
    }

    private PeekIntFallback(bitCount: number): number
    {
        let value: number = 0;
        let byteIndex: number = this.Position / 8;
        let bitIndex: number = this.Position % 8;

        while (bitCount > 0)
        {
            if (bitIndex >= 8)
            {
                bitIndex = 0;
                byteIndex++;
            }

            let bitsToRead: number = Math.min(bitCount, 8 - bitIndex);
            let mask: number = 0xFF >> bitIndex;
            let currentByte: number = (mask & this.dv.getUint8(byteIndex)) >> (8 - bitIndex - bitsToRead);

            value = (value << bitsToRead) | currentByte;
            bitIndex += bitsToRead;
            bitCount -= bitsToRead;
        }
        return value;
    }
}
enum HCAOffsetBias
{
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
    Positive = 1,
    Negative = 0,
}

class HCABitWriter
{
    Buffer: Uint8Array;
    dv: DataView;
    LengthBits: number;
    Position = 0;
    get Remaining(): number {return this.LengthBits - this.Position;}

    constructor(buffer: Uint8Array)
    {
        this.Buffer = buffer;
        this.dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        this.LengthBits = buffer.length * 8;
    }

    public AlignPosition(multiple: number): void
    {
        let newPosition = HCAUtilFunc.GetNextMultiple(this.Position, multiple);
        let bits = newPosition - this.Position;
        this.Write(0, bits);
    }

    public Write(value: number, bitCount: number): void
    {
        HCAUtilFunc.DebugAssert(bitCount >= 0 && bitCount <= 32);

        if (bitCount > this.Remaining)
        {
            throw new Error("Not enough bits left in output buffer");
        }

        let byteIndex = this.Position / 8;
        let bitIndex = this.Position % 8;

        if (bitCount <= 9 && this.Remaining >= 16)
        {
            let outValue = ((value << (16 - bitCount)) & 0xFFFF) >> bitIndex;
            outValue |= this.dv.getUint16(byteIndex);
            this.dv.setUint16(byteIndex, outValue);
        }

        else if (bitCount <= 17 && this.Remaining >= 24)
        {
            let outValue = ((value << (24 - bitCount)) & 0xFFFFFF) >> bitIndex;
            outValue |= this.dv.getUint16(byteIndex) << 8 | this.dv.getUint8(byteIndex + 2);
            this.dv.setUint16(byteIndex, outValue >>> 8);
            this.dv.setUint8(byteIndex + 2, outValue & 0xFF);
        }

        else if (bitCount <= 25 && this.Remaining >= 32)
        {
            let outValue = (((value << (32 - bitCount)) & 0xFFFFFFFF) >>> bitIndex);
            outValue |= this.dv.getUint32(byteIndex);
            this.dv.setUint32(byteIndex, outValue);
        }
        else
        {
            this.WriteFallback(value, bitCount);
        }

        this.Position += bitCount;
    }

    private WriteFallback(value: number, bitCount: number): void
    {
        let byteIndex = this.Position / 8;
        let bitIndex = this.Position % 8;

        while (bitCount > 0)
        {
            if (bitIndex >= 8)
            {
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

class HCAFrame
{
    static readonly SubframesPerFrame = 8;
    static readonly SubFrameSamplesBits = 7;
    static readonly SamplesPerSubFrame = 1 << this.SubFrameSamplesBits;
    static readonly SamplesPerFrame = this.SubframesPerFrame * this.SamplesPerSubFrame;

    Hca: HCAInfo;
    Channels: HCAChannel[];
    AthCurve: Uint8Array;
    AcceptableNoiseLevel: number = 0;
    EvaluationBoundary: number = 0;

    constructor (hca: HCAInfo)
    {
        this.Hca = hca;
        let channelTypes = HCAFrame.GetChannelTypes(hca);
        this.Channels = [];

        for (let i = 0; i < hca.format.channelCount; i++)
        {
            this.Channels.push(new HCAChannel({
                Type: channelTypes[i],
                CodedScaleFactorCount: channelTypes[i] == HCAChannelType.StereoSecondary
                    ? hca.compDec.BaseBandCount
                    : hca.compDec.BaseBandCount + hca.compDec.StereoBandCount
            }));
        }

        this.AthCurve = hca.UseAthCurve ? HCAFrame.ScaleAthCurve(hca.format.samplingRate) : new Uint8Array(HCAFrame.SamplesPerSubFrame);
    }

    private static GetChannelTypes(hca: HCAInfo): HCAChannelType[]
    {
        let channelsPerTrack = hca.format.channelCount / hca.compDec.TrackCount;
        if (hca.compDec.StereoBandCount == 0 || channelsPerTrack == 1) { return new Array(8).fill(HCAChannelType); }

        const Discrete = HCAChannelType.Discrete;
        const StereoPrimary = HCAChannelType.StereoPrimary;
        const StereoSecondary = HCAChannelType.StereoSecondary;
        switch (channelsPerTrack)
        {
            case 2: return [StereoPrimary, StereoSecondary];
            case 3: return [StereoPrimary, StereoSecondary, Discrete];
            case 4: if (hca.compDec.ChannelConfig != 0) return [StereoPrimary, StereoSecondary, Discrete, Discrete];
                else return [StereoPrimary, StereoSecondary, StereoPrimary, StereoSecondary];
            case 5: if (hca.compDec.ChannelConfig > 2) return [StereoPrimary, StereoSecondary, Discrete, Discrete, Discrete];
                else return [StereoPrimary, StereoSecondary, Discrete, StereoPrimary, StereoSecondary];
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
    private static ScaleAthCurve(frequency: number): Uint8Array
    {
        var ath = new Uint8Array(HCAFrame.SamplesPerSubFrame);

        let acc = 0;
        let i;
        for (i = 0; i < ath.length; i++)
        {
            acc += frequency;
            let index = acc >> 13;

            if (index >= HCATables.AthCurve.length)
            {
                break;
            }
            ath[i] = HCATables.AthCurve[index];
        }

        for (; i < ath.length; i++)
        {
            ath[i] = 0xff;
        }

        return ath;
    }
}

class HCAChannel
{
    Type: HCAChannelType = 0;
    CodedScaleFactorCount = 0;
    PcmFloat: Float64Array[] = Array.from({length: HCAFrame.SubframesPerFrame}, () => new Float64Array(HCAFrame.SamplesPerSubFrame));
    Spectra: Float64Array[] = Array.from({length: HCAFrame.SubframesPerFrame}, () => new Float64Array(HCAFrame.SamplesPerSubFrame));
    ScaledSpectra: Float64Array[] = Array.from({length: HCAFrame.SamplesPerSubFrame}, () => new Float64Array(HCAFrame.SubframesPerFrame));
    QuantizedSpectra: Int32Array[] = Array.from({length: HCAFrame.SubframesPerFrame}, () => new Int32Array(HCAFrame.SamplesPerSubFrame));
    Gain: Float64Array = new Float64Array(HCAFrame.SamplesPerSubFrame);
    Intensity: Int32Array = new Int32Array(HCAFrame.SubframesPerFrame);
    HfrScales: Int32Array = new Int32Array(8);
    HfrGroupAverageSpectra: Float64Array = new Float64Array(8);
    Mdct: HCAMdct = new HCAMdct(HCAFrame.SubFrameSamplesBits, HCATables.MdctWindow, Math.sqrt(2.0 / HCAFrame.SamplesPerSubFrame));
    ScaleFactors: Int32Array = new Int32Array(HCAFrame.SamplesPerSubFrame);
    Resolution: Int32Array = new Int32Array(HCAFrame.SamplesPerSubFrame);
    HeaderLengthBits = 0;
    ScaleFactorDeltaBits = 0;
    constructor (values: Record<string, any>) {
        let t = this as any;
        for (let key in values) {
            t[key] = values[key];
        }
    }
}

enum HCAChannelType
{
    Discrete = 0,
    StereoPrimary = 1,
    StereoSecondary = 2,
}

class HCADecoder
{
    static DecodeFrame(audio: Uint8Array, frame: HCAFrame): void
    {
        let reader = new HCABitReader(audio);
        HCAPacking.UnpackFrame(frame, reader);
        this.DequantizeFrame(frame);
        this.RestoreMissingBands(frame);
        this.RunImdct(frame);
    }

    private static DequantizeFrame(frame: HCAFrame): void
    {
        for (let channel of frame.Channels)
        {
            this.CalculateGain(channel);
        }

        for (let sf = 0; sf < HCAFrame.SubframesPerFrame; sf++)
        {
            for (let channel of frame.Channels)
            {
                for (let s = 0; s < channel.CodedScaleFactorCount; s++)
                {
                    channel.Spectra[sf][s] = channel.QuantizedSpectra[sf][s] * channel.Gain[s];
                }
            }
        }
    }

    private static RestoreMissingBands(frame: HCAFrame): void
    {
        this.ReconstructHighFrequency(frame);
        this.ApplyIntensityStereo(frame);
    }

    private static CalculateGain(channel: HCAChannel): void
    {
        for (let i = 0; i < channel.CodedScaleFactorCount; i++)
        {
            channel.Gain[i] = HCATables.DequantizerScalingTable[channel.ScaleFactors[i]] * HCATables.QuantizerStepSize[channel.Resolution[i]];
        }
    }

    private static ReconstructHighFrequency(frame: HCAFrame): void
    {
        let hca = frame.Hca;
        if (hca.HfrGroupCount == 0) return;

        // The last spectral coefficient should always be 0;
        let totalBandCount = Math.min(hca.compDec.TotalBandCount, 127);

        let hfrStartBand = hca.compDec.BaseBandCount + hca.compDec.StereoBandCount;
        let hfrBandCount = Math.min(hca.compDec.HfrBandCount, totalBandCount - hca.compDec.HfrBandCount);

        for (let channel of frame.Channels)
        {
            if (channel.Type == HCAChannelType.StereoSecondary) continue;

            for (let group = 0, band = 0; group < hca.HfrGroupCount; group++)
            {
                for (let i = 0; i < hca.compDec.BandsPerHfrGroup && band < hfrBandCount; band++, i++)
                {
                    let highBand = hfrStartBand + band;
                    let lowBand = hfrStartBand - band - 1;
                    let index = channel.HfrScales[group] - channel.ScaleFactors[lowBand] + 64;
                    for (let sf = 0; sf < HCAFrame.SubframesPerFrame; sf++)
                    {
                        channel.Spectra[sf][highBand] = HCATables.ScaleConversionTable[index] * channel.Spectra[sf][lowBand];
                    }
                }
            }
        }
    }

    private static ApplyIntensityStereo(frame: HCAFrame): void
    {
        if (frame.Hca.compDec.StereoBandCount <= 0) return;
        for (let c = 0; c < frame.Channels.length; c++)
        {
            if (frame.Channels[c].Type != HCAChannelType.StereoPrimary) continue;
            for (let sf = 0; sf < HCAFrame.SubframesPerFrame; sf++)
            {
                let l = frame.Channels[c].Spectra[sf];
                let r = frame.Channels[c + 1].Spectra[sf];
                let ratioL = HCATables.IntensityRatioTable[frame.Channels[c + 1].Intensity[sf]];
                let ratioR = ratioL - 2.0;
                for (let b = frame.Hca.compDec.BaseBandCount; b < frame.Hca.compDec.TotalBandCount; b++)
                {
                    r[b] = l[b] * ratioR;
                    l[b] *= ratioL;
                }
            }
        }
    }

    private static RunImdct(frame: HCAFrame): void
    {
        for (let sf = 0; sf < HCAFrame.SubframesPerFrame; sf++)
        {
            for (let channel of frame.Channels)
            {
                channel.Mdct.RunImdct(channel.Spectra[sf], channel.PcmFloat[sf]);
            }
        }
    }

}

class HCAPacking
{
    public static UnpackFrame(frame: HCAFrame, reader: HCABitReader): boolean
    {
        if (!this.UnpackFrameHeader(frame, reader)) return false;
        this.ReadSpectralCoefficients(frame, reader);
        return this.UnpackingWasSuccessful(frame, reader);
    }

    public static PackFrame(frame: HCAFrame, outBuffer: Uint8Array): void
    {
        var writer = new HCABitWriter(outBuffer);
        writer.Write(0xffff, 16);
        writer.Write(frame.AcceptableNoiseLevel, 9);
        writer.Write(frame.EvaluationBoundary, 7);

        for (let channel of frame.Channels)
        {
            this.WriteScaleFactors(writer, channel);
            if (channel.Type == HCAChannelType.StereoSecondary)
            {
                for (let i = 0; i < HCAFrame.SubframesPerFrame; i++)
                {
                    writer.Write(channel.Intensity[i], 4);
                }
            }
            else if (frame.Hca.HfrGroupCount > 0)
            {
                for (let i = 0; i < frame.Hca.HfrGroupCount; i++)
                {
                    writer.Write(channel.HfrScales[i], 6);
                }
            }
        }

        for (let sf = 0; sf < HCAFrame.SubframesPerFrame; sf++)
        {
            for (let channel of frame.Channels)
            {
                this.WriteSpectra(writer, channel, sf);
            }
        }

        writer.AlignPosition(8);
        for (let i = writer.Position / 8; i < frame.Hca.blockSize - 2; i++)
        {
            writer.dv.setUint8(i, 0);
        }

        this.WriteChecksum(writer, outBuffer);
    }

    public static CalculateResolution(scaleFactor: number, noiseLevel: number): number
    {
        if (scaleFactor == 0)
        {
            return 0;
        }
        let curvePosition = noiseLevel - (5 * scaleFactor >> 1) + 2;
        curvePosition = HCAUtilFunc.Clamp(curvePosition, 0, 58);
        return HCATables.ScaleToResolutionCurve[curvePosition];
    }

    private static UnpackFrameHeader(frame: HCAFrame, reader: HCABitReader): boolean
    {
        let syncWord = reader.ReadInt(16);
        if (syncWord != 0xffff)
        {
            throw new Error("Invalid frame header");
        }

        let athCurve = frame.AthCurve;
        frame.AcceptableNoiseLevel = reader.ReadInt(9);
        frame.EvaluationBoundary = reader.ReadInt(7);

        for (let channel of frame.Channels)
        {
            if (!this.ReadScaleFactors(channel, reader)) return false;

            for (let i = 0; i < frame.EvaluationBoundary; i++)
            {
                channel.Resolution[i] = this.CalculateResolution(channel.ScaleFactors[i], athCurve[i] + frame.AcceptableNoiseLevel - 1);
            }

            for (let i = frame.EvaluationBoundary; i < channel.CodedScaleFactorCount; i++)
            {
                channel.Resolution[i] = this.CalculateResolution(channel.ScaleFactors[i], athCurve[i] + frame.AcceptableNoiseLevel);
            }

            if (channel.Type == HCAChannelType.StereoSecondary)
            {
                this.ReadIntensity(reader, channel.Intensity);
            }
            else if (frame.Hca.HfrGroupCount > 0)
            {
                this.ReadHfrScaleFactors(reader, frame.Hca.HfrGroupCount, channel.HfrScales);
            }
        }
        return true;
    }

    private static ReadScaleFactors(channel: HCAChannel, reader: HCABitReader): boolean
    {
        channel.ScaleFactorDeltaBits = reader.ReadInt(3);
        if (channel.ScaleFactorDeltaBits == 0)
        {
            channel.ScaleFactors.fill(0, 0, channel.ScaleFactors.length);
            return true;
        }

        if (channel.ScaleFactorDeltaBits >= 6)
        {
            for (let i = 0; i < channel.CodedScaleFactorCount; i++)
            {
                channel.ScaleFactors[i] = reader.ReadInt(6);
            }
            return true;
        }

        return this.DeltaDecode(reader, channel.ScaleFactorDeltaBits, 6, channel.CodedScaleFactorCount, channel.ScaleFactors);
    }

    private static ReadIntensity(reader: HCABitReader, intensity: Int32Array): void
    {
        for (let i = 0; i < HCAFrame.SubframesPerFrame; i++)
        {
            intensity[i] = reader.ReadInt(4);
        }
    }

    private static ReadHfrScaleFactors(reader: HCABitReader, groupCount: number, hfrScale: Int32Array): void
    {
        for (let i = 0; i < groupCount; i++)
        {
            hfrScale[i] = reader.ReadInt(6);
        }
    }

    private static ReadSpectralCoefficients(frame: HCAFrame, reader: HCABitReader): void
    {
        for (let sf = 0; sf < HCAFrame.SubframesPerFrame; sf++)
        {
            for (let channel of frame.Channels)
            {
                for (let s = 0; s < channel.CodedScaleFactorCount; s++)
                {
                    let resolution = channel.Resolution[s];
                    let bits = HCATables.QuantizedSpectrumMaxBits[resolution];
                    let code = reader.PeekInt(bits);
                    if (resolution < 8)
                    {
                        bits = HCATables.QuantizedSpectrumBits[resolution][code];
                        channel.QuantizedSpectra[sf][s] = HCATables.QuantizedSpectrumValue[resolution][code];
                    }
                    else
                    {
                        // Read the sign-magnitude value. The low bit is the sign
                        let quantizedCoefficient = (code >> 1) * (1 - (code % 2 * 2));
                        if (quantizedCoefficient == 0)
                        {
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

    private static DeltaDecode(reader: HCABitReader, deltaBits: number, dataBits: number, count: number, output: Int32Array): boolean
    {
        output[0] = reader.ReadInt(dataBits);
        let maxDelta = 1 << (deltaBits - 1);
        let maxValue = (1 << dataBits) - 1;

        for (let i = 1; i < count; i++)
        {
            let delta = reader.ReadOffsetBinary(deltaBits, HCAOffsetBias.Positive);

            if (delta < maxDelta)
            {
                let value = output[i - 1] + delta;
                if (value < 0 || value > maxValue)
                {
                    return false;
                }
                output[i] = value;
            }
            else
            {
                output[i] = reader.ReadInt(dataBits);
            }
        }
        return true;
    }

    private static UnpackingWasSuccessful(frame: HCAFrame, reader: HCABitReader): boolean
    {
        // 128 leftover bits after unpacking should be high enough to get rid of false negatives,
        // and low enough that false positives will be uncommon.
        return reader.Remaining >= 16 && reader.Remaining <= 128
               || this.FrameEmpty(frame)
               || frame.AcceptableNoiseLevel == 0 && reader.Remaining >= 16;
    }

    private static FrameEmpty(frame: HCAFrame): boolean
    {
        if (frame.AcceptableNoiseLevel > 0) return false;

        // If all the scale factors are 0, the frame is empty
        for (let channel of frame.Channels)
        {
            if (channel.ScaleFactorDeltaBits > 0)
            {
                return false;
            }
        }
        return true;
    }

    private static WriteChecksum(writer: HCABitWriter, hcaBuffer: Uint8Array): void
    {
        writer.Position = writer.LengthBits - 16;
        let crc16 = HCACrc16.calc(hcaBuffer, hcaBuffer.length - 2);
        writer.Write(crc16, 16);
    }

    private static WriteSpectra(writer: HCABitWriter, channel: HCAChannel, subFrame: number): void
    {
        for (let i = 0; i < channel.CodedScaleFactorCount; i++)
        {
            let resolution = channel.Resolution[i];
            let quantizedSpectra = channel.QuantizedSpectra[subFrame][i];
            if (resolution == 0) continue;
            if (resolution < 8)
            {
                let bits = HCATables.QuantizeSpectrumBits[resolution][quantizedSpectra + 8];
                writer.Write(HCATables.QuantizeSpectrumValue[resolution][quantizedSpectra + 8], bits);
            }
            else if (resolution < 16)
            {
                let bits = HCATables.QuantizedSpectrumMaxBits[resolution] - 1;
                writer.Write(Math.abs(quantizedSpectra), bits);
                if (quantizedSpectra != 0)
                {
                    writer.Write(quantizedSpectra > 0 ? 0 : 1, 1);
                }
            }
        }
    }

    private static WriteScaleFactors(writer: HCABitWriter, channel: HCAChannel): void
    {
        let deltaBits = channel.ScaleFactorDeltaBits;
        let scales = channel.ScaleFactors;
        writer.Write(deltaBits, 3);
        if (deltaBits == 0) return;

        if (deltaBits == 6)
        {
            for (let i = 0; i < channel.CodedScaleFactorCount; i++)
            {
                writer.Write(scales[i], 6);
            }
            return;
        }

        writer.Write(scales[0], 6);
        let maxDelta = (1 << (deltaBits - 1)) - 1;
        let escapeValue = (1 << deltaBits) - 1;

        for (let i = 1; i < channel.CodedScaleFactorCount; i++)
        {
            let delta = scales[i] - scales[i - 1];
            if (Math.abs(delta) > maxDelta)
            {
                writer.Write(escapeValue, deltaBits);
                writer.Write(scales[i], 6);
            }
            else
            {
                writer.Write(maxDelta + delta, deltaBits);
            }
        }
    }
}

class HCAMdct
{

    MdctBits: number;
    MdctSize: number;
    Scale: number;

    private static _tableBits = -1;
    private static readonly SinTables: Float64Array[] = [];
    private static readonly CosTables: Float64Array[] = [];
    private static readonly ShuffleTables: Int32Array[] = [];

    private readonly _mdctPrevious: Float64Array;
    private readonly _imdctPrevious: Float64Array;
    private readonly _imdctWindow: Float64Array;

    private readonly _scratchMdct: Float64Array;
    private readonly _scratchDct: Float64Array;

    constructor (mdctBits: number, window: Float64Array, scale = 1)
    {
        HCAMdct.SetTables(mdctBits);

        this.MdctBits = mdctBits;
        this.MdctSize = 1 << mdctBits;
        this.Scale = scale;

        if (window.length < this.MdctSize)
        {
            throw new Error("Window must be as long as the MDCT size.");
        }

        this._mdctPrevious = new Float64Array(this.MdctSize);
        this._imdctPrevious = new Float64Array(this.MdctSize);
        this._scratchMdct = new Float64Array(this.MdctSize);
        this._scratchDct = new Float64Array(this.MdctSize);
        this._imdctWindow = window;
    }

    private static SetTables(maxBits: number): void
    {
        if (maxBits > this._tableBits)
        {
            for (let i = this._tableBits + 1; i <= maxBits; i++)
            {
                let out = this.GenerateTrigTables(i);
                this.SinTables.push(out.sin);
                this.CosTables.push(out.cos);
                this.ShuffleTables.push(this.GenerateShuffleTable(i));
            }
            this._tableBits = maxBits;
        }
    }

    public RunMdct(input: Float64Array, output: Float64Array): void
    {
        if (input.length < this.MdctSize)
        {
            throw new Error("Input must be as long as the MDCT size.");
        }

        if (output.length < this.MdctSize)
        {
            throw new Error("Output must be as long as the MDCT size.");
        }

        let size = this.MdctSize;
        let half = (size >> 1);
        let dctIn = this._scratchMdct;

        for (let i = 0; i < half; i++)
        {
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

    public RunImdct(input: Float64Array, output: Float64Array): void
    {
        if (input.length < this.MdctSize)
        {
            throw new Error("Input must be as long as the MDCT size.");
        }

        if (output.length < this.MdctSize)
        {
            throw new Error("Output must be as long as the MDCT size.");
        }

        let size = this.MdctSize;
        let half = (size >> 1);
        let dctOut = this._scratchMdct;

        this.Dct4(input, dctOut);

        for (let i = 0; i < half; i++)
        {
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
    private Dct4(input: Float64Array, output: Float64Array): void
    {
        let shuffleTable = HCAMdct.ShuffleTables[this.MdctBits];
        let sinTable = HCAMdct.SinTables[this.MdctBits];
        let cosTable = HCAMdct.CosTables[this.MdctBits];
        let dctTemp = this._scratchDct;

        let size = this.MdctSize;
        let lastIndex = size - 1;
        let halfSize = (size >> 1);

        for (let i = 0; i < halfSize; i++)
        {
            let i2 = i * 2;
            let a = input[i2];
            let b = input[lastIndex - i2];
            let sin = sinTable[i];
            let cos = cosTable[i];
            dctTemp[i2] = a * cos + b * sin;
            dctTemp[i2 + 1] = a * sin - b * cos;
        }
        let stageCount = this.MdctBits - 1;

        for (let stage = 0; stage < stageCount; stage++)
        {
            let blockCount = 1 << stage;
            let blockSizeBits = stageCount - stage;
            let blockHalfSizeBits = blockSizeBits - 1;
            let blockSize = 1 << blockSizeBits;
            let blockHalfSize = 1 << blockHalfSizeBits;
            sinTable = HCAMdct.SinTables[blockHalfSizeBits];
            cosTable = HCAMdct.CosTables[blockHalfSizeBits];

            for (let block = 0; block < blockCount; block++)
            {
                for (let i = 0; i < blockHalfSize; i++)
                {
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

        for (let i = 0; i < this.MdctSize; i++)
        {
            output[i] = dctTemp[shuffleTable[i]] * this.Scale;
        }
    }

    private static GenerateTrigTables(sizeBits: number): {sin: Float64Array, cos: Float64Array}
    {
        let size = 1 << sizeBits;
        let out: {sin: Float64Array, cos: Float64Array} = {
            sin: new Float64Array(size),
            cos: new Float64Array(size)
        };

        for (let i = 0; i < size; i++)
        {
            let value = Math.PI * (4 * i + 1) / (4 * size);
            out.sin[i] = Math.sin(value);
            out.cos[i] = Math.cos(value);
        }

        return out;
    }

    private static GenerateShuffleTable(sizeBits: number): Int32Array
    {
        let size = 1 << sizeBits;
        var table = new Int32Array(size);

        for (let i = 0; i < size; i++)
        {
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
    private Dct4Slow(input: Float64Array, output: Float64Array): void
    {
        for (let k = 0; k < this.MdctSize; k++)
        {
            let sample = 0;
            for (let n = 0; n < this.MdctSize; n++)
            {
                let angle = Math.PI / this.MdctSize * (k + 0.5) * (n + 0.5);
                sample += Math.cos(angle) * input[n];
            }
            output[k] = sample * this.Scale;
        }
    }
}

class HCATables
{
    private static isLittleEndian(): boolean
    {
        let test = new Float64Array([1.0]);
        let dv = new DataView(test.buffer);
        if (dv.getUint32(0) != 0) return false;
        return true;
    }
    private static adaptEndianness6432(a: Uint32Array): Uint32Array
    {
        if (a.byteLength % 8 != 0) throw new Error();
        if (!this.isLittleEndian()) {
            for (let i = 0; i < a.length; i += 2) {
                let temp = a[i];
                a[i] = a[i + 1];
                a[i + 1] = temp;
            }
        }
        return a;
    }

    static readonly QuantizeSpectrumBits: Uint8Array[] = [
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
    static readonly QuantizeSpectrumValue: Uint8Array[] = [
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
    static readonly QuantizedSpectrumBits: Uint8Array[] = [
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
    static readonly QuantizedSpectrumMaxBits = new Uint8Array([
        0x00, 0x02, 0x03, 0x03, 0x04, 0x04, 0x04, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C
    ]);
    static readonly QuantizedSpectrumValue: Int8Array[] = [
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
    static readonly ScaleToResolutionCurve = new Uint8Array([
        0x0F, 0x0E, 0x0E, 0x0E, 0x0E, 0x0E, 0x0E, 0x0D, 0x0D, 0x0D, 0x0D, 0x0D, 0x0D, 0x0C, 0x0C, 0x0C,
        0x0C, 0x0C, 0x0C, 0x0B, 0x0B, 0x0B, 0x0B, 0x0B, 0x0B, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A,
        0x09, 0x09, 0x09, 0x09, 0x09, 0x09, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x07, 0x06, 0x06, 0x05,
        0x04, 0x04, 0x04, 0x03, 0x03, 0x03, 0x02, 0x02, 0x02, 0x02, 0x01
    ]);
    static readonly AthCurve = new Uint8Array([
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
    static readonly MdctWindow = new Float64Array(this.adaptEndianness6432(new Uint32Array([
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
    static readonly DefaultChannelMapping = new Uint8Array([
        0x00, 0x01, 0x00, 0x04, 0x00, 0x01, 0x03, 0x07, 0x03
    ]);
    static readonly ValidChannelMappings: Uint8Array[] = [
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

    static readonly DequantizerScalingTable = new Float64Array(this.adaptEndianness6432(new Uint32Array([
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
    static readonly QuantizerStepSize = new Float64Array(this.adaptEndianness6432(new Uint32Array([
        0x00000000, 0x00000000, 0x55555555, 0x3FE55555, 0x9999999A, 0x3FD99999, 0x92492492, 0x3FD24924,
        0x1C71C71C, 0x3FCC71C7, 0x745D1746, 0x3FC745D1, 0x13B13B14, 0x3FC3B13B, 0x11111111, 0x3FC11111,
        0x08421084, 0x3FB08421, 0x10410410, 0x3FA04104, 0x81020408, 0x3F902040, 0x10101010, 0x3F801010,
        0x02010080, 0x3F700804, 0x00401004, 0x3F600401, 0x40080100, 0x3F500200, 0x10010010, 0x3F400100
    ])).buffer);
    static readonly QuantizerDeadZone = new Float64Array(this.adaptEndianness6432(new Uint32Array([
        0xFFFFFFFF, 0xFFFFFFFF, 0x55555553, 0x3FD55555, 0x99999997, 0x3FC99999, 0x9249248E, 0x3FC24924,
        0x1C71C717, 0x3FBC71C7, 0x745D1740, 0x3FB745D1, 0x13B13B0D, 0x3FB3B13B, 0x11111109, 0x3FB11111,
        0x08421074, 0x3FA08421, 0x104103F0, 0x3F904104, 0x810203C8, 0x3F802040, 0x10100F90, 0x3F701010,
        0x0200FF80, 0x3F600804, 0x00400E04, 0x3F500401, 0x4007FD00, 0x3F400200, 0x1000F810, 0x3F300100
    ])).buffer);
    static readonly QuantizerScalingTable = new Float64Array(this.adaptEndianness6432(new Uint32Array([
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
    static readonly QuantizerInverseStepSize = new Float64Array(this.adaptEndianness6432(new Uint32Array([
        0x00000000, 0x3FE00000, 0x00000000, 0x3FF80000, 0x00000000, 0x40040000, 0x00000000, 0x400C0000,
        0x00000000, 0x40120000, 0x00000000, 0x40160000, 0x00000000, 0x401A0000, 0x00000000, 0x401E0000,
        0x00000000, 0x402F0000, 0x00000000, 0x403F8000, 0x00000000, 0x404FC000, 0x00000000, 0x405FE000,
        0x00000000, 0x406FF000, 0x00000000, 0x407FF800, 0x00000000, 0x408FFC00, 0x00000000, 0x409FFE00
    ])).buffer);
    static readonly ResolutionMaxValues = new Int32Array([
        0x00000000, 0x00000001, 0x00000002, 0x00000003, 0x00000004, 0x00000005, 0x00000006, 0x00000007,
        0x0000000F, 0x0000001F, 0x0000003F, 0x0000007F, 0x000000FF, 0x000001FF, 0x000003FF, 0x000007FF
    ]);
    static readonly IntensityRatioTable = new Float64Array(this.adaptEndianness6432(new Uint32Array([
        0x00000000, 0x40000000, 0x6DB6DB6E, 0x3FFDB6DB, 0xDB6DB6DB, 0x3FFB6DB6, 0x49249249, 0x3FF92492,
        0xB6DB6DB7, 0x3FF6DB6D, 0x24924925, 0x3FF49249, 0x92492492, 0x3FF24924, 0x00000000, 0x3FF00000,
        0xDB6DB6DB, 0x3FEB6DB6, 0xB6DB6DB7, 0x3FE6DB6D, 0x92492492, 0x3FE24924, 0xDB6DB6DB, 0x3FDB6DB6,
        0x92492492, 0x3FD24924, 0x92492492, 0x3FC24924, 0x00000000, 0x00000000
    ])).buffer);
    static readonly IntensityRatioBoundsTable = new Float64Array(this.adaptEndianness6432(new Uint32Array([
        0xB6DB6DB7, 0x3FFEDB6D, 0x24924925, 0x3FFC9249, 0x92492492, 0x3FFA4924, 0x00000000, 0x3FF80000,
        0x6DB6DB6E, 0x3FF5B6DB, 0xDB6DB6DB, 0x3FF36DB6, 0x49249249, 0x3FF12492, 0x6DB6DB6E, 0x3FEDB6DB,
        0x49249249, 0x3FE92492, 0x24924925, 0x3FE49249, 0x00000000, 0x3FE00000, 0xB6DB6DB7, 0x3FD6DB6D,
        0xDB6DB6DB, 0x3FCB6DB6, 0x92492492, 0x3FB24924
    ])).buffer);
    static readonly ScaleConversionTable = new Float64Array(this.adaptEndianness6432(new Uint32Array([
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
        if (size > data.byteLength) throw new Error();
        if (size < 0) throw new Error();
        let sum = 0;
        for (let i = 0; i < size; i++)
            sum = ((sum << 8) ^ this._v[(sum >> 8) ^ data[i]]) & 0x0000ffff;
        return sum & 0x0000ffff;
    }
    static verify(data: Uint8Array, size: number, expected?: number, doNotThrow = false): boolean {
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
    constructor (key1?: any, key2?: any) {
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


// Web Worker / AudioWorklet support

// AudioWorkletProcessor types declaration
// ref: https://github.com/microsoft/TypeScript/issues/28308#issuecomment-650802278
interface AudioWorkletProcessor {
    readonly port: MessagePort;
    process(
        inputs: Float32Array[][],
        outputs: Float32Array[][],
        parameters: Record<string, Float32Array>
    ): boolean;
}
declare var AudioWorkletProcessor: {
    prototype: AudioWorkletProcessor;
    new (options?: AudioWorkletNodeOptions): AudioWorkletProcessor;
};
// ref: https://chromium.googlesource.com/devtools/devtools-frontend/+/f18c0ac2f735bd0b1385398c7e52b8ba01a5d796/node_modules/typescript/lib/lib.dom.d.ts
interface AudioParamDescriptor {
    automationRate?: AutomationRate;
    defaultValue?: number;
    maxValue?: number;
    minValue?: number;
    name: string;
}
// ref: https://github.com/microsoft/TypeScript/issues/28308#issuecomment-757335303
declare function registerProcessor(
    name: string,
    processorCtor: (new (
        options?: AudioWorkletNodeOptions
    ) => AudioWorkletProcessor) & {
        parameterDescriptors?: AudioParamDescriptor[];
    }
): undefined;

// convert non-transferable typed array to transferable array buffer
class HCATransTypedArray {
    readonly type: string;
    readonly buffer: ArrayBuffer;
    readonly byteOffset: number;
    readonly length: number;
    static convert(arg: any, transferList: ArrayBuffer[]): any {
        if (this.getType(arg) != null) return new HCATransTypedArray(arg, transferList);
        else return arg;
    }
    static restore(arg: any): any {
        const type = this.getType(arg);
        if (type != null && type.converted) return (arg as HCATransTypedArray).array;
        else return arg;
    }
    private static getType(arg: any): {type: string, converted: boolean} | undefined {
        if (arg == null || typeof arg !== "object") return undefined;
        else if (arg instanceof Int8Array)    return {converted: false, type: "Int8"};
        else if (arg instanceof Int16Array)   return {converted: false, type: "Int16"};
        else if (arg instanceof Int32Array)   return {converted: false, type: "Int32"};
        else if (arg instanceof Uint8Array)   return {converted: false, type: "Uint8"};
        else if (arg instanceof Uint16Array)  return {converted: false, type: "Uint16"};
        else if (arg instanceof Uint32Array)  return {converted: false, type: "Uint32"};
        else if (arg instanceof Float32Array) return {converted: false, type: "Float32"};
        else if (arg instanceof Float64Array) return {converted: false, type: "Float64"};
        else if (arg.buffer instanceof ArrayBuffer && typeof arg.type === "string") return {converted: true, type: arg.type};
        else return undefined;
    }
    constructor (ta: Int8Array|Int16Array|Int32Array|Uint8Array|Uint16Array|Uint32Array|Float32Array|Float64Array,
        transferList: ArrayBuffer[])
    {
        const type = HCATransTypedArray.getType(ta);
        if (type != null) this.type = type.type;
        else throw new Error("unexpected type");
        this.buffer = ta.buffer;
        this.byteOffset = ta.byteOffset;
        this.length = ta.length;
        if (!transferList.find((val: ArrayBuffer) => val === this.buffer)) transferList.push(this.buffer);
    }
    get array(): Int8Array|Int16Array|Int32Array|Uint8Array|Uint16Array|Uint32Array|Float32Array|Float64Array {
        switch (this.type) {
            case "Int8":    return new Int8Array(this.buffer, this.byteOffset, this.length);
            case "Int16":   return new Int16Array(this.buffer, this.byteOffset, this.length);
            case "Int32":   return new Int32Array(this.buffer, this.byteOffset, this.length);
            case "Uint8":   return new Uint8Array(this.buffer, this.byteOffset, this.length);
            case "Uint16":  return new Uint16Array(this.buffer, this.byteOffset, this.length);
            case "Uint32":  return new Uint32Array(this.buffer, this.byteOffset, this.length);
            case "Float32": return new Float32Array(this.buffer, this.byteOffset, this.length);
            case "Float64": return new Float64Array(this.buffer, this.byteOffset, this.length);
        }
        throw new Error("unexpected type");
    }
}

interface HCATaskHook {
    task?: (task: HCATask) => HCATask | Promise<HCATask> // called before sending cmd & execution
    result?: (result?: any) => any | Promise<any>, // called after execution & receiving reply & reply has result
    error?: (reason?: string) => string | undefined | Promise<string | undefined>, // same as above except it's for errMsg
}

class HCATask {
    isDummy?: boolean;
    readonly origin: string;
    readonly taskID: number;
    readonly cmd: string;
    get args(): any {
        return this._args?.map((arg) => HCATransTypedArray.restore(arg));
    }
    get hasResult(): boolean {
        return this._hasResult;
    }
    get result(): any {
        if (!this._hasResult) throw new Error("no result");
        return HCATransTypedArray.restore(this._result);
    }
    set result(result: any) {
        if (this.hasErr) throw new Error("already has error, cannot set result");
        if (this._hasResult) throw new Error("cannot set result again");
        this._result = HCATransTypedArray.convert(result, this.transferList);
        this._hasResult = true;
        if (!this._replyArgs) delete this._args;
    }
    get hasErr(): boolean {
        return this._errMsg != null;
    }
    get errMsg(): string | undefined {
        return this._errMsg;
    }
    set errMsg(msg: string | undefined) {
        // changing errMsg is allowed, but clearing errMsg is disallowed
        if (typeof msg !== "string") throw new Error("error message must be a string");
        delete this._args;
        if (this._hasResult) {
            // clear result on error
            delete this._result;
            this._hasResult = false;
            this.transferList = [];
            this.args.forEach((arg: any) => HCATransTypedArray.convert(arg, this.transferList));
        }
        this._errMsg = msg;
    }
    transferList: ArrayBuffer[] = [];

    private _args?: any[];
    private _hasResult: boolean = false;
    private _result?: any;
    private _errMsg?: string;
    private readonly _replyArgs: boolean;
    constructor (origin: string, taskID: number, cmd: string, args: any[] | undefined, replyArgs: boolean, isDummy?: boolean) {
        this.origin = origin;
        this.taskID = taskID;
        this.cmd = cmd;
        this._args = args?.map((arg) => HCATransTypedArray.convert(arg, this.transferList));
        this._replyArgs = replyArgs;
        if (isDummy != null && isDummy) this.isDummy = true;
    }
    static recreate(task: HCATask): HCATask {
        const recreated = new HCATask(task.origin, task.taskID, task.cmd, task._args, task._replyArgs);
        if (task._errMsg != null) recreated.errMsg = task._errMsg;
        else if (task._hasResult) recreated.result = task._result;
        return recreated;
    }
}

class HCATaskQueue {
    private readonly origin: string;

    private _isAlive = true;
    private isIdle = true;

    // comparing to structured copy (by default), if data size is big (because of zero-copy),
    // transferring is generally much faster. however it obviously has a drawback,
    // that transferred arguments are no longer accessible in the sender thread
    private transferArgs = false;
    // the receiver/callee will always use transferring to send back arguments,
    // not sending the arguments back is supposed to save a little time/overhead
    private replyArgs = false;

    private readonly postMessage: (msg: any, transfer: Transferable[]) => void;
    private readonly taskHandler: (task: HCATask) => void;
    private readonly destroy: () => void;
    private queue: HCATask[] = [];
    private static readonly maxTaskID = 65535;
    private _lastTaskID = 0;
    private getNextTaskID(): number {
        const max = HCATaskQueue.maxTaskID - 1;
        if (this._lastTaskID < 0 || this._lastTaskID > max) throw new Error("lastTaskID out of range");
        const start = this._lastTaskID + 1;
        for (let i = start; i <= start + max; i++) {
            const taskID = i % (max + 1);
            if (this.callbacks[taskID] == null) return this._lastTaskID = taskID;
        }
        throw new Error("cannot find next taskID");
    }
    private callbacks: Record<number, {
        resolve: (result?: any) => void, reject: (reason?: any) => void,
        hook?: HCATaskHook,
    }> = {};
    private static readonly discardReplyTaskID = -1;

    private sendTask(task: HCATask): void {
        if (task.origin !== this.origin) throw new Error("the task to be sent must have the same origin as the task queue");
        this.postMessage(task, this.transferArgs ? task.transferList : []);
    }

    private sendReply(task: HCATask): void {
        if (task.origin === this.origin) throw new Error("the reply to be sent must not have the same origin as the task queue");
        this.postMessage(task, task.transferList); // always use transferring to send back arguments
    }

    private async sendNextTask(): Promise<void> {
        const task = this.queue.shift();
        if (task == null) {
            this.isIdle = true;
        } else {
            this.isIdle = false;
            if (task.isDummy) {
                // not actually sending, use a fake reply
                task.result = null;
                this.msgHandler(new MessageEvent("message", {data: task})); // won't await
            } else {
                const registered = this.callbacks[task.taskID];
                const taskHook = registered != null && registered.hook != null && registered.hook.task != null
                    ? registered.hook.task
                    : undefined;
                this.sendTask(taskHook != null ? await taskHook(task) : task);
            }
        }
    }

    constructor (origin: string,
        postMessage: (msg: any, transfer: Transferable[]) => void, taskHandler: (task: HCATask) => void,
        destroy: () => void)
    {
        this.origin = origin;
        this.postMessage = postMessage;
        this.taskHandler = taskHandler;
        this.destroy = destroy;
    }

    get isAlive(): boolean {
        return this._isAlive;
    }

    // these following two methods/functions are supposed to be callbacks
    async msgHandler(ev: MessageEvent): Promise<void> {
        try {
            const task = HCATask.recreate(ev.data);
            if (task.origin !== this.origin) {
                // incoming cmd to execute
                try {
                    task.result = await this.taskHandler(task);
                } catch (e) {
                    console.error(`[${this.origin}]`, e);
                    // it's observed that Firefox refuses to postMessage an Error object:
                    // "DataCloneError: The object could not be cloned."
                    // (observed in Firefox 97, not clear about other versions)
                    // Chrome doesn't seem to have this problem,
                    // however, in order to keep compatible with Firefox,
                    // we still have to avoid posting an Error object
                    task.errMsg = `[${this.origin}] error when executing cmd`;
                    if (typeof e === "string" || e instanceof Error) task.errMsg += "\n" + e.toString();
                }
                if (task.taskID != HCATaskQueue.discardReplyTaskID) try {
                    this.sendReply(task);
                } catch (e) {
                    console.error(`[${this.origin}]`, e);
                    task.errMsg = (task.errMsg == null ? "" : task.errMsg + "\n\n") + "postMessage from Worker failed";
                    if (typeof e === "string" || e instanceof Error) task.errMsg += "\n" + e.toString();
                    // try again
                    this.sendReply(task); // if it throws, just let it throw
                }
            } else {
                // receiving cmd result
                // find & unregister callback
                const registered = this.callbacks[task.taskID];
                delete this.callbacks[task.taskID];

                // settle promise
                try {
                    if (task.hasErr) {
                        const errorHook = registered.hook != null ? registered.hook.error : undefined;
                        const errMsg = errorHook != null ? await errorHook(task.errMsg) : task.errMsg;
                        registered.reject(errMsg);
                    } else if (task.hasResult) {
                        const resultHook = registered.hook != null ? registered.hook.result : undefined;
                        const result = resultHook != null ? await resultHook(task.result) : task.result;
                        registered.resolve(result);
                    } else throw new Error(`task (taskID=${task.taskID} cmd=${task.cmd}) has neither error nor result`);
                } catch (e) {
                    console.error(`${this.origin}`, e);
                }

                // start next task
                await this.sendNextTask();
            }
        } catch (e) {
            // irrecoverable error
            this.errHandler(e);
        }
    }
    errHandler(data: any) {
        // irrecoverable error
        // FIXME triggered in background worker, not notifying foreground main thread
        if (this._isAlive) {
            // print error message
            console.error(`[${this.origin}] destroying background worker on error`, data);
            // destroy background worker
            try {
                this.destroy();
            } catch (e) {
                console.error(`[${this.origin}] cannot destroy`, e);
            }
            // set isAlive to false - must be after destroy()
            this._isAlive = false;
            // reject all pending promises
            for (let taskID in this.callbacks) {
                const reject = this.callbacks[taskID].reject;
                delete this.callbacks[taskID];
                try {
                    reject();
                } catch (e) {
                    console.error(`[${this.origin}] error rejecting ${taskID}`, e);
                }
            }
        }
    }

    async getTransferConfig(): Promise<{transferArgs: boolean, replyArgs: boolean}> {
        if (!this._isAlive) throw new Error("dead");
        return await this.execCmd("nop", [], {result: () => ({
            transferArgs: this.transferArgs,
            replyArgs: this.replyArgs
        })});
    }
    async configTransfer(transferArgs: boolean, replyArgs: boolean): Promise<void> {
        if (!this._isAlive) throw new Error("dead");
        return await this.execCmd("nop", [], {result: () => {
            this.transferArgs = transferArgs ? true : false;
            this.replyArgs = replyArgs ? true : false;
        }});
    }

    async execCmd(cmd: string, args: any[], hook?: HCATaskHook): Promise<any> {
        // can be modified to simply wrap execMultiCmd but I just want to let it alone for no special reason
        if (!this._isAlive) throw new Error("dead");
        // assign new taskID
        const taskID = this.getNextTaskID();
        const task = new HCATask(this.origin, taskID, cmd, args, this.replyArgs);
        // register callback
        if (this.callbacks[taskID] != null) throw new Error(`taskID=${taskID} is already occupied`);
        const resultPromise = new Promise((resolve, reject) => this.callbacks[taskID] = {resolve: resolve, reject: reject,
            hook: hook});
        // append to command queue
        this.queue.push(task);
        // start executing tasks
        if (this.isIdle) await this.sendNextTask();
        // return result
        return await resultPromise;
    }

    async execMultiCmd(cmdList: {cmd: string, args: any[], hook?: HCATaskHook}[]): Promise<any[]> {
        // the point is to ensure "atomicity" between cmds
        if (!this._isAlive) throw new Error("dead");
        let resultPromises: Promise<any>[] = [];
        for (let i = 0; i < cmdList.length; i++) {
            // assign new taskID
            const taskID = this.getNextTaskID();
            const listItem = cmdList[i];
            const task = new HCATask(this.origin, taskID, listItem.cmd, listItem.args, this.replyArgs);
            // register callback
            if (this.callbacks[taskID] != null) throw new Error(`taskID=${taskID} is already occupied`);
            resultPromises.push(new Promise((resolve, reject) => this.callbacks[taskID] = {resolve: resolve, reject: reject,
                hook: listItem.hook}));
            // append to command queue
            this.queue.push(task);
        }
        // start executing tasks
        if (this.isIdle) await this.sendNextTask();
        // return results
        return await Promise.all(resultPromises);
    }

    sendCmd(cmd: string, args: any[]): void {
        // send cmd without registering callback
        // generally not recommended
        if (!this._isAlive) throw new Error("dead");
        const task = new HCATask(this.origin, HCATaskQueue.discardReplyTaskID, cmd, args, false);
        this.sendTask(task);
    }

    async shutdown(): Promise<void> {
        if (this._isAlive) {
            await this.execCmd("nop", [], {result: () => {
                this.destroy();
                this._isAlive = false;
            }});
        }
    }
}

interface HCAFramePlayerProcessorOptions {
    rawHeader: Uint8Array,
    pullBlockCount?: number,
}

if (typeof document === "undefined") {
    if (typeof onmessage === "undefined") {
        // AudioWorklet
        class HCAFramePlayerContext {
            readonly defaultPullBlockCount = 128;
            pullBlockCount: number;

            frame: HCAFrame;

            // if loop header exists, all blocks (up to loop end) are stored in encoded buffer,
            // otherwise, only 2 * pullBlockCount blocks are stored in encoded buffer
            encoded: Uint8Array;
            totalPulledBlockCount = 0;
            isPulling = false;
            get isStalling(): boolean {
                return this._isStalling;
            }
            set isStalling(val: boolean) {
                this._isStalling = val;
                if (val) this.onceStalled = true;
            }
            private _isStalling = false;
            onceStalled = false;

            // two blocks are stored in decoded buffer
            decoded: Float32Array[];
            sampleOffset = 0;
            lastDecodedBlockIndex = -1;

            constructor(procOpts: HCAFramePlayerProcessorOptions) {
                this.frame = new HCAFrame(new HCAInfo(procOpts.rawHeader));
                const info = this.frame.Hca;
                const hasLoop = info.hasHeader["loop"] ? true : false;

                if (typeof procOpts.pullBlockCount === "number") {
                    if (isNaN(procOpts.pullBlockCount)) throw new Error();
                    let pullBlockCount = Math.floor(procOpts.pullBlockCount);
                    if (pullBlockCount < 2) throw new Error();
                    this.pullBlockCount = pullBlockCount;
                } else this.pullBlockCount = this.defaultPullBlockCount;
                const bufferedBlockCount = hasLoop ? (info.loop.end + 1) : this.pullBlockCount * 2;
                this.encoded = new Uint8Array(info.blockSize * bufferedBlockCount);
                this.decoded = Array.from(
                    {length: info.format.channelCount},
                    () => new Float32Array(HCAFrame.SamplesPerFrame * 2)
                );
            }
        }
        class HCAFramePlayer extends AudioWorkletProcessor {
            private shutdown = false;

            private ctx?: HCAFramePlayerContext;
            private unsettled: {resolve: (result?: any) => void, counter: number}[] = [];

            private readonly taskQueue: HCATaskQueue;

            constructor (options: AudioWorkletNodeOptions | undefined) {
                super();

                if (options == null || options.processorOptions == null) throw new Error();
                this.ctx = new HCAFramePlayerContext(options.processorOptions);

                this.taskQueue = new HCATaskQueue("Background-HCAFramePlayer",
                    (msg: any, trans: Transferable[]) => this.port.postMessage(msg, trans),
                    async (task: HCATask) => {
                        switch (task.cmd) {
                            case "nop":
                                return;
                            case "shutdown":
                                this.shutdown = true;
                                break;
                            case "initialize":
                                this.ctx = new HCAFramePlayerContext(task.args[0]);
                                break;
                            case "reset":
                                await new Promise((resolve) => {
                                    delete this.ctx;
                                    this.unsettled.push({resolve: resolve, counter: 16});
                                });
                                break;
                            default:
                                throw new Error(`unknown cmd ${task.cmd}`);
                        }
                    },
                    () => {} // cannot destroy the caller/controller, which is the foreground main thread
                );
                this.taskQueue.configTransfer(true, false);
                this.port.onmessage = (ev: MessageEvent) => this.taskQueue.msgHandler(ev);
            }

            private pullNewBlocks(ctx: HCAFramePlayerContext): void {
                // if ctx passed in had been actually deleted, it won't affect the current using ctx
                if (ctx.isPulling) return; // already pulling. will be called again if still not enough
                ctx.isPulling = true;
                // request to pull & continue decoding
                // won't wait for result here, just let resolveHook handle it
                this.taskQueue.execCmd("pull", [], {result: (newBlocks: Uint8Array) => {
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
                    } else {
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
                }});
            }

            private writeToDecodedBuffer(frame: HCAFrame, decoded: Float32Array[]): void {
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
                        if (lastHalf[i] > 1) lastHalf[i] = 1;
                        else if (lastHalf[i] < -1) lastHalf[i] = -1;
                    }
                }
            }

            private mapToUnLooped(info: HCAInfo, sampleOffset: number): number {
                const hasLoop = info.hasHeader["loop"] ? true : false;
                if (sampleOffset <= info.endAtSample) {
                    return sampleOffset;
                } else {
                    if (hasLoop) {
                        let offset = (sampleOffset - info.loopStartAtSample) % info.loopSampleCount;
                        return info.loopStartAtSample + offset;
                    } else {
                        return info.endAtSample;
                    }
                }
            }

            process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: AudioWorkletNodeOptions) {
                if (this.shutdown) {
                    this.port.close();
                    return false;
                }
                if (this.ctx == null) {
                    // workaround the "residue" burst noise issue in Chrome
                    const unsettled = this.unsettled.shift();
                    if (unsettled != null) {
                        if (--unsettled.counter > 0) this.unsettled.unshift(unsettled);
                        else try {
                            unsettled.resolve();
                        } catch (e) {
                            console.error(`error when settling promise of "reset" cmd`);
                        }
                    }
                    return true; // wait for new source
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
                if (!hasLoop && this.ctx.sampleOffset >= info.endAtSample) {
                    // nothing more to play
                    this.taskQueue.sendCmd("end", []); // not waiting for result
                    delete this.ctx; // avoid sending "end" cmd for more than one time
                    return true;
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
                        if (end > encoded.length) throw new Error("block end offset exceeds buffer size");
                        HCA.decodeBlock(this.ctx.frame, encoded.subarray(start, end));
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
                    } else {
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
                if (output.length != info.format.channelCount) throw new Error("channel count mismatch");
                const inBufferStartOffset = (endBlockIndex != startBlockIndex ? 0 : samplesPerBlock) + inBlockStartOffset;
                const inBufferEndOffset = samplesPerBlock + inBlockEndOffset;
                const inBufferSrcSize = inBufferEndOffset - inBufferStartOffset;
                if (inBufferSrcSize <= 0) throw new Error("size in decoded buffer should be positive");
                const copySize = Math.min(inBufferSrcSize, renderQuantumSize);
                for (let channel = 0; channel < output.length; channel++) {
                    let src = decoded[channel].subarray(inBufferStartOffset, inBufferStartOffset + copySize);
                    output[channel].set(src);
                }
                this.ctx.sampleOffset += copySize;
                if (hasLoop && this.ctx.sampleOffset > info.endAtSample) {
                    // it's possible for sampleOffset to overflow because loop is infinite
                    // rewinding it back to prevent overflow
                    // (however, Number.MAX_SAFE_INTEGER seems to be able to handle about 64.7 centuries under 44.1kHz)
                    this.ctx.sampleOffset = this.mapToUnLooped(info, this.ctx.sampleOffset);
                }
                return true;
            }
        }
        registerProcessor("hca-frame-player", HCAFramePlayer);
    } else {
        // Web Worker
        const taskQueue = new HCATaskQueue("Background-HCAWorker",
            (msg: any, trans: Transferable[]) => (postMessage as any)(msg, trans),
            (task: HCATask) => {
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
            },
            () => {} // cannot destroy the caller/controller, which is the foreground main thread
        );
        onmessage = (ev: MessageEvent) => taskQueue.msgHandler(ev);
    }
}

// create & control audio worklet
class HCAAudioWorkletHCAPlayer {
    get isAlive(): boolean {
        return this.taskQueue.isAlive;
    }
    private isPlaying = false;

    private source?: Uint8Array | ReadableStreamDefaultReader<Uint8Array>;
    private srcBuf?: Uint8Array;
    private info: HCAInfo;
    private hasLoop: boolean;
    private cipher?: HCACipher;

    private verifyCsum = false;
    get blockChecksumVerification() {
        return this.verifyCsum;
    }
    set blockChecksumVerification(val: boolean) {
        if (typeof val !== "boolean") throw new Error();
        this.verifyCsum = val;
    }

    private readonly feedBlockCount: number;
    private get feedSize(): number {
        return this.info.blockSize * this.feedBlockCount;
    }
    private totalFedBlockCount = 0;
    private get remainingBlockCount(): number {
        let total = this.hasLoop ? this.info.loop.end + 1 : this.info.format.blockCount;
        let remaining = total - this.totalFedBlockCount;
        if (remaining <= 0) throw new Error();
        return remaining;
    }

    private get downloadBufferSize(): number {
        const bytesPerSec = this.info.kbps * 1000 / 8;
        return bytesPerSec * 4;
    }

    private readonly selfUrl: URL;
    readonly sampleRate: number;
    readonly channelCount: number;
    private readonly audioCtx: AudioContext;
    private readonly hcaPlayerNode: AudioWorkletNode;
    private readonly gainNode: GainNode;

    private readonly taskQueue: HCATaskQueue;

    private async taskHandler(task: HCATask): Promise<Uint8Array | undefined> {
        switch (task.cmd) {
            case "nop":
                return;
            case "end":
                await this.stop();
                return; // actually not sending back reply
            case "pull":
                if (this.source == null) throw new Error(`nothing to feed`); // should never happen
                let blockCount = Math.min(this.feedBlockCount, this.remainingBlockCount);
                let size = this.info.blockSize * blockCount;
                let newBlocks: Uint8Array;
                if (this.source instanceof Uint8Array) {
                    // whole HCA mode
                    let start = this.info.dataOffset + this.info.blockSize * this.totalFedBlockCount;
                    let end = start + size;
                    newBlocks = this.source.subarray(start, end);
                //} else if (this.source instanceof ReadableStreamDefaultReader) {
                // commented out because Firefox throws "ReferenceError: ReadableStreamDefaultReader is not defined"
                } else {
                    // URL mode
                    if (this.srcBuf == null) throw new Error("srcBuf is undefined");
                    let maxDownlaodSize = this.info.blockSize * this.remainingBlockCount;
                    let downloadSize = Math.max(this.downloadBufferSize, size);
                    downloadSize = Math.min(downloadSize, maxDownlaodSize);
                    let remaining = downloadSize - this.srcBuf.length;
                    if (remaining > 0) {
                        this.srcBuf = await HCAAudioWorkletHCAPlayer.readAndAppend(this.source, this.srcBuf, remaining);
                    }
                    if (this.srcBuf.length < size) throw new Error("srcBuf still smaller than expected");
                    newBlocks = this.srcBuf.subarray(0, size);
                    this.srcBuf = this.srcBuf.slice(size);
                }
                for (let i = 0, start = 0; i < blockCount; i++, start += this.info.blockSize) {
                    let block = newBlocks.subarray(start, start + this.info.blockSize);
                    // verify checksum (if enabled)
                    // will throw & stop playing on mismatch!
                    if (this.verifyCsum) HCACrc16.verify(block, this.info.blockSize - 2);
                    // decrypt (if encrypted)
                    if (this.cipher != null) this.cipher.mask(block, 0, this.info.blockSize - 2);
                    // fix checksum
                    HCACrc16.fix(block, this.info.blockSize - 2);
                }
                if (this.hasLoop) {
                    // just copy, no need to enlarge
                    newBlocks = newBlocks.slice();
                } else {
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
    }

    static async create(selfUrl: URL, source: Uint8Array | URL, feedByteMax = 32768): Promise<HCAAudioWorkletHCAPlayer> {
        if (!(selfUrl instanceof URL)) throw new Error();
        if (!(source instanceof Uint8Array || source instanceof URL)) throw new Error();
        if (typeof feedByteMax !== "number" || isNaN(feedByteMax)) throw new Error();

        let actualSource: Uint8Array | ReadableStreamDefaultReader<Uint8Array>;
        let info: HCAInfo;
        let srcBuf: Uint8Array | undefined = undefined;
        if (source instanceof Uint8Array) {
            actualSource = source;
            info = new HCAInfo(source);
        } else if (source instanceof URL) {
            const fetched = await this.getHCAInfoFromURL(source);
            actualSource = fetched.reader;
            info = fetched.info;
            srcBuf = fetched.buffer;
        } else throw Error();
        feedByteMax = Math.floor(feedByteMax);
        if (feedByteMax < info.blockSize) throw new Error();
        feedByteMax -= feedByteMax % info.blockSize;
        const feedBlockCount = feedByteMax / info.blockSize;
        // create audio context
        const audioCtx = new AudioContext({
            latencyHint: "playback",
            sampleRate: info.format.samplingRate,
        });
        // create audio worklet node (not yet connected)
        await audioCtx.audioWorklet.addModule(selfUrl);
        const options: AudioWorkletNodeOptions = {
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
        // suspend audio context for now
        await audioCtx.suspend();
        // create controller object
        return new HCAAudioWorkletHCAPlayer(selfUrl, audioCtx, hcaPlayerNode, gainNode, feedBlockCount,
            info, actualSource, srcBuf);
    }

    async destroy(): Promise<void> {
        if (!this.isAlive) {
            console.error("already died");
            return;
        }
        try {
            this.taskQueue.sendCmd("shutdown", []); // not waiting for result
        } catch (e) {
            console.error(`cannot send shutdown cmd`);
        }
        try {
            this.hcaPlayerNode.port.close();
        } catch (e) {
            console.error(`cannot close message port`);
        }
        try {
            this.hcaPlayerNode.disconnect();
        } catch (e) {
            console.error(`cannot disconnect hcaPlayerNode`);
        }
        try {
            this.gainNode.disconnect();
        } catch (e) {
            console.error(`cannot disconnect gainNode`);
        }
        try {
            await this.audioCtx.close();
        } catch (e) {
            console.error(`cannot close audio context`);
        }
    }

    private constructor(selfUrl: URL, audioCtx: AudioContext, hcaPlayerNode: AudioWorkletNode, gainNode: GainNode, feedBlockCount: number,
        info: HCAInfo, source: Uint8Array | ReadableStreamDefaultReader<Uint8Array>, srcBuf?: Uint8Array)
    {
        this.selfUrl = selfUrl;
        this.audioCtx = audioCtx;
        this.taskQueue = new HCATaskQueue("Main-HCAAudioWorkletHCAPlayer",
            (msg: any, trans: Transferable[]) => hcaPlayerNode.port.postMessage(msg, trans),
            (task: HCATask) => this.taskHandler(task),
            () => this.destroy());
        hcaPlayerNode.port.onmessage = (ev) => this.taskQueue.msgHandler(ev);
        hcaPlayerNode.port.onmessageerror = (ev) => this.taskQueue.errHandler(ev);
        hcaPlayerNode.onprocessorerror = (ev) => this.taskQueue.errHandler(ev);
        this.hcaPlayerNode = hcaPlayerNode;
        this.gainNode = gainNode;
        this.feedBlockCount = feedBlockCount;
        this.info = info;
        this.source = source;
        this.srcBuf = srcBuf;
        this.sampleRate = info.format.samplingRate;
        this.channelCount = info.format.channelCount;
        this.hasLoop = info.hasHeader["loop"] ? true : false;
    }

    setDecryptionKey(key1?: any, key2?: any): void {
        if (!this.isAlive) throw new Error("dead");
        switch (this.info.cipher) {
            case 0:
                // not encrypted
                this.cipher = undefined;
                break;
            case 1:
                // encrypted with "no key"
                this.cipher = new HCACipher("none"); // ignore given keys
                break;
            case 0x38:
                // encrypted with keys - will yield incorrect waveform if incorrect keys are given!
                this.cipher = new HCACipher(key1, key2);
                break;
            default:
                throw new Error("unknown ciph.type");
        }
    }

    private static async readAndAppend(reader: ReadableStreamDefaultReader<Uint8Array>,
        data: Uint8Array, minCount: number): Promise<Uint8Array>
    {
        if (minCount < 0) throw new Error();
        const desired = data.length + minCount;
        let newData = new Uint8Array(desired);
        newData.set(data);
        for (let offset = data.length; offset < desired; ) {
            const res = await reader.read();
            if (res.done) throw new Error();
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
    }

    private static async getHCAInfoFromURL(url: URL): Promise<{
        reader: ReadableStreamDefaultReader<Uint8Array>,
        info: HCAInfo,
        buffer: Uint8Array,
    }> {
        // FIXME send HTTP Range request to avoid blocking later requests (especially in Firefox)
        const resp = await fetch(url.href);
        if (resp.status != 200) throw new Error(`status ${resp.status}`);
        if (resp.body == null) throw new Error("response has no body");
        const reader = resp.body.getReader();
        let buffer = await this.readAndAppend(reader, new Uint8Array(0), 8);
        const dataOffset = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getUint16(6);
        const remaining = dataOffset - buffer.length;
        if (remaining > 0) {
            buffer = await this.readAndAppend(reader, buffer, remaining);
        }
        return {
            reader: reader,
            info: new HCAInfo(buffer),
            buffer: buffer.slice(dataOffset),
        };
    }

    async setSource(source: Uint8Array | URL): Promise<void> {
        let newInfo: HCAInfo;
        let newSource: Uint8Array | ReadableStreamDefaultReader<Uint8Array>;
        let newBuffer: Uint8Array | undefined = undefined;
        const initializeCmdItem = {cmd: "initialize", args: [null], hook: {
            task: async (task: HCATask) => {
                if (!this.isAlive) throw new Error("dead");
    
                const oldSource = this.source;
                //if (oldSource instanceof ReadableStreamDefaultReader) {
                if (oldSource != null && !(oldSource instanceof Uint8Array)) {
                    try {
                        await oldSource.cancel(); // stop downloading from previous URL
                    } catch (e) {
                        console.error(`error when cancelling previous download`);
                    }
                }
    
                if (source instanceof Uint8Array) {
                    newSource = source;
                    newInfo = new HCAInfo(source);
                } else if (source instanceof URL) {
                    try {
                        const result = await HCAAudioWorkletHCAPlayer.getHCAInfoFromURL(source);
                        newSource = result.reader;
                        newInfo = result.info;
                        newBuffer = result.buffer;
                    } catch (e) {
                        throw e;
                    }
                } else throw new Error("invalid source");
    
                // sample rate and channel count is immutable,
                // therefore, the only way to change them is to recreate a new instance.
                // however, there is a memleak bug in Chromium, that:
                // (no-longer-used) audio worklet node(s) won't be recycled:
                // https://bugs.chromium.org/p/chromium/issues/detail?id=1298955
                if (newInfo.format.samplingRate != this.sampleRate)
                    throw new Error("sample rate mismatch");
                if (newInfo.format.channelCount != this.channelCount)
                    throw new Error("channel count mismatch");
    
                await this._play(); // resume it, so that cmd can then be executed
    
                const newProcOpts = {
                    rawHeader: newInfo.getRawHeader(),
                    pullBlockCount: this.feedBlockCount,
                };
                return new HCATask(task.origin, task.taskID, task.cmd, [newProcOpts], false);
            }, result: () => {
                this.totalFedBlockCount = 0;
                this.info = newInfo;
                this.source = newSource;
                this.srcBuf = newBuffer;
                this.hasLoop = newInfo.hasHeader["loop"] ? true : false;
            }
        }}
        await this.taskQueue.execMultiCmd([this.stopCmdItem, initializeCmdItem]); // ensure atomicity
    }

    // not supposed to be used directly
    private async _play(): Promise<void> {
        if (!this.isAlive) throw new Error("dead");
        if (this.isPlaying) return;
        if (this.source == null) throw new Error("nothing to play");
        await this.audioCtx.resume();
        this.hcaPlayerNode.connect(this.gainNode);
        this.gainNode.connect(this.audioCtx.destination);
        this.isPlaying = true;
    }
    private async _pause(): Promise<void> {
        if (!this.isAlive) throw new Error("dead");
        if (!this.isPlaying) return;
        this.hcaPlayerNode.disconnect();
        this.gainNode.disconnect();
        await this.audioCtx.suspend();
        this.isPlaying = false;
    }
    private readonly stopCmdItem = {
        // exec "reset" cmd first, in order to avoid "residue" burst noise to be played in the future (observed in Chrome)
        cmd: "reset", args: [], hook: {
            task: async (task: HCATask) => {
                if (!this.isAlive) throw new Error("dead");
                if (!this.isPlaying) await this._play();
                return task;
            },
            result: async () => {
                await this._pause(); // can now suspend
            },
        }
    }

    // wrap with dummy task, in order to ensure atomicity
    async pause(): Promise<void> {
        await this.taskQueue.execCmd("nop", [], {task: (task) => {
            task.isDummy = true; return task;
        }, result: async () => {
            await this._pause();
        }});
    }
    async play(): Promise<void> {
        await this.taskQueue.execCmd("nop", [], {task: (task) => {
            task.isDummy = true; return task;
        }, result: async () => {
            await this._play();
        }});
    }
    // not a dummy task, but similarly, wrapped to ensure atomicity
    async stop(): Promise<void> {
        const item = this.stopCmdItem;
        await this.taskQueue.execCmd(item.cmd, item.args, item.hook);
    }
}

// create & control worker
class HCAWorker {
    get isAlive(): boolean {
        return this.taskQueue.isAlive;
    }
    private readonly selfUrl: URL;
    private readonly taskQueue: HCATaskQueue;
    private hcaWorker: Worker;
    private awHcaPlayer?: HCAAudioWorkletHCAPlayer;
    private lastTick = 0;
    async shutdown(): Promise<void> {
        if (this.taskQueue.isAlive) {
            await this.taskQueue.shutdown();
            if (this.awHcaPlayer != null) this.awHcaPlayer.destroy();
        }
    }
    async tick(): Promise<void> {
        await this.taskQueue.execCmd("nop", []);
        this.lastTick = new Date().getTime();
    }
    async tock(text = ""): Promise<number> {
        await this.taskQueue.execCmd("nop", []);
        const duration = new Date().getTime() - this.lastTick;
        console.log(`${text} took ${duration} ms`);
        return duration;
    }
    static async create(selfUrl: URL | string): Promise<HCAWorker> {
        if (typeof selfUrl === "string") selfUrl = new URL(selfUrl, document.baseURI);
        else if (!(selfUrl instanceof URL)) throw new Error("selfUrl must be either string or URL");
        // fetch & save hca.js as blob in advance, to avoid creating worker being blocked later, like:
        // (I observed this problem in Firefox)
        // creating HCAAudioWorkletHCAPlayer requires information from HCA, which is sample rate and channel count;
        // however, fetching HCA (originally supposed to be progressive/streamed) blocks later request to fetch hca.js,
        // so that HCAAudioWorkletHCAPlayer can only be created after finishing downloading the whole HCA,
        // which obviously defeats the purpose of streaming HCA
        const response = await fetch(selfUrl.href);
        const blob = await response.blob();
        selfUrl = new URL(URL.createObjectURL(blob));
        return new HCAWorker(selfUrl);
    }
    private constructor (selfUrl: URL) {
        this.hcaWorker = new Worker(selfUrl);
        this.selfUrl = selfUrl;
        this.taskQueue = new HCATaskQueue("Main-HCAWorker",
            (msg: any, trans: Transferable[]) => this.hcaWorker.postMessage(msg, trans),
            () => {},
            () => this.hcaWorker.terminate());
        this.hcaWorker.onmessage = (msg) => this.taskQueue.msgHandler(msg);
        this.hcaWorker.onerror = (msg) => this.taskQueue.errHandler(msg);
        this.hcaWorker.onmessageerror = (msg) => this.taskQueue.errHandler(msg);
    }
    // commands
    async getTransferConfig(): Promise<{transferArgs: boolean, replyArgs: boolean}> {
        return await this.taskQueue.getTransferConfig();
    }
    async configTransfer(transferArgs: boolean, replyArgs: boolean): Promise<void> {
        return await this.taskQueue.configTransfer(transferArgs, replyArgs);
    }
    async fixHeaderChecksum(hca: Uint8Array): Promise<Uint8Array> {
        return await this.taskQueue.execCmd("fixHeaderChecksum", [hca]);
    }
    async fixChecksum(hca: Uint8Array): Promise<Uint8Array> {
        return await this.taskQueue.execCmd("fixChecksum", [hca]);
    }
    async decrypt(hca: Uint8Array, key1?: any, key2?: any): Promise<Uint8Array> {
        return await this.taskQueue.execCmd("decrypt", [hca, key1, key2]);
    }
    async encrypt(hca: Uint8Array, key1?: any, key2?: any): Promise<Uint8Array> {
        return await this.taskQueue.execCmd("encrypt", [hca, key1, key2]);
    }
    async addHeader(hca: Uint8Array, sig: string, newData: Uint8Array): Promise<Uint8Array> {
        return await this.taskQueue.execCmd("addHeader", [hca, sig, newData]);
    }
    async addCipherHeader(hca: Uint8Array, cipherType?: number): Promise<Uint8Array> {
        return await this.taskQueue.execCmd("addCipherHeader", [hca, cipherType]);
    }
    async decode(hca: Uint8Array, mode = 32, loop = 0, volume = 1.0): Promise<Uint8Array> {
        return await this.taskQueue.execCmd("decode", [hca, mode, loop, volume]);
    }
    async playWholeHCA(hca: Uint8Array, key1?: any, key2?: any): Promise<void> {
        if (this.awHcaPlayer == null) {
            this.awHcaPlayer = await HCAAudioWorkletHCAPlayer.create(this.selfUrl, hca);
        } else {
            await this.awHcaPlayer.setSource(hca);
        }
        this.awHcaPlayer.setDecryptionKey(key1, key2);
        await this.awHcaPlayer.play();
    }
    async playHCAFromURL(url: URL | string, key1?: any, key2?: any): Promise<void> {
        if (typeof url === "string") url = new URL(url, document.baseURI);
        if (this.awHcaPlayer == null) {
            this.awHcaPlayer = await HCAAudioWorkletHCAPlayer.create(this.selfUrl, url);
        } else {
            await this.awHcaPlayer.setSource(url);
        }
        this.awHcaPlayer.setDecryptionKey(key1, key2);
        await this.awHcaPlayer.play();
    }
    async pausePlaying(): Promise<void> {
        if (this.awHcaPlayer == null) throw new Error();
        await this.awHcaPlayer.pause();
    }
    async resumePlaying(): Promise<void> {
        if (this.awHcaPlayer == null) throw new Error();
        await this.awHcaPlayer.play();
    }
    async stopPlaying(): Promise<void> {
        if (this.awHcaPlayer == null) throw new Error();
        await this.awHcaPlayer.stop();
    }
}