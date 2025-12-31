import { WebSocket } from "@std/websocket";
import { v4 } from "@std/uuid";

export interface Player {
  id: string;
  name: string;
  socket: WebSocket;
  isHost: boolean;
  isReady: boolean;
  score: number;
  board?: number[];
}

export interface Room {
  id: string;
  code: string;
  name: string;
  hostId: string;
  hostName: string;
  gameType: string;
  stake: number;
  maxPlayers: number;
  players: Map<string, Player>;
  gameStarted: boolean;
  createdAt: number;
  settings: {
    autoCallNumbers: boolean;
    callInterval: number;
    winPatterns: string[];
  };
}

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private roomCodes: Set<string> = new Set();
  private gameManager: any;

  constructor(gameManager: any) {
    this.gameManager = gameManager;
  }

  generateRoomCode(): string {
    const words = [
      "ለምን", "ቢንጎ", "አሰፋ", "ደስታ", "እድል", "ሽልማት",
      "ደስተኛ", "አሸናፊ", "ቻንስ", "ጨዋታ", "ደስ", "ሆኖ"
    ];
    
    let code: string;
    do {
      const word1 = words[Math.floor(Math.random() * words.length)];
      const word2 = words[Math.floor(Math.random() * words.length)];
      code = `${word1}-${word2}`;
    } while (this.roomCodes.has(code));
    
    this.roomCodes.add(code);
    return code;
  }

  async createRoom(data: {
    hostName: string;
    roomName: string;
    maxPlayers: number;
    gameType: string;
    stake: number;
  }) {
    const roomId = v4.generate();
    const roomCode = this.generateRoomCode();
    
    const room: Room = {
      id: roomId,
      code: roomCode,
      name: data.roomName,
      hostId: roomId, // Temporary, will be updated when host connects via WebSocket
      hostName: data.hostName,
      gameType: data.gameType,
      stake: data.stake,
      maxPlayers: data.maxPlayers,
      players: new Map(),
      gameStarted: false,
      createdAt: Date.now(),
      settings: {
        autoCallNumbers: true,
        callInterval: 7000,
        winPatterns: this.getWinPatterns(data.gameType)
      }
    };
    
    this.rooms.set(roomCode, room);
    
    // Generate player ID for host
    const playerId = v4.generate();
    
    return {
      success: true,
      roomCode,
      roomId,
      playerId,
      message: "Room created successfully"
    };
  }

  async joinRoom(data: {
    roomCode: string;
    playerName: string;
  }) {
    const room = this.rooms.get(data.roomCode);
    
    if (!room) {
      return {
        success: false,
        message: "Room not found"
      };
    }
    
    if (room.players.size >= room.maxPlayers) {
      return {
        success: false,
        message: "Room is full"
      };
    }
    
    if (room.gameStarted) {
      return {
        success: false,
        message: "Game has already started"
      };
    }
    
    const playerId = v4.generate();
    
    return {
      success: true,
      playerId,
      roomName: room.name,
      hostName: room.hostName,
      maxPlayers: room.maxPlayers,
      gameType: room.gameType,
      stake: room.stake,
      currentPlayers: room.players.size + 1
    };
  }

  addPlayerToRoom(roomCode: string, playerId: string, socket: WebSocket) {
    const room = this.rooms.get(roomCode);
    if (!room) return;
    
    // If this is the first player and host hasn't been set, make them host
    if (room.players.size === 0 && !room.hostId) {
      room.hostId = playerId;
    }
    
    const player: Player = {
      id: playerId,
      name: `Player ${room.players.size + 1}`, // Will be updated when player sends name
      socket,
      isHost: playerId === room.hostId,
      isReady: false,
      score: 0
    };
    
    room.players.set(playerId, player);
    
    console.log(`Player ${playerId} joined room ${roomCode}. Total players: ${room.players.size}`);
  }

  removePlayerFromRoom(roomCode: string, playerId: string) {
    const room = this.rooms.get(roomCode);
    if (!room) return;
    
    room.players.delete(playerId);
    
    // If host left and there are other players, assign new host
    if (playerId === room.hostId && room.players.size > 0) {
      const newHost = Array.from(room.players.values())[0];
      newHost.isHost = true;
      room.hostId = newHost.id;
      room.hostName = newHost.name;
      
      // Notify players about new host
      this.broadcastToRoom(roomCode, {
        type: "newHost",
        hostId: newHost.id,
        hostName: newHost.name
      });
    }
    
    // If room is empty, delete it
    if (room.players.size === 0) {
      this.rooms.delete(roomCode);
      this.roomCodes.delete(roomCode);
      console.log(`Room ${roomCode} deleted`);
    }
  }

  getRoom(roomCode: string): Room | undefined {
    return this.rooms.get(roomCode);
  }

  getAvailableRooms() {
    const availableRooms: Array<{
      code: string;
      name: string;
      host: string;
      players: number;
      maxPlayers: number;
      gameType: string;
      stake: number;
      created: number;
    }> = [];
    
    for (const room of this.rooms.values()) {
      if (!room.gameStarted && room.players.size < room.maxPlayers) {
        availableRooms.push({
          code: room.code,
          name: room.name,
          host: room.hostName,
          players: room.players.size,
          maxPlayers: room.maxPlayers,
          gameType: room.gameType,
          stake: room.stake,
          created: room.createdAt
        });
      }
    }
    
    return availableRooms;
  }

  private broadcastToRoom(roomCode: string, message: any) {
    const room = this.rooms.get(roomCode);
    if (!room) return;
    
    const messageStr = JSON.stringify(message);
    
    for (const player of room.players.values()) {
      if (player.socket.readyState === WebSocket.OPEN) {
        player.socket.send(messageStr).catch(console.error);
      }
    }
  }

  private getWinPatterns(gameType: string): string[] {
    const patterns: Record<string, string[]> = {
      '75ball': ['row', 'column', 'diagonal', 'four-corners', 'full-house'],
      '90ball': ['one-line', 'two-lines', 'full-house'],
      '30ball': ['full-house'],
      'pattern': ['x-pattern', 'frame', 'postage-stamp', 'small-diamond']
    };
    
    return patterns[gameType] || patterns['75ball'];
  }
}