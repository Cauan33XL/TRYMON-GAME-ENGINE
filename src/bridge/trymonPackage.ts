/**
 * .trymon Package Utility
 * Handles packing and unpacking of Trymon OS packages.
 */

export interface TrymonMetadata {
  name?: string;
  version?: string;
  architecture?: string;
  description?: string;
  maintainer?: string;
  dependencies?: string[];
  icon?: string; // Base64
  entry?: string;
}

export class TrymonPackage {
  /**
   * Pack a binary and metadata into a .trymon package
   */
  static create(binary: Uint8Array, metadata: TrymonMetadata): Uint8Array {
    const magic = new TextEncoder().encode("TRYM"); // 4 bytes
    const version = new Uint8Array([1]); // 1 byte
    const metaJson = new TextEncoder().encode(JSON.stringify(metadata));
    const metaLen = new Uint32Array([metaJson.length]); // 4 bytes
    const binLen = new Uint32Array([binary.length]); // 4 bytes

    // Total size: 4 + 1 + 4 + metaJson.length + 4 + binary.length
    const totalLen = 4 + 1 + 4 + metaJson.length + 4 + binary.length;
    const result = new Uint8Array(totalLen);

    let offset = 0;
    
    // Header
    result.set(magic, offset); offset += 4;
    result.set(version, offset); offset += 1;
    
    // Metadata block
    result.set(new Uint8Array(metaLen.buffer), offset); offset += 4;
    result.set(metaJson, offset); offset += metaJson.length;
    
    // Binary block
    result.set(new Uint8Array(binLen.buffer), offset); offset += 4;
    result.set(binary, offset);

    return result;
  }

  /**
   * Simple check if a buffer is a Trymon package
   */
  static isTrymon(data: Uint8Array): boolean {
    if (data.length < 4) return false;
    const magic = new TextDecoder().decode(data.slice(0, 4));
    return magic === "TRYM";
  }
}
