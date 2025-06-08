const express = require('express');
const cors = require('cors');
const path = require('path'); // Added for serving static files
const { Check10Game } = require('./gameLogic.js'); // Import our headless game class
const { calculateZobristKey, ZOBRIST, getPieceIndex } = require('./zobrist.js'); // Import Zobrist hashing utilities

const app = express();
const PORT = process.env.PORT || 3000; // Use environment variable for port, crucial for deployment

// --- AI Configuration ---
const MAX_SEARCH_DEPTH = 15; // A hard limit to prevent excessively long searches
const AI_THINKING_TIME_MS = 10000; // AI will "think" for 10 seconds per move

// Initialize the Transposition Table. This will store our calculated results.
const transpositionTable = new Map();

// --- Middleware ---
app.use(cors());
app.use(express.json());
// --- NEW LINES TO SERVE THE FRONTEND ---

app.use(express.static(path.join(__dirname, 'public')));



// =================================================================
//                     MAIN API ENDPOINT
// =================================================================
app.post('/api/get-best-move', (req, res) => {
    console.log("-----------------------------------------");
    console.log(`Received request for best move.`);
    const startTime = Date.now();

    // Clear the transposition table for this new, independent search.
    transpositionTable.clear();

    const gameState = req.body;

    if (!gameState || !gameState.board || !gameState.currentPlayer) {
        return res.status(400).json({ error: 'Invalid game state provided.' });
    }

    const game = new Check10Game();
    game.hydrateFromServerState(gameState);

    const bestMove = findBestMoveWithAlphaBeta(game);

    const endTime = Date.now();
    console.log(`Final AI calculation took ${endTime - startTime}ms. TT size: ${transpositionTable.size}`);
    
    if (bestMove) {
        console.log("AI chose final move:", bestMove);
        res.status(200).json(bestMove);
    } else {
        console.log("AI found no valid moves.");
        res.status(200).json({ noMove: true });
    }
});

// =================================================================
//                  AI LOGIC (IDDFS + ALPHA-BETA + TT)
// =================================================================

/**
 * Top-level "manager" function that implements Iterative Deepening.
 * It calls the alpha-beta search in a loop, increasing the depth each time
 * until a time limit is reached.
 */
function findBestMoveWithAlphaBeta(game) {
    const startTime = Date.now();
    const playerColor = game.currentPlayer;
    
    let bestMoveSoFar = null;
    let bestValueSoFar = -Infinity;
    
    const possibleMoves = game.getAllPossibleMovesForPlayer(playerColor);
    if (possibleMoves.length === 0) return null;

    // Start with a random move in case we run out of time even on depth 1
    bestMoveSoFar = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];

    // --- The Iterative Deepening Loop ---
    for (let depth = 1; depth <= MAX_SEARCH_DEPTH; depth++) {
        console.log(`- Starting search at depth: ${depth}`);
        
        // Prioritize the best move from the previous iteration to improve alpha-beta pruning.
        const movesToSearch = [...possibleMoves];
        const bestMoveIndex = movesToSearch.findIndex(m => 
            m.fromRow === bestMoveSoFar.fromRow && m.fromCol === bestMoveSoFar.fromCol &&
            m.toRow === bestMoveSoFar.toRow && m.toCol === bestMoveSoFar.toCol
        );
        if (bestMoveIndex > -1) {
            const prioritizedMove = movesToSearch.splice(bestMoveIndex, 1)[0];
            movesToSearch.unshift(prioritizedMove);
        }

        let currentBestMoveForDepth = null;
        let bestValueForDepth = -Infinity;
        
        const rootHash = calculateZobristKey(game.board, game.currentPlayer);

        for (const move of movesToSearch) {
            if (Date.now() - startTime > AI_THINKING_TIME_MS) {
                console.log(`-- Time limit reached during depth ${depth}. Using results from depth ${depth - 1}.`);
                return bestMoveSoFar; // Return the best move from the PREVIOUS completed depth
            }

            const { tempBoard, aiScoreGain, leadsToChoiceForThisPlayer } = game.simulateFullMove(move.fromRow, move.fromCol, move.toRow, move.toCol, playerColor);
            
            let moveValue;
            if (leadsToChoiceForThisPlayer) {
                moveValue = aiScoreGain;
            } else {
                let nextHash = rootHash;
                nextHash ^= ZOBRIST.table[getPieceIndex(move.piece)][move.fromRow * 8 + move.fromCol];
                nextHash ^= ZOBRIST.table[getPieceIndex(move.piece)][move.toRow * 8 + move.toCol];
                nextHash ^= ZOBRIST.blackToMove;

                const childGame = new Check10Game();
                const opponentColor = playerColor === 'white' ? 'black' : 'white';
                childGame.hydrateFromServerState({
                    board: tempBoard, currentPlayer: opponentColor,
                    whiteScore: game.whiteScore + (playerColor === 'white' ? aiScoreGain : 0),
                    blackScore: game.blackScore + (playerColor === 'black' ? aiScoreGain : 0),
                });
                
                moveValue = aiScoreGain + alphaBetaSearch(childGame, depth - 1, -Infinity, Infinity, false, playerColor, nextHash);
            }

            if (moveValue > bestValueForDepth) {
                bestValueForDepth = moveValue;
                currentBestMoveForDepth = move;
            }
        }

        if (Date.now() - startTime > AI_THINKING_TIME_MS) {
            console.log(`-- Time limit reached after completing depth ${depth}. Using these results.`);
            bestMoveSoFar = currentBestMoveForDepth;
            bestValueSoFar = bestValueForDepth;
            break;
        }
        
        bestMoveSoFar = currentBestMoveForDepth;
        bestValueSoFar = bestValueForDepth;
        console.log(`- Completed depth ${depth}. Best move so far:`, {move: bestMoveSoFar, score: bestValueSoFar});
    }

    return bestMoveSoFar;
}


/**
 * The core recursive Alpha-Beta search function with Transposition Table integration.
 */
function alphaBetaSearch(game, depth, alpha, beta, isMaximizingPlayer, aiRootColor, currentHash) {
    const originalAlpha = alpha;
    const tableEntry = transpositionTable.get(currentHash);
    if (tableEntry && tableEntry.depth >= depth) {
        if (tableEntry.flag === 'EXACT') return tableEntry.value;
        if (tableEntry.flag === 'LOWERBOUND') alpha = Math.max(alpha, tableEntry.value);
        else if (tableEntry.flag === 'UPPERBOUND') beta = Math.min(beta, tableEntry.value);
        if (alpha >= beta) return tableEntry.value;
    }

    if (depth === 0 || game.gameOver || !game.hasValidMoves(game.currentPlayer)) {
        return evaluateBoard(game, aiRootColor);
    }

    const possibleMoves = game.getAllPossibleMovesForPlayer(game.currentPlayer);
    let bestValue;

    if (isMaximizingPlayer) {
        bestValue = -Infinity;
        for (const move of possibleMoves) {
            let nextHash = currentHash;
            nextHash ^= ZOBRIST.table[getPieceIndex(move.piece)][move.fromRow * 8 + move.fromCol];
            nextHash ^= ZOBRIST.table[getPieceIndex(move.piece)][move.toRow * 8 + move.toCol];
            nextHash ^= ZOBRIST.blackToMove;

            const { tempBoard, aiScoreGain } = game.simulateFullMove(move.fromRow, move.fromCol, move.toRow, move.toCol, game.currentPlayer);
            const childGame = new Check10Game();
            childGame.hydrateFromServerState({
                board: tempBoard,
                currentPlayer: game.currentPlayer === 'white' ? 'black' : 'white',
                whiteScore: game.whiteScore + (game.currentPlayer === 'white' ? aiScoreGain : 0),
                blackScore: game.blackScore + (game.currentPlayer === 'black' ? aiScoreGain : 0),
            });
            
            const eval = aiScoreGain + alphaBetaSearch(childGame, depth - 1, alpha, beta, false, aiRootColor, nextHash);
            bestValue = Math.max(bestValue, eval);
            alpha = Math.max(alpha, eval);
            
            if (beta <= alpha) break;
        }
    } else { // Minimizing Player
        bestValue = Infinity;
        for (const move of possibleMoves) {
            let nextHash = currentHash;
            nextHash ^= ZOBRIST.table[getPieceIndex(move.piece)][move.fromRow * 8 + move.fromCol];
            nextHash ^= ZOBRIST.table[getPieceIndex(move.piece)][move.toRow * 8 + move.toCol];
            nextHash ^= ZOBRIST.blackToMove;

            const { tempBoard, aiScoreGain } = game.simulateFullMove(move.fromRow, move.fromCol, move.toRow, move.toCol, game.currentPlayer);
            const childGame = new Check10Game();
            childGame.hydrateFromServerState({
                board: tempBoard,
                currentPlayer: game.currentPlayer === 'white' ? 'black' : 'white',
                whiteScore: game.whiteScore + (game.currentPlayer === 'white' ? aiScoreGain : 0),
                blackScore: game.blackScore + (game.currentPlayer === 'black' ? aiScoreGain : 0),
            });

            const eval = -aiScoreGain + alphaBetaSearch(childGame, depth - 1, alpha, beta, true, aiRootColor, nextHash);
            bestValue = Math.min(bestValue, eval);
            beta = Math.min(beta, eval);
            
            if (beta <= alpha) break;
        }
    }

    let flag = 'EXACT';
    if (bestValue <= originalAlpha) flag = 'UPPERBOUND';
    else if (bestValue >= beta) flag = 'LOWERBOUND';
    transpositionTable.set(currentHash, { value: bestValue, depth: depth, flag: flag });
    
    return bestValue;
}

/**
 * Evaluates a static board position and returns a score from the AI's perspective.
 */
function evaluateBoard(game, aiRootColor) {
    let score = 0;
    const opponentColor = aiRootColor === 'white' ? 'black' : 'white';
    const aiScore = aiRootColor === 'white' ? game.whiteScore : game.blackScore;
    const opponentScore = opponentColor === 'white' ? game.whiteScore : game.blackScore;
    score += (aiScore - opponentScore);

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = game.board[r][c];
            if (piece) {
                let pieceValue = 0;
                if (piece.promoted) pieceValue += piece.number * 0.5;
                if (piece.color === 'white') pieceValue += (7 - r) * 0.1;
                else pieceValue += r * 0.1;
                if (piece.color === aiRootColor) score += pieceValue;
                else score -= pieceValue;
            }
        }
    }
    return score;
}

// =================================================================
//                     SERVER STARTUP
// =================================================================
app.listen(PORT, () => {
    console.log(`Check10 AI Server running on http://localhost:${PORT}`);
});
