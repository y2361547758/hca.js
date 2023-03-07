# HCA.js

TypeScript port of [VGAudio](https://github.com/Thealexbarney/VGAudio)'s and [vgmstream](https://github.com/vgmstream/vgmstream)'s HCA codec

Some parts are ported from [HCADecoder](https://github.com/Nyagamon/HCADecoder.git)

Decrypt & decode hca(2.0) file in browser.

# Functions

- [x] HCA 3.0
- [x] HCA 2.0
- [ ] HCA 1.3
- [x] unpack awb
- [x] a/b Keys
- [x] subkey
- [x] decrypt
- [x] test and find decryption key
- [x] decode
- [x] wave mode (8/16/24/32/float)
- [x] loop
- [x] volume
- [ ] encode
- [x] encrypt
- [ ] recode (ogg/aac/mp3/flac)
- [ ] FFT/DCT/DCTM/IDCTM (?)

# Demo

[oneclick.html](/oneclick.html)

[hca.html](/hca.html)

Standalone version (can be saved for offline use): [hca-standalone.html](/hca-standalone.html)

# Raw APIs

**Generally not recommended:** when called in the foreground main thread, raw APIs block the main thread for significant time (1000-1200ms for an 1.3MB HCA file being decrypted and decoded)

**Generally [HCAWorker](#web-worker-apis) APIs below are recommended.**

## Static raw APIs

Static methods can be directly called without creating an instance, like:

```JavaScript
let decryptedHca = HCA.decrypt(hca, "defaultkey");
let wav = HCA.decode(decryptedHca);
```

### `HCA.decrypt(hca: Uint8Array, key1?: any, key2?: any, subkey?: any): Uint8Array`
### `HCA.encrypt(hca: Uint8Array, key1?: any, key2?: any, subkey?: any): Uint8Array`

Decrypt/encrypt & return the whole HCA file **in-place** with specified keys - in other words, if you don't want the input HCA    to be overwritten, you must pass in something like `hca.slice(0)`, which makes a new copy in a newly allocated buffer.

 - `key1` is lower 32 bits of the keycode, which is **not optional**.

   1. If `key2` is not given, it defaults to zero.

   2. If `key1` is `"nokey"` or `"defaultkey"`, `key2` is then ignored. Setting `key1` to `"nokey"` means the encryption/decryption should be done in \"no key\" mode. Setting `key1` to `"defaultkey"` means the hard-coded default keys (allegedly for Magia Record) should be used for encryption/decryption.

   3. `subkey` is ignored if set to zero.

   4. `subkey` is only applied with cipher type `0x38` for now.

 - **Already-encrypted HCA cannot be directly re-encrypted.** You may check whether an HCA is already encrypted with something    like:

   ```JavaScript
   let info = new HCAInfo(hca);
   let isAlreadyEncrypted = info.hasHeader["ciph"] && info.cipher != 0;
   ```

   ...or just decrypt it before re-encrypting, because **decrypting an already-unencrypted HCA is okay.** 

 - **Unencrypted HCA which lacks `ciph` header section cannot be directly encrypted.** See [HCAInfo.addCipherHeader](#hcainfoaddcipherheaderhca-uint8array-ciphertype-number--undefined--undefined-uint8array) below.

 - **Checksums will be verified in the process, and `Error` will be thrown on any mismatch.**

### `HCA.findKey(hca: Uint8Array, givenKeyList?: [any, any][], subkey?: any, threshold = 0.5, depth = 1024): [number, number] | undefined`

Test and find valid decryption key.

 - `givenKeyList` is optional. If given, it should be an array of `[key1, key2]`.
 
 An example `givenKeyList`:
 
 ```JavaScript
 [
   [0x01395C51, 0x00000000], // Magia Record
   [0x8ECED447, 0x6615518E], // Heaven Burns Red (Android)
 ]
 ```
 
 - A built-in known key list will always be included regardless whether `givenKeyList` is given or not.

 - For explanation of `key1`, `key2`, `subkey`, please refer to [HCA.decrypt](#hcadecrypthca-uint8array-key1-any-key2-any-subkey-any-uint8array)/[HCA.encrypt](#hcaencrypthca-uint8array-key1-any-key2-any-subkey-any-uint8array) above.
 
 - This method will search for `depth` HCA blocks, 1024 by default.
 
 - If `threshold` percentage (50% by default) of blocks can be decrypted and unpacked, the found key will be returned as `[key1, key2]`. Otherwise, `undefined` will be returned.

### `HCA.decode(hca: Uint8Array, mode = 32, loop = 0, volume = 1.0): Uint8Array`

Return decoded (Windows PCM) WAV of the input whole HCA file. **The input HCA must be unencrypted, otherwise `Error` will be thrown.**

 - `mode` argument

   `mode` is optional, by default it's set to 32. Valid `mode` values includes:

   - 0

     32-bit **float** PCM mode

   - 8/16/24/32

     8/16/24/32-bit **integer** PCM mode

     *Note: according to the standard, only 8-bit mode uses **unsigned** integer, while modes with more bits (like 16-bit) use **signed** integer.*

 - `loop` argument

   HCA make use of `loop` header section to record which part of the audio should be looped, for how many times.

   `loop` argument is optional, and it is meaningful only if the input HCA has `loop` header. `loop` simply indicates how many times the looped part of audio should be inserted. For example, with `loop` set to `2`, the resulting WAV audio will be like:

   | Beginning part | Looped part | 1st inserted Looped part | 2nd inserted Looped part | Ending part |
   |-----|-----|-----|-----|-----|

   Setting `loop` argument to 0 indicates the output WAV will just contain the decoded audio from the beginning to the end, without any looped part inserted, like:

   | Beginning part | Originally supposed looped part | Ending part |
   |-----|-----|-----|

 - **Checksums will be verified in the process, and `Error` will be thrown on any mismatch.**

### `HCA.fixChecksum(hca: Uint8Array): Uint8Array`

 - Set checksums of HCA header and all blocks to recalculated actual value, **in-place**. Pass in something like `hca.slice(0)` if you don't want the input HCA to be overwritten.
 
 - Return the modifed HCA.

### `HCAInfo.addCipherHeader(hca: Uint8Array, cipherType?: number): Uint8Array`

 - Return a new HCA **in a newly allocated buffer** which is the input HCA with a newly added `ciph` header section.

 - There might be some HCA files which lacks `ciph` header section. Since [HCA.encrypt](#hcaencrypthca-uint8array-key1-any-key2-any-subkey-any-uint8array) is supposed to be in-place, combining with the fact that the size of `ArrayBuffer` in JavaScript cannot be adjusted, you must manually add the `ciph` header section back before encrypting it.

 - **Throw `Error` if an existing `ciph` header section is already present.** Please check it with something like `new HCAInfo(hca).hasHeader["ciph"]` first.

### `HCAInfo.addHeader(hca: Uint8Array, sig: string, newData: Uint8Array): Uint8Array`

 - Return a new HCA **in a newly allocated buffer**, which is the input HCA with newly added header section. The newly added header section has specified `sig` and `newData`.

 - Just like above, **Throw `Error` if an existing header section is already present.** Please check it with `new HCAInfo(hca).hasHeader[SIG]` first.

### `HCAInfo.fixHeaderChecksum(hca: Uint8Array): Uint8Array`

 - Set the checksum of HCA **header** to recalculated actual value, **in-place**. Pass in something like `hca.slice(0)` if you don't want the input HCA to be overwritten.

 - Return the modifed HCA.

## Non-static raw APIs

Non-static methods can only be called after creating an instance, like:

```JavaScript
let hcaInfoInstance = new HCAInfo(hca);
let hasCiphHeader = hcaInfoInstance.hasHeader["ciph"];
```

### `new HCAInfo(hca: Uint8Array, changeMask: boolean = false, encrypt: boolean = false)`

 - Return an `HCAInfo` instance (referred as `hcaInfoInstance` below) which contains various information parsed from HCA headers.

 - It's observed that in encrypted HCAs, header section sigs like `HCA`, `fmt`, `ciph` etc are `OR`'ed with `0x80` (in other words, **masked/unmasked**), which should be a kind of disguise/obfusication. **When `changeMask` is set to `true`, the input HCA will be overwritten, with each byte of its header sigs:**

   1. **`OR`'ed with `0x80`(if `encrypt` is set to `true`);**

   2. **`AND`'ed with `0x7F` (if `encrypt` is set to `false`).**

 - **Otherwise (when `changeMask` is set to `false` or omitted), the input HCA won't be changed.**

 - **Throw `Error` if the input `hca` buffer has inconsistent checksum of its header, or just doesn't actually contains valid HCA data - however, this is determined by very rough method.**;

### `hcaInfoInstance.hasHeader[SIG]: boolean`

 - Indicates whether specified header `SIG` (like `"fmt"`, `"loop"` etc) exists, `true` if exists, othewrise (typically `undefined`) if not.

### `hcaInfoInstance.modify(hca: Uint8Array, sig: string, newData: Uint8Array): void`

 - Modify header section of specified `hca` **in-place** according to specified `sig` and `newData`.
 
 - Nothing will be returned.

### `hcaInfoInstance.clone(): HCAInfo`

 - Returns a clone/copy of existing `hcaInfoInstance`.

# Web Worker APIs

**Web Worker APIs are generally recommended because they do the computational job in a background [Worker](https://developer.mozilla.org/en-US/docs/Web/API/Worker) thread, which won't block the foreground main thread.**

For example, you may decrypt & decode a HCA (as `Uint8Array`) like:

```JavaScript
async function decryptAndDecode(hca) {
    const hcaUrl = new URL("hca.js", document.baseURI);
    let worker = await HCAWorker.create(hcaUrl);
    let decrypted = await worker.decrypt(hca.slice(0), "defaultkey");
    let wav = await worker.decode(decrypted, 16);
    await worker.shutdown();
    return wav;
}
```

### `async HCAWorker.create(selfUrl: URL | string): Promise<HCAWorker>`

 - Return a new `HCAWorker` instance (referred as `hcaWorkerInstance` below), which is generally used in **main thread** to **control** a `Worker` running `hca.js`, so that computational jobs can be done in background without blocking the foreground main thread.

 - **`selfUrl` should be the URL of `hca.js` itself.**

### `async hcaWorkerInstance.fixHeaderChecksum(hca: Uint8Array): Promise<Uint8Array>`
### `async hcaWorkerInstance.fixChecksum(hca: Uint8Array): Promise<Uint8Array>`

 - Similar to the [HCAInfo.fixHeaderChecksum](#hcainfofixheaderchecksumhca-uint8array-uint8array)/[HCA.fixChecksum](#hcafixchecksumhca-uint8array-uint8array) raw APIs described above.

### `async hcaWorkerInstance.addCipherHeader(hca: Uint8Array, cipherType?: number): Promise<Uint8Array>`
### `async hcaWorkerInstance.addHeader(hca: Uint8Array, sig: string, newData: Uint8Array): Promise<Uint8Array>`

 - Similar to the [HCAInfo.addCipherHeader](#hcainfoaddcipherheaderhca-uint8array-ciphertype-number--undefined--undefined-uint8array)/[HCAInfo.addHeader](#hcainfoaddheaderhca-uint8array-sig-string-newdata-uint8array-uint8array) raw APIs described above.

### `async hcaWorkerInstance.decrypt(hca: Uint8Array, key1?: any, key2?: any, subkey?: any): Promise<Uint8Array>`
### `async hcaWorkerInstance.encrypt(hca: Uint8Array, key1?: any, key2?: any, subkey?: any): Promise<Uint8Array>`
### `async hcaWorkerInstance.findKey(hca: Uint8Array, givenKeyList?: [any, any][], subkey?: any, threshold = 0.5, depth = 1024): Promise<[number, number] | undefined>`
### `async hcaWorkerInstance.decode(hca: Uint8Array, mode = 32, loop = 0, volume = 1.0): Promise<Uint8Array>`

 - Similar to the [HCA.decrypt](#hcadecrypthca-uint8array-key1-any-key2-any-subkey-any-uint8array)/[HCA.encrypt](#hcaencrypthca-uint8array-key1-any-key2-any-subkey-any-uint8array)/[HCA.decode](#hcadecodehca-uint8array-mode--32-loop--0-volume--10-uint8array)/[HCA.findKey](#hcafindkeyhca-uint8array-givenkeylist-any-any-subkey-any-threshold--05-depth--1024-number-number--undefined) raw APIs described above.

### `async hcaWorkerInstance.tick(): Promise<void>`
### `async hcaWorkerInstance.tock(text = ""): Promise<number>`

 - Measure how long a command being executed by the `Worker` controlled by `hcaWorkerInstance` takes.

 - Generally, `tick()` should be called right before the command(s) to be measured, and `tock()` should be called after it(them).

 - `tick()` marks the time when something starts, returning nothing; `tock()` logs (in the console) and returns how many milliseconds (ms) has elapsed **since last `tick()`**.

 - `text` is optional, which will be included in console output.

 - **Watch out for the characteristics of async calls.** `tick()`/`tock()` should be used like:

   ```JavaScript
   hcaWorkerInstance.tick();
   let wavPromise = hcaWorkerInstance.decode(hca, "defaultkey");
   hcaWorkerInstance.tock();
   let wav = await wavPromise;
   ```

   The following incorrect usage may result in incorrect `tock()` measuring results, because `tock()` command won't be sent to the `Worker` until `decode()` returns, in the meantime another `tick()` call may change the last tick time:

   ```JavaScript
   await hcaWorkerInstance.tick();
   let wav = await hcaWorkerInstance.decode(hca, "defaultkey");
   await hcaWorkerInstance.tock();
   ```

### `async hcaWorkerInstance.shutdown(): Promise<void>`

 - Gracefully shut down the `Worker` controlled by `hcaWorkerInstance`.

 - Return nothing.

 - **Once shut down, the `hcaWorkerInstance` will throw `Error` when its methods are still called.** You may set `hcaWorkerInstance = null` after shutting it down.

### `async hcaWorkerInstance.configTransfer(transferArgs: boolean, replyArgs: boolean): Promise<void>`

 - Enable or disable using [transferable objects](https://developer.mozilla.org/en-US/docs/Glossary/Transferable_objects) when communicating between foreground main thread and background workers. Transfering is generally much more fast if data size is large because of zero-copy.

 - **Once `transferArgs` is set to `true`, arguments (like a HCA file in the form of `Uint8Array` TypedArray) passed (from the foreground main thread) to hcaWorkerInstance will no longer be accessible (in the foreground main thread)!**

 - `replyArgs` controls whether the callee/receiver (usually, but not always, the background worker) should send back the arguments originally passed in - turning this off is supposed to save a little time/overhead. Note that replying arguments always uses transfering.

 - Return nothing.

### `async getTransferConfig(): Promise<{transferArgs: boolean, replyArgs: boolean}>`

 - Return the `transferArgs`, `replyArgs` config parameters described above.

# Unpack AWB Archive

### `AWBArchive.isAWB(file: Uint8Array): boolean`

 - Return `true` if given `file` begins with "AFS2" magic value, which indicates it's an AWB archive. Return `false` otherwise.

### `new AWBArchive(awb: Uint8Array)`

 - Return an `AWBArchive` instance (referred as `AWBArchiveInstance` below) which contains various information parsed from AWB headers, and `HCA` files packed inside it.

### `AWBArchiveInstance.subkey: number`

 - `subkey` used to decrypt the packed HCA files. For explanation of `subkey`, please refer to [HCA.decrypt](#hcadecrypthca-uint8array-key1-any-key2-any-subkey-any-uint8array)/[HCA.encrypt](#hcaencrypthca-uint8array-key1-any-key2-any-subkey-any-uint8array) above.

### `AWBArchiveInstance.subkey: hcaFiles: { waveID: number, file: Uint8Array }[]`

 - The given AWB archive file is splitted, so that the packed HCA files can be extracted.

# The following APIs have been removed:
-  ~`new HCA(key1, key2)`~
~Init HCA decoder with key~
-  ~`HCA.load(hca: Uint8Array)`~
~Load and decrypt hca file~
-  ~`HCA.decode(hca: Uint8Array): Uint8Array`~
~Decrode a decrypted hca file and return wave file~
