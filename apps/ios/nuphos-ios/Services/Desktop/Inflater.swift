import Foundation

/// Decodes one zlib stream fed in pieces, for ZRLE: a VNC connection carries a
/// single zlib stream, and each rectangle brings the next part of it. Input may
/// stop anywhere, even mid-symbol: the decoder returns what it could decode and
/// resumes from the last whole symbol when more arrives. Back references reach
/// into earlier pieces through the kept 32 KiB window.
nonisolated struct Inflater {
    enum Failure: Error { case corrupt }

    private struct Huffman {
        var counts = [Int](repeating: 0, count: 16)
        var symbols: [Int] = []

        init(lengths: ArraySlice<Int>) throws {
            for length in lengths { counts[length] += 1 }
            counts[0] = 0
            var offsets = [Int](repeating: 0, count: 16)
            for length in 1..<16 { offsets[length] = offsets[length - 1] + counts[length - 1] }
            symbols = [Int](repeating: 0, count: lengths.count)
            for (symbol, length) in zip(0..., lengths) where length != 0 {
                symbols[offsets[length]] = symbol
                offsets[length] += 1
            }
        }
    }

    private enum Block {
        case header
        case stored(remaining: Int)
        case huffman(Huffman, Huffman)
    }

    private static let lengthBase = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
    private static let lengthExtra = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
    private static let distanceBase = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
    private static let distanceExtra = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
    private static let codeLengthOrder = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]
    private static let fixed: (Huffman, Huffman) = {
        var lengths = [Int](repeating: 8, count: 288)
        for i in 144..<256 { lengths[i] = 9 }
        for i in 256..<280 { lengths[i] = 7 }
        return (try! Huffman(lengths: lengths[...]), try! Huffman(lengths: [Int](repeating: 5, count: 30)[...]))
    }()

    private var input: [UInt8] = []
    private var bit = 0
    private var window: [UInt8] = []
    private var block = Block.header
    private var zlibHeader = true

    /// The bytes the next piece of the stream decodes to.
    mutating func inflate(_ piece: [UInt8]) throws -> [UInt8] {
        input.removeFirst(bit >> 3)
        bit &= 7
        input += piece
        let start = window.count
        decoding: while true {
            switch block {
            case .header:
                if zlibHeader {
                    guard input.count * 8 - bit >= 16 else { break decoding }
                    bit += 16
                    zlibHeader = false
                }
                let mark = bit
                guard let header = bits(3) else { break decoding }
                switch header >> 1 {
                case 0:
                    bit = (bit + 7) & ~7
                    guard let length = bits(16), let check = bits(16) else { bit = mark; break decoding }
                    guard length == ~check & 0xFFFF else { throw Failure.corrupt }
                    block = .stored(remaining: length)
                case 1:
                    block = .huffman(Self.fixed.0, Self.fixed.1)
                case 2:
                    guard let tables = try dynamicTables() else { bit = mark; break decoding }
                    block = .huffman(tables.0, tables.1)
                default:
                    throw Failure.corrupt
                }
            case .stored(let remaining):
                let available = min(remaining, input.count - (bit >> 3))
                window += input[(bit >> 3)..<((bit >> 3) + available)]
                bit += available * 8
                block = remaining == available ? .header : .stored(remaining: remaining - available)
                if remaining != available { break decoding }
            case .huffman(let literals, let distances):
                while true {
                    let mark = bit
                    guard let symbol = try decode(literals) else { break decoding }
                    if symbol < 256 {
                        window.append(UInt8(symbol))
                        continue
                    }
                    if symbol == 256 { block = .header; break }
                    let index = symbol - 257
                    guard index < 29 else { throw Failure.corrupt }
                    guard let extra = bits(Self.lengthExtra[index]), let distanceSymbol = try decode(distances) else { bit = mark; break decoding }
                    guard distanceSymbol < 30 else { throw Failure.corrupt }
                    guard let distanceExtra = bits(Self.distanceExtra[distanceSymbol]) else { bit = mark; break decoding }
                    let length = Self.lengthBase[index] + extra
                    let distance = Self.distanceBase[distanceSymbol] + distanceExtra
                    guard distance <= window.count else { throw Failure.corrupt }
                    let from = window.count - distance
                    for i in 0..<length { window.append(window[from + i]) }
                }
            }
        }
        let output = Array(window[start...])
        if window.count > 65_536 { window.removeFirst(window.count - 32_768) }
        return output
    }

    /// Reads `count` bits, least significant first, or nil (consuming nothing) when the input ends first.
    private mutating func bits(_ count: Int) -> Int? {
        guard input.count * 8 - bit >= count else { return nil }
        var value = 0
        for i in 0..<count {
            value |= Int(input[(bit + i) >> 3] >> UInt8((bit + i) & 7) & 1) << i
        }
        bit += count
        return value
    }

    /// The next symbol, or nil (consuming nothing) when the input ends first.
    private mutating func decode(_ huffman: Huffman) throws -> Int? {
        let mark = bit
        var code = 0, first = 0, index = 0
        for length in 1..<16 {
            guard let next = bits(1) else { bit = mark; return nil }
            code |= next
            let count = huffman.counts[length]
            if code - count < first { return huffman.symbols[index + code - first] }
            index += count
            first = (first + count) << 1
            code <<= 1
        }
        throw Failure.corrupt
    }

    private mutating func dynamicTables() throws -> (Huffman, Huffman)? {
        guard let literalCount = bits(5), let distanceCount = bits(5), let codeCount = bits(4) else { return nil }
        var codeLengths = [Int](repeating: 0, count: 19)
        for i in 0..<(codeCount + 4) {
            guard let length = bits(3) else { return nil }
            codeLengths[Self.codeLengthOrder[i]] = length
        }
        let codes = try Huffman(lengths: codeLengths[...])
        let total = literalCount + 257 + distanceCount + 1
        var lengths: [Int] = []
        while lengths.count < total {
            guard let symbol = try decode(codes) else { return nil }
            switch symbol {
            case 0..<16: lengths.append(symbol)
            case 16:
                guard let last = lengths.last else { throw Failure.corrupt }
                guard let repeats = bits(2) else { return nil }
                lengths += repeatElement(last, count: repeats + 3)
            case 17:
                guard let repeats = bits(3) else { return nil }
                lengths += repeatElement(0, count: repeats + 3)
            case 18:
                guard let repeats = bits(7) else { return nil }
                lengths += repeatElement(0, count: repeats + 11)
            default: throw Failure.corrupt
            }
        }
        guard lengths.count == total else { throw Failure.corrupt }
        return (try Huffman(lengths: lengths[0..<(literalCount + 257)]), try Huffman(lengths: lengths[(literalCount + 257)...]))
    }
}
