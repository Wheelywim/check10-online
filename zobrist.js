// zobrist.js

// Generate a random 64-bit BigInt.
function random64() {
    // Math.random() is not cryptographically secure, but it's more than sufficient for this purpose.
    const low = BigInt(Math.floor(Math.random() * 2**32));
    const high = BigInt(Math.floor(Math.random() * 2**32));
    return (high << 32n) | low;
}

const ZOBRIST = (() => {
    // [pieceType][squareIndex]
    // pieceType: 0-7 for white 1-8, 8-15 for black 1-8
    // We'll map colors and numbers to an index.
    const table = Array(16).fill(null).map(() => Array(64).fill(0n));

    for (let piece = 0; piece < 16; piece++) {
        for (let square = 0; square < 64; square++) {
            table[piece][square] = random64();
        }
    }

    // A random number to XOR in if it's black's turn to move.
    const blackToMove = random64();

    return { table, blackToMove };
})();

/**
 * Maps a piece object to its index for the Zobrist table.
 * @param {object} piece - The piece object { color, number }.
 * @returns {number} The index (0-15).
 */
function getPieceIndex(piece) {
    // White pieces 1-8 get indices 0-7
    // Black pieces 1-8 get indices 8-15
    const base = piece.color === 'white' ? 0 : 8;
    return base + piece.number - 1;
}

/**
 * Calculates the full Zobrist hash for a given board state.
 * This is used once at the beginning of a search.
 * @param {Array} board - The 8x8 game board.
 * @param {string} currentPlayer - 'white' or 'black'.
 * @returns {BigInt} The Zobrist hash key.
 */
function calculateZobristKey(board, currentPlayer) {
    let hash = 0n;
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = board[r][c];
            if (piece) {
                const squareIndex = r * 8 + c;
                const pieceIndex = getPieceIndex(piece);
                hash ^= ZOBRIST.table[pieceIndex][squareIndex];
            }
        }
    }

    if (currentPlayer === 'black') {
        hash ^= ZOBRIST.blackToMove;
    }

    return hash;
}

module.exports = {
    calculateZobristKey,
    ZOBRIST, // We export the main table to allow for incremental updates
    getPieceIndex
};