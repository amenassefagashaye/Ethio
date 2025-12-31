import { serve } from "@std/http";
import { v4 } from "@std/uuid";
import { acceptable, acceptWebSocket, WebSocket } from "@std/websocket";   

// Game imports
import { GameManager } from "./game-manager.ts";
import { RoomManager } from "./room-manager.ts";

const gameManager = new GameManager();
const roomManager = new RoomManager(gameManager);

// Serve static files
async function serveStatic(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  
  try {
    const file = await Deno.readFile(`./public${filePath}`);
    const contentType = getContentType(filePath);
    
    return new Response(file, {
      headers: { "Content-Type": contentType }
    });
  } catch {
    return new Response("File not found", { status: 404 });
  }
}

function getContentType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    "html": "text/html",
    "css": "text/css",
    "js": "application/javascript",
    "json": "application/json",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif"
  };
  return types[ext || ""] || "text/plain";
}

// API Routes
async function handleApi(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  
  try {
    // Players endpoint
    if (path === "/api/players" && req.method === "GET") {
      const players = gameManager.getOnlinePlayers();
      return Response.json(players);
    }
    
    // Create room
    if (path === "/api/rooms/create" && req.method === "POST") {
      const body = await req.json();
      const result = await roomManager.createRoom(body);
      return Response.json(result);
    }
    
    // Join room
    if (path === "/api/rooms/join" && req.method === "POST") {
      const body = await req.json();
      const result = await roomManager.joinRoom(body);
      return Response.json(result);
    }
    
    // Start game
    if (path === "/api/game/start" && req.method === "POST") {
      const body = await req.json();
      const result = await gameManager.startGame(body.roomCode);
      return Response.json(result);
    }
    
    // Get available rooms
    if (path === "/api/rooms" && req.method === "GET") {
      const rooms = roomManager.getAvailableRooms();
      return Response.json(rooms);
    }
    
    // Get room info
    if (path.startsWith("/api/rooms/") && req.method === "GET") {
      const roomCode = path.split("/").pop();
      if (roomCode) {
        const room = roomManager.getRoom(roomCode);
        return Response.json(room || { error: "Room not found" });
      }
    }
    
    return new Response("Not found", { status: 404 });
  } catch (error) {
    console.error("API error:", error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}

// WebSocket handler
async function handleWebSocket(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  
  if (path.startsWith("/ws/") && acceptable(req)) {
    const roomCode = path.split("/").pop();
    
    if (roomCode) {
      const { socket, response } = acceptWebSocket({
        conn: req.conn,
        bufReader: req.r,
        bufWriter: req.w,
        headers: req.headers,
      });
      
      // Handle WebSocket connection
      handleWsConnection(socket, roomCode);
      
      return response;
    }
  }
  
  return new Response("Not found", { status: 404 });
}

async function handleWsConnection(socket: WebSocket, roomCode: string) {
  console.log(`New WebSocket connection for room: ${roomCode}`);
  
  let playerId: string | null = null;
  
  try {
    for await (const event of socket) {
      if (typeof event === "string") {
        try {
          const data = JSON.parse(event);
          
          switch (data.type) {
            case "join":
              playerId = data.playerId;
              roomManager.addPlayerToRoom(roomCode, playerId, socket);
              broadcastToRoom(roomCode, {
                type: "playerJoined",
                playerId: data.playerId,
                playerName: data.playerName,
                timestamp: Date.now()
              }, playerId);
              break;
              
            case "leave":
              roomManager.removePlayerFromRoom(roomCode, data.playerId);
              broadcastToRoom(roomCode, {
                type: "playerLeft",
                playerId: data.playerId,
                timestamp: Date.now()
              });
              break;
              
            case "chat":
              broadcastToRoom(roomCode, {
                type: "chat",
                playerId: data.playerId,
                playerName: data.playerName,
                message: data.message,
                timestamp: Date.now()
              });
              break;
              
            case "startGame":
              const room = roomManager.getRoom(roomCode);
              if (room && room.hostId === data.playerId) {
                broadcastToRoom(roomCode, {
                  type: "gameStarted",
                  gameType: room.gameType,
                  timestamp: Date.now()
                });
              }
              break;
              
            case "callNumber":
              broadcastToRoom(roomCode, {
                type: "numberCalled",
                number: data.number,
                caller: data.caller,
                timestamp: Date.now()
              });
              break;
              
            case "markNumber":
              broadcastToRoom(roomCode, {
                type: "playerMarked",
                playerId: data.playerId,
                number: data.number,
                timestamp: Date.now()
              });
              break;
              
            case "claimWin":
              // Verify win and broadcast
              broadcastToRoom(roomCode, {
                type: "winner",
                playerId: data.playerId,
                pattern: data.pattern,
                timestamp: Date.now()
              });
              break;
              
            case "ping":
              socket.send(JSON.stringify({ type: "pong" }));
              break;
          }
        } catch (error) {
          console.error("Error handling WebSocket message:", error);
        }
      }
    }
  } catch (error) {
    console.error("WebSocket error:", error);
  } finally {
    // Clean up on disconnect
    if (playerId) {
      roomManager.removePlayerFromRoom(roomCode, playerId);
      broadcastToRoom(roomCode, {
        type: "playerLeft",
        playerId: playerId,
        timestamp: Date.now()
      });
    }
  }
}

function broadcastToRoom(roomCode: string, message: any, excludePlayerId?: string) {
  const room = roomManager.getRoom(roomCode);
  if (!room) return;
  
  const messageStr = JSON.stringify(message);
  
  for (const [playerId, socket] of room.players) {
    if (playerId !== excludePlayerId && socket.readyState === WebSocket.OPEN) {
      socket.send(messageStr).catch(console.error);
    }
  }
}

// Main request handler
async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  
  // Handle WebSocket
  if (url.pathname.startsWith("/ws/")) {
    return handleWebSocket(req);
  }
  
  // Handle API
  if (url.pathname.startsWith("/api/")) {
    return handleApi(req);
  }
  
  // Serve static files
  return serveStatic(req);
}

// Start server
const port = 8000;
console.log(`Server running on http://localhost:${port}`);


serve(handler, { port });

