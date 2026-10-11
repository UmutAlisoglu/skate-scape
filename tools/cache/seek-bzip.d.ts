declare module 'seek-bzip' {
  const Bunzip: {
    /** `output`: a preallocated buffer of the exact uncompressed size, or that size */
    decode(input: Uint8Array, output?: Uint8Array | number): Uint8Array;
  };
  export default Bunzip;
}
