/**
 * @file gameLogic.js
 * Headless version of the Check10Game class for server-side AI computation.
 *
 * This class contains all the core game rules, state representation, and move simulation logic.
 * It has been stripped of all DOM manipulation, rendering, animation, and event handling code
 * to allow it to run in a pure Node.js environment.
 */

class Check10Game {
    // The constructor is now minimal. It just sets up default properties.
    constructor() {
        this.board = [];
        this.currentPlayer = 'white';
        this.whiteScore = 0;
        this.blackScore = 0;
        this.gameOver = false;
        this.gameState = 'playing';
        this.promotionChoices = null;
        this.promotionPoints = 0;

        // Note: humanPlayerColor, aiPlayerColor, etc. are not needed here
        // as the server is agnostic; it just calculates the best move for the 'currentPlayer'.
    }

    /**
     * Populates the game instance with state received from the client.
     * This is the primary way to use this class on the server.
     * @param {object} gameState - The game state object sent from the client.
     */
    hydrateFromServerState(gameState) {
        this.board = gameState.board;
        this.currentPlayer = gameState.currentPlayer;
        this.whiteScore = gameState.whiteScore;
        this.blackScore = gameState.blackScore;
        this.gameOver = gameState.gameOver || false;
        this.gameState = gameState.gameState || 'playing';
        // We generally don't need to hydrate the rest (like promotion choices)
        // because the server's job is to evaluate a single move from a 'playing' state.
    }

    // --- Core Game Setup & Pure Logic ---
    // (Kept for potential testing or more complex server-side tasks)
    initializeBoardData() {
        this.board = Array(8).fill(null).map(() => Array(8).fill(null));
        const blackRow1 = [8, 7, 6, 5, 4, 3, 2, 1],
            blackRow2 = [1, 2, 3, 4, 5, 6, 7, 8];
        const whiteRow1 = [8, 7, 6, 5, 4, 3, 2, 1],
            whiteRow2 = [1, 2, 3, 4, 5, 6, 7, 8];
        for (let col = 0; col < 8; col++) {
            this.board[0][col] = { color: 'black', number: blackRow1[col], promoted: false };
            this.board[1][col] = { color: 'black', number: blackRow2[col], promoted: false };
            this.board[6][col] = { color: 'white', number: whiteRow1[col], promoted: false };
            this.board[7][col] = { color: 'white', number: whiteRow2[col], promoted: false };
        }
    }

    getValidMoves(row, col) {
        const validMoves = [];
        const piece = this.board[row][col];
        if (!piece) return validMoves;
        const direction = piece.color === 'white' ? -1 : 1;
        const newRow = row + direction;
        if (newRow >= 0 && newRow < 8) {
            if (!this.board[newRow][col]) validMoves.push({ row: newRow, col });
            for (const deltaCol of [-1, 1]) {
                const newCol = col + deltaCol;
                if (newCol >= 0 && newCol < 8 && !this.board[newRow][newCol]) validMoves.push({ row: newRow, col: newCol });
            }
        }
        return validMoves;
    }

    checkPromotion(row, col) {
        const p = this.board[row][col];
        if (!p || p.promoted) return false;
        if ((p.color === 'white' && row === 0) || (p.color === 'black' && row === 7)) {
            // In the simulation, we can directly mark as promoted.
            // The client-side logic will handle the visual update.
            p.promoted = true;
            return true;
        }
        return false;
    }

    /**
     * Server-side version of processing a promotion. It determines the points gained
     * without requiring user input.
     * @param {number} row - The row of the promoted piece.
     * @param {number} col - The column of the promoted piece.
     * @param {Array} boardState - The board to operate on.
     * @returns {{points: number, leadsToChoice: boolean, captures: Array}}
     */
    processPromotion(row, col, boardState) {
        const piece = boardState[row][col];
        const opponentColor = piece.color === 'white' ? 'black' : 'white';
        const matchingPieces = [];

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const targetPiece = boardState[r][c];
                if (targetPiece && targetPiece.color === opponentColor && targetPiece.number === piece.number && !targetPiece.promoted) {
                    matchingPieces.push({ row: r, col: c });
                }
            }
        }

        if (matchingPieces.length === 0) {
            return { points: 0, leadsToChoice: false, captures: [] };
        } else if (matchingPieces.length === 1) {
            // A single, deterministic capture.
            return { points: piece.number, leadsToChoice: false, captures: [matchingPieces[0]] };
        } else {
            // Multiple choices exist. The AI must account for this.
            // For simulation, we can assume the best/first choice is made.
            return { points: piece.number, leadsToChoice: true, captures: [matchingPieces[0]] };
        }
    }


    checkCombinationsAroundPosition(cR, cC) {
        const r = 3,
            nP = [];
        for (let rS = Math.max(0, cR - r); rS <= Math.min(7, cR + r); rS++)
            for (let cS = Math.max(0, cC - r); cS <= Math.min(7, cC + r); cS++)
                if (this.board[rS][cS]) nP.push({ row: rS, col: cS, piece: this.board[rS][cS] });
        let hWN = false,
            hBN = false;
        for (const pD of nP) {
            if (pD.piece.color === 'white') hWN = true;
            else if (pD.piece.color === 'black') hBN = true;
            if (hWN && hBN) break;
        }
        if (!hWN || !hBN) return [];
        return this.findValidCombinations(nP);
    }

    findValidCombinations(ps) {
        const vCs = [],
            n = ps.length;
        for (let m = 3; m < (1 << n); m++) {
            let cL = 0;
            for (let i = 0; i < n; ++i)
                if ((m >> i) & 1) cL++;
            if (cL > 8 || cL < 2) continue;
            const c = [];
            let s = 0;
            let hW = false,
                hB = false;
            for (let i = 0; i < n; i++)
                if (m & (1 << i)) {
                    const pD = ps[i];
                    c.push(pD);
                    s += pD.piece.number;
                    if (pD.piece.color === 'white') hW = true;
                    else hB = true;
                }
            if (s === 10 && hW && hB && this.areConnectedOptimized(c)) vCs.push(c);
        }
        return vCs;
    }

    areConnectedOptimized(ps) {
        if (ps.length <= 1) return true;
        const pS = new Set(ps.map(p => `${p.row},${p.col}`)),
            vS = new Set(),
            q = [ps[0]];
        vS.add(`${ps[0].row},${ps[0].col}`);
        const d = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
        while (q.length > 0) {
            const c = q.shift();
            for (const [dR, dC] of d) {
                const nR = c.row + dR,
                    nC = c.col + dC,
                    k = `${nR},${nC}`;
                if (pS.has(k) && !vS.has(k)) {
                    vS.add(k);
                    q.push(ps.find(p => p.row === nR && p.col === nC));
                }
            }
        }
        return vS.size === ps.length;
    }

    hasValidMoves(playerColor) {
        for (let r = 0; r < 8; r++)
            for (let c = 0; c < 8; c++)
                if (this.board[r][c] && this.board[r][c].color === playerColor && this.getValidMoves(r, c).length > 0) return true;
        return false;
    }

    // --- AI Simulation and Helper Functions ---
    
    getAllPossibleMovesForPlayer(playerColor) {
        const moves = [];
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = this.board[r][c];
                if (piece && piece.color === playerColor) {
                    const validMoves = this.getValidMoves(r, c);
                    for (const move of validMoves) {
                        moves.push({ fromRow: r, fromCol: c, toRow: move.row, toCol: move.col, piece: piece });
                    }
                }
            }
        }
        return moves;
    }

    getAllPossibleMovesForPlayerOnBoard(playerColor, boardState) {
        const moves = [];
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = boardState[r][c];
                if (piece && piece.color === playerColor) {
                    const validMoves = this.getValidMovesOnBoard(r, c, boardState, piece.color);
                    for (const move of validMoves) {
                        moves.push({ fromRow: r, fromCol: c, toRow: move.row, toCol: move.col, piece: piece });
                    }
                }
            }
        }
        return moves;
    }

    getValidMovesOnBoard(row, col, boardState, pieceColor) {
        const validMoves = [],
            direction = pieceColor === 'white' ? -1 : 1,
            newRow = row + direction;
        if (newRow >= 0 && newRow < 8) {
            if (!boardState[newRow][col]) validMoves.push({ row: newRow, col });
            for (const deltaCol of [-1, 1]) {
                const newCol = col + deltaCol;
                if (newCol >= 0 && newCol < 8 && !boardState[newRow][newCol]) validMoves.push({ row: newRow, col: newCol });
            }
        }
        return validMoves;
    }

    checkCombinationsAroundPositionOnBoard(checkRow, checkCol, boardState, scoringPlayerColor) {
        const radius = 3,
            nearbyPieces = [];
        for (let r = Math.max(0, checkRow - radius); r <= Math.min(7, checkRow + radius); r++)
            for (let c = Math.max(0, checkCol - radius); c <= Math.min(7, checkCol + radius); c++)
                if (boardState[r][c]) nearbyPieces.push({ row: r, col: c, piece: boardState[r][c] });
        let hasWhitePiece = false,
            hasBlackPiece = false;
        for (const pieceData of nearbyPieces) {
            if (pieceData.piece.color === 'white') hasWhitePiece = true;
            else if (pieceData.piece.color === 'black') hasBlackPiece = true;
            if (hasWhitePiece && hasBlackPiece) break;
        }
        if (!hasWhitePiece || !hasBlackPiece) return [];
        return this.findValidCombinations(nearbyPieces);
    }
    
    /**
     * The most important function for the AI. It simulates a move and calculates the immediate outcome.
     * @param {number} fromRow
     * @param {number} fromCol
     * @param {number} toRow
     * @param {number} toCol
     * @param {string} forPlayerColor - The player making the move.
     * @param {Array} [sourceBoard=this.board] - Optional board state to run the simulation on.
     * @returns {{tempBoard: Array|null, aiScoreGain: number, leadsToChoiceForThisPlayer: boolean}}
     */
    simulateFullMove(fromRow, fromCol, toRow, toCol, forPlayerColor, sourceBoard = this.board) {
        // Deep copy the board to avoid modifying the original state during simulation.
        const tempBoard = sourceBoard.map(r => r.map(p => (p ? { ...p } : null)));
        
        const pieceToMove = tempBoard[fromRow]?.[fromCol];
        if (!pieceToMove || pieceToMove.color !== forPlayerColor) {
            return { tempBoard: null, aiScoreGain: -Infinity, leadsToChoiceForThisPlayer: false };
        }
        
        const movedPiece = { ...pieceToMove };
        if (tempBoard[toRow][toCol]) { // Invalid move if destination is occupied
            return { tempBoard: null, aiScoreGain: -Infinity, leadsToChoiceForThisPlayer: false };
        }
        
        tempBoard[toRow][toCol] = movedPiece;
        tempBoard[fromRow][fromCol] = null;
        
        let scoreGain = 0;
        let leadsToChoiceForThisPlayer = false;

        const originalPieceFromSource = sourceBoard[fromRow][fromCol];
        const isPromotion = ((movedPiece.color === 'white' && toRow === 0) || (movedPiece.color === 'black' && toRow === 7));
        
        if (isPromotion && originalPieceFromSource && !originalPieceFromSource.promoted) {
            movedPiece.promoted = true;
            const promotionResult = this.processPromotion(toRow, toCol, tempBoard);
            scoreGain += promotionResult.points;
            leadsToChoiceForThisPlayer = promotionResult.leadsToChoice;

            // Apply captures from promotion
            for (const capture of promotionResult.captures) {
                tempBoard[capture.row][capture.col] = null;
            }
        }
        
        const combinations = this.checkCombinationsAroundPositionOnBoard(toRow, toCol, tempBoard, forPlayerColor);
        if (combinations.length > 0) {
            const piecesToRemoveByCombination = new Set();
            for (const combination of combinations) {
                for (const pos of combination) {
                    const pieceInCombination = tempBoard[pos.row]?.[pos.col];
                    if (pieceInCombination && pieceInCombination.color !== forPlayerColor) {
                        const key = `${pos.row},${pos.col}`;
                        if (!piecesToRemoveByCombination.has(key)) {
                            scoreGain += pieceInCombination.number;
                            piecesToRemoveByCombination.add(key);
                        }
                    }
                }
            }
            // Apply captures from combinations
            piecesToRemoveByCombination.forEach(key => {
                const [r, c] = key.split(',').map(Number);
                tempBoard[r][c] = null;
            });
        }
        
        return { tempBoard, aiScoreGain: scoreGain, leadsToChoiceForThisPlayer };
    }
}

// This line is crucial for Node.js to be able to import the class in other files.
module.exports = { Check10Game };