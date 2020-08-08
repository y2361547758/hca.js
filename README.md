# HCA.js

TypeScript port of [HCADecoder](https://github.com/Nyagamon/HCADecoder.git)

Decrypt & decode hca(2.0) file in browser.

# Functions

- [x] HCA 2.0
- [ ] HCA 1.3
- [x] a/b Keys
- [x] decrypt
- [x] decode
- [x] wave mode (8/16/24/32/float)
- [ ] loop
- [ ] volume
- [ ] encode
- [ ] encrypt
- [ ] recode (ogg/aac/mp3/flac)
- [ ] FFT/DCT/DCTM/IDCTM (?)

# Example

see [hca.html](/hca.html)

## API
- `new HCA(key1, key2)`
  Init HCA decoder with key
- `HCA.load(hca: Uint8Array)`
  Load and decrypt hca file
- `HCA.decode(hca: Uint8Array): Uint8Array`
  Decrode a decrypted hca file and return wave file
