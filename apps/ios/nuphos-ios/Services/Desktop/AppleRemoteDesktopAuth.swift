import Foundation
#if canImport(CommonCrypto)
import CommonCrypto
import CryptoKit
#endif

/// Apple Remote Desktop sign-in (VNC security type 30), as noVNC does it: a
/// Diffie-Hellman exchange on the server's group, then the account encrypted
/// with AES-128-ECB under the MD5 of the shared secret. The relay only sees
/// ciphertext.
nonisolated enum AppleRemoteDesktopAuth {
    struct Unavailable: Error {}
    struct BadGroup: Error {}

    /// The server picks the group, so check it before any arithmetic: a short,
    /// even or zero-padded prime, or a key outside it, would make the exchange
    /// loop for as long as the server liked. Apple's groups are 128 bytes.
    static func validate(generator: [UInt8], prime: [UInt8], serverKey: [UInt8]) throws {
        let one = BigUInt(limbs: [1])
        let modulus = BigUInt(bytes: prime)
        let key = BigUInt(bytes: serverKey)
        let base = BigUInt(bytes: generator)
        guard (16...512).contains(prime.count), prime.first != 0, prime.last.map({ $0 & 1 == 1 }) == true,
              serverKey.count == prime.count, one < key, key < modulus, one < base, base < modulus else { throw BadGroup() }
    }

    /// The 128 encrypted account bytes followed by the client's public key.
    static func response(generator: [UInt8], prime: [UInt8], serverKey: [UInt8], user: String, password: String) throws -> [UInt8] {
        try validate(generator: generator, prime: prime, serverKey: serverKey)
        let keyLength = prime.count
        var secret = [UInt8](repeating: 0, count: keyLength)
        for i in secret.indices { secret[i] = UInt8.random(in: 0...255) }
        let modulus = BigUInt(bytes: prime)
        let exponent = BigUInt(bytes: secret)
        let publicKey = BigUInt(bytes: generator).power(exponent, modulus: modulus).bytes(count: keyLength)
        let shared = BigUInt(bytes: serverKey).power(exponent, modulus: modulus).bytes(count: keyLength)
        var account = (0..<128).map { _ in UInt8.random(in: 0...255) }
        for (field, offset) in [(user, 0), (password, 64)] {
            let bytes = Array(field.utf8.prefix(63))
            account.replaceSubrange(offset..<(offset + bytes.count), with: bytes)
            account[offset + bytes.count] = 0
        }
        return try encrypt(account, key: md5(shared)) + publicKey
    }

    #if canImport(CommonCrypto)
    private static func md5(_ data: [UInt8]) -> [UInt8] { Array(Insecure.MD5.hash(data: data)) }

    private static func encrypt(_ data: [UInt8], key: [UInt8]) throws -> [UInt8] {
        var output = [UInt8](repeating: 0, count: data.count)
        var moved = 0
        let status = CCCrypt(
            CCOperation(kCCEncrypt), CCAlgorithm(kCCAlgorithmAES), CCOptions(kCCOptionECBMode),
            key, key.count, nil, data, data.count, &output, output.count, &moved
        )
        guard status == kCCSuccess, moved == data.count else { throw Unavailable() }
        return output
    }
    #else
    private static func md5(_ data: [UInt8]) -> [UInt8] { [] }
    private static func encrypt(_ data: [UInt8], key: [UInt8]) throws -> [UInt8] { throw Unavailable() }
    #endif
}

/// Just enough unsigned big-integer arithmetic for the exchange: modular
/// exponentiation with Montgomery multiplication on 32-bit limbs, least
/// significant first. The modulus must be odd, as a Diffie-Hellman prime is.
nonisolated struct BigUInt: Comparable {
    var limbs: [UInt32]

    init(limbs: [UInt32]) {
        var limbs = limbs
        while limbs.count > 1, limbs.last == 0 { limbs.removeLast() }
        self.limbs = limbs.isEmpty ? [0] : limbs
    }

    /// From big-endian bytes.
    init(bytes: [UInt8]) {
        var limbs: [UInt32] = []
        var index = bytes.count
        while index > 0 {
            let start = max(0, index - 4)
            limbs.append(bytes[start..<index].reduce(0) { $0 << 8 | UInt32($1) })
            index = start
        }
        self.init(limbs: limbs)
    }

    /// Big-endian bytes, left-padded (or cut) to `count`.
    func bytes(count: Int) -> [UInt8] {
        (0..<count).map { i in
            let bit = (count - 1 - i) * 8
            return bit / 32 < limbs.count ? UInt8(limbs[bit / 32] >> UInt32(bit % 32) & 0xFF) : 0
        }
    }

    static func < (a: BigUInt, b: BigUInt) -> Bool { compare(a.limbs, b.limbs) < 0 }

    /// `self` to the `exponent` mod an odd `modulus` larger than `self`.
    func power(_ exponent: BigUInt, modulus: BigUInt) -> BigUInt {
        let n = modulus.limbs, k = n.count
        // -n⁻¹ mod 2³², by Newton's iteration.
        var inverse: UInt32 = 1
        for _ in 0..<5 { inverse = inverse &* (2 &- n[0] &* inverse) }
        let negInverse = 0 &- inverse

        func reduce(_ value: [UInt32]) -> [UInt32] {
            var value = value
            while compare(value, n) >= 0 { value = subtract(value, n) }
            return value
        }
        func multiply(_ a: [UInt32], _ b: [UInt32]) -> [UInt32] {
            var t = [UInt32](repeating: 0, count: k + 2)
            for i in 0..<k {
                var carry: UInt64 = 0
                for j in 0..<k {
                    let sum = UInt64(t[j]) + UInt64(a[j]) * UInt64(b[i]) + carry
                    t[j] = UInt32(truncatingIfNeeded: sum)
                    carry = sum >> 32
                }
                var sum = UInt64(t[k]) + carry
                t[k] = UInt32(truncatingIfNeeded: sum)
                t[k + 1] = UInt32(sum >> 32)
                let m = t[0] &* negInverse
                sum = UInt64(t[0]) + UInt64(m) * UInt64(n[0])
                carry = sum >> 32
                for j in 1..<k {
                    sum = UInt64(t[j]) + UInt64(m) * UInt64(n[j]) + carry
                    t[j - 1] = UInt32(truncatingIfNeeded: sum)
                    carry = sum >> 32
                }
                sum = UInt64(t[k]) + carry
                t[k - 1] = UInt32(truncatingIfNeeded: sum)
                t[k] = t[k + 1] + UInt32(sum >> 32)
            }
            return reduce(Array(t[0...k]))
        }
        func padded(_ value: [UInt32]) -> [UInt32] { Array((value + [UInt32](repeating: 0, count: k)).prefix(k)) }

        // R² mod n, by doubling 1 (2·32·k) times.
        var r2 = [UInt32](repeating: 0, count: k + 1)
        r2[0] = 1
        for _ in 0..<(64 * k) {
            var carry: UInt32 = 0
            for i in 0...k {
                let next = r2[i] >> 31
                r2[i] = r2[i] << 1 | carry
                carry = next
            }
            r2 = padded(reduce(r2)) + [0]
        }
        let r2k = padded(r2)
        let base = multiply(padded(reduce(limbs + [0])), r2k)
        var result = multiply(padded([1]), r2k)
        for limb in exponent.limbs.reversed() {
            for bit in (0..<32).reversed() {
                result = padded(multiply(padded(result), padded(result)))
                if limb >> UInt32(bit) & 1 == 1 { result = padded(multiply(result, padded(base))) }
            }
        }
        return BigUInt(limbs: multiply(padded(result), padded([1])))
    }
}

/// Compares little-endian limb arrays of any lengths.
nonisolated private func compare(_ a: [UInt32], _ b: [UInt32]) -> Int {
    for i in (0..<max(a.count, b.count)).reversed() {
        let x = i < a.count ? a[i] : 0, y = i < b.count ? b[i] : 0
        if x != y { return x < y ? -1 : 1 }
    }
    return 0
}

/// `a - b` for `a >= b`, keeping `a`'s length.
nonisolated private func subtract(_ a: [UInt32], _ b: [UInt32]) -> [UInt32] {
    var result = a
    var borrow: Int64 = 0
    for i in result.indices {
        let difference = Int64(a[i]) - Int64(i < b.count ? b[i] : 0) - borrow
        borrow = difference < 0 ? 1 : 0
        result[i] = UInt32(truncatingIfNeeded: difference + (borrow << 32))
    }
    return result
}
