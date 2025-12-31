import { v4 } from "@std/uuid";

export interface Game {
  id: string;
  roomCode: string;
  type: string;
  players: Map<string, GamePlayer>;
  calledNumbers: number[];
  currentNumber: number | null;
  gameStarted: boolean;
  gameEnded: boolean;
  winner: string | null;
  winPattern: string | null;
  boardSeed: number;
  settings: GameSettings;
}

export interface GamePlayer {
  id: string;
  name: string;
  board: number[];
  markedNumbers: Set<number>;
  isReady: boolean;
  hasWon: boolean;
  winTime: number | null;
  score: number;
}

export interface GameSettings {
  stake: number;
  autoCall: boolean;
  callInterval: number;
  winPatterns: string[];
}

export class GameManager {
  private games: Map<string, Game> = new Map();
  private onlinePlayers: Set<string> = new Set();

  constructor() {
    // Clean up old games periodically
    setInterval(() => this.cleanupOldGames(), 60000); // Every minute
  }

  createGame(roomCode: string, gameType: string, settings: GameSettings): Game {
    const gameId = v4.generate();
    
    const game: Game = {
      id: gameId,
      roomCode,
      type: gameType,
      players: new Map(),
      calledNumbers: [],
      currentNumber: null,
      gameStarted: false,
      gameEnded: false,
      winner: null,
      winPattern: null,
      boardSeed: Math.floor(Math.random() * 1000000),
      settings
    };
    
    this.games.set(roomCode, game);
    return game;
  }

  startGame(roomCode: string): { success: boolean; board?: number[]; error?: string } {
    const game = this.games.get(roomCode);
    
    if (!game) {
      return { success: false, error: "Game not found" };
    }
    
    if (game.gameStarted) {
      return { success: false, error: "Game already started" };
    }
    
    if (game.players.size < 2) {
      return { success: false, error: "Need at least 2 players to start" };
    }
    
    game.gameStarted = true;
    
    // Generate boards for all players
    for (const player of game.players.values()) {
      player.board = this.generateBoard(game.type, game.boardSeed);
      player.markedNumbers = new Set();
    }
    
    return {
      success: true,
      board: this.generateBoard(game.type, game.boardSeed)
    };
  }

  addPlayerToGame(roomCode: string, playerId: string, playerName: string): boolean {
    const game = this.games.get(roomCode);
    if (!game) return false;
    
    if (game.gameStarted) {
      return false; // Cannot join after game started
    }
    
    const player: GamePlayer = {
      id: playerId,
      name: playerName,
      board: [],
      markedNumbers: new Set(),
      isReady: false,
      hasWon: false,
      winTime: null,
      score: 0
    };
    
    game.players.set(playerId, player);
    this.onlinePlayers.add(playerId);
    
    return true;
  }

  removePlayerFromGame(roomCode: string, playerId: string): void {
    const game = this.games.get(roomCode);
    if (!game) return;
    
    game.players.delete(playerId);
    this.onlinePlayers.delete(playerId);
    
    // If no players left, end game
    if (game.players.size === 0) {
      this.games.delete(roomCode);
    }
  }

  callNumber(roomCode: string): number | null {
    const game = this.games.get(roomCode);
    if (!game || !game.gameStarted || game.gameEnded) return null;
    
    const number = this.generateRandomNumber(game.type, game.calledNumbers);
    if (number === null) return null;
    
    game.currentNumber = number;
    game.calledNumbers.push(number);
    
    return number;
  }

  markNumber(roomCode: string, playerId: string, number: number): boolean {
    const game = this.games.get(roomCode);
    if (!game || !game.gameStarted) return false;
    
    const player = game.players.get(playerId);
    if (!player) return false;
    
    player.markedNumbers.add(number);
    
    // Check for win
    const winPattern = this.checkForWin(player.board, player.markedNumbers, game.settings.winPatterns);
    if (winPattern) {
      game.winner = playerId;
      game.winPattern = winPattern;
      game.gameEnded = true;
      player.hasWon = true;
      player.winTime = Date.now();
      player.score += this.calculateScore(game.settings.stake, game.players.size);
    }
    
    return true;
  }

  getGame(roomCode: string): Game | undefined {
    return this.games.get(roomCode);
  }

  getOnlinePlayers(): Array<{ id: string; name: string }> {
    const players = [];
    for (const game of this.games.values()) {
      for (const player of game.players.values()) {
        players.push({ id: player.id, name: player.name });
      }
    }
    return players;
  }

  private generateBoard(gameType: string, seed: number): number[] {
    // Use seed for reproducible random boards
    const random = (min: number, max: number) => {
      return Math.floor(this.seededRandom(seed) * (max - min + 1)) + min;
    };
    
    switch (gameType) {
      case '75ball':
        return this.generate75BallBoard(random);
      case '90ball':
        return this.generate90BallBoard(random);
      case '30ball':
        return this.generate30BallBoard(random);
      case 'pattern':
        return this.generatePatternBoard(random);
      default:
        return this.generate75BallBoard(random);
    }
  }

  private generate75BallBoard(random: (min: number, max: number) => number): number[] {
    const board: number[] = [];
    const columns = [
      [1, 15], [16, 30], [31, 45], [46, 60], [61, 75]
    ];
    
    for (let col = 0; col < 5; col++) {
      const [min, max] = columns[col];
      const numbers = new Set<number>();
      
      while (numbers.size < 5) {
        numbers.add(random(min, max));
      }
      
      const colNumbers = Array.from(numbers).sort((a, b) => a - b);
      board.push(...colNumbers);
    }
    
    return board;
  }

  private generate90BallBoard(random: (min: number, max: number) => number): number[] {
    const board: number[] = [];
    const columns = [
      [1, 10], [11, 20], [21, 30], [31, 40], [41, 50],
      [51, 60], [61, 70], [71, 80], [81, 90]
    ];
    
    for (let col = 0; col < 9; col++) {
      const [min, max] = columns[col];
      const numbers = new Set<number>();
      const count = random(1, 3); // 1-3 numbers per column
      
      while (numbers.size < count) {
        numbers.add(random(min, max));
      }
      
      board.push(...Array.from(numbers));
    }
    
    return board;
  }

  private generate30BallBoard(random: (min: number, max: number) => number): number[] {
    const board: number[] = [];
    const numbers = new Set<number>();
    
    while (numbers.size < 9) {
      numbers.add(random(1, 30));
    }
    
    return Array.from(numbers).sort((a, b) => a - b);
  }

  private generatePatternBoard(random: (min: number, max: number) => number): number[] {
    return this.generate75BallBoard(random);
  }

  private generateRandomNumber(gameType: string, calledNumbers: number[]): number | null {
    let maxNumber: number;
    
    switch (gameType) {
      case '75ball':
      case 'pattern':
        maxNumber = 75;
        break;
      case '90ball':
        maxNumber = 90;
        break;
      case '30ball':
        maxNumber = 30;
        break;
      default:
        maxNumber = 75;
    }
    
    if (calledNumbers.length >= maxNumber) {
      return null; // All numbers called
    }
    
    let number: number;
    do {
      number = Math.floor(Math.random() * maxNumber) + 1;
    } while (calledNumbers.includes(number));
    
    return number;
  }

  private checkForWin(board: number[], markedNumbers: Set<number>, winPatterns: string[]): string | null {
    // Convert board to 5x5 grid for checking
    const grid = this.boardToGrid(board);
    
    for (const pattern of winPatterns) {
      if (this.checkPattern(grid, markedNumbers, pattern)) {
        return pattern;
      }
    }
    
    return null;
  }

  private checkPattern(grid: number[][], markedNumbers: Set<number>, pattern: string): boolean {
    switch (pattern) {
      case 'row':
        for (let row = 0; row < 5; row++) {
          let complete = true;
          for (let col = 0; col < 5; col++) {
            if (row === 2 && col === 2) continue; // Free space
            if (!markedNumbers.has(grid[row][col])) {
              complete = false;
              break;
            }
          }
          if (complete) return true;
        }
        return false;
        
      case 'column':
        for (let col = 0; col < 5; col++) {
          let complete = true;
          for (let row = 0; row < 5; row++) {
            if (row === 2 && col === 2) continue; // Free space
            if (!markedNumbers.has(grid[row][col])) {
              complete = false;
              break;
            }
          }
          if (complete) return true;
        }
        return false;
        
      case 'diagonal':
        // Main diagonal
        let diag1Complete = true;
        for (let i = 0; i < 5; i++) {
          if (i === 2) continue; // Free space
          if (!markedNumbers.has(grid[i][i])) {
            diag1Complete = false;
            break;
          }
        }
        if (diag1Complete) return true;
        
        // Anti-diagonal
        let diag2Complete = true;
        for (let i = 0; i < 5; i++) {
          if (i === 2) continue; // Free space
          if (!markedNumbers.has(grid[i][4 - i])) {
            diag2Complete = false;
            break;
          }
        }
        return diag2Complete;
        
      case 'four-corners':
        return markedNumbers.has(grid[0][0]) &&
               markedNumbers.has(grid[0][4]) &&
               markedNumbers.has(grid[4][0]) &&
               markedNumbers.has(grid[4][4]);
        
      case 'full-house':
        for (let row = 0; row < 5; row++) {
          for (let col = 0; col < 5; col++) {
            if (row === 2 && col === 2) continue; // Free space
            if (!markedNumbers.has(grid[row][col])) {
              return false;
            }
          }
        }
        return true;
        
      default:
        return false;
    }
  }

  private boardToGrid(board: number[]): number[][] {
    const grid: number[][] = Array(5).fill(null).map(() => Array(5).fill(0));
    
    for (let i = 0; i < 25; i++) {
      const row = Math.floor(i / 5);
      const col = i % 5;
      grid[row][col] = board[i] || 0;
    }
    
    return grid;
  }

  private calculateScore(stake: number, playerCount: number): number {
    const pot = stake * playerCount;
    return Math.floor(pot * 0.8); // 80% to winner
  }

  private seededRandom(seed: number): number {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  }

  private cleanupOldGames(): void {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    
    for (const [roomCode, game] of this.games.entries()) {
      // Remove games that ended more than an hour ago
      if (game.gameEnded && game.players.size === 0) {
        this.games.delete(roomCode);
      }
    }
  }
}