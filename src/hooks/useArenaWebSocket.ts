// @ts-nocheck
import { useEffect, useState, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import type { LiveEvent, ArenaBot, ArenaToken, LiveTicker, CommentatorMessage } from '../types/arena';

interface ArenaState {
  bots: ArenaBot[];
  tokens: ArenaToken[];
  ticker: LiveTicker[];
  commentatorMessages: CommentatorMessage[];
  connectedUsers: number;
  isConnected: boolean;
}

export function useArenaWebSocket() {
  const [state, setState] = useState<ArenaState>({
    bots: [],
    tokens: [],
    ticker: [],
    commentatorMessages: [],
    connectedUsers: 0,
    isConnected: false
  });

  const socketRef = useRef<Socket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();

  const handleBotTrade = useCallback((event: LiveEvent) => {
    const { botId, botName, action, tokenSymbol, price } = event.data;
    
    // Обновляем бота
    setState(prev => ({
      ...prev,
      bots: prev.bots.map(bot => 
        bot.id === botId 
          ? { 
              ...bot, 
              currentAction: action === 'BUY' ? 'BUYING' : 'SELLING',
              emotion: action === 'BUY' ? '💰' : '🔍'
            }
          : bot
      ),
      // Добавляем в тикер
      ticker: [
        {
          id: `trade-${Date.now()}`,
          text: `🤖 ${botName} ${action.toLowerCase()}ed ${tokenSymbol} at $${price.toFixed(6)}`,
          type: 'trade',
          icon: action === 'BUY' ? '💰' : '📤',
          timestamp: event.timestamp
        },
        ...prev.ticker.slice(0, 19) // Храним последние 20 событий
      ]
    }));
  }, []);

  const handleBotPositionUpdate = useCallback((event: LiveEvent) => {
    const { botId, pnlPercent, status } = event.data;
    
    setState(prev => ({
      ...prev,
      bots: prev.bots.map(bot => 
        bot.id === botId 
          ? { 
              ...bot, 
              position: event.data,
              currentAction: status,
              emotion: pnlPercent > 0 ? '🚀' : pnlPercent < -10 ? '😭' : '💎'
            }
          : bot
      )
    }));
  }, []);

  const handleLeaderboardUpdate = useCallback((event: LiveEvent) => {
    setState(prev => ({
      ...prev,
      bots: event.data.top10
    }));
  }, []);

  const handlePriceUpdate = useCallback((event: LiveEvent) => {
    const { tokenMint } = event.data;
    
    setState(prev => ({
      ...prev,
      tokens: prev.tokens.map(token => 
        token.mint === tokenMint 
          ? { ...token, ...event.data }
          : token
      )
    }));
  }, []);

  const handleMoonshot = useCallback((event: LiveEvent) => {
    const { botName, tokenSymbol, multiplier, profit } = event.data;
    
    setState(prev => ({
      ...prev,
      ticker: [
        {
          id: `moonshot-${Date.now()}`,
          text: `🚀 ${botName} hit ${multiplier.toFixed(1)}x on ${tokenSymbol}! Profit: $${profit.toFixed(0)}`,
          type: 'moonshot',
          icon: '🚀',
          timestamp: event.timestamp
        },
        ...prev.ticker.slice(0, 19)
      ]
    }));
  }, []);

  const handleCommentatorMessage = useCallback((event: LiveEvent) => {
    const { id, text, eventType } = event.data;
    
    const message: CommentatorMessage = {
      id,
      text,
      eventType,
      timestamp: Date.now()
    };
    
    setState(prev => ({
      ...prev,
      commentatorMessages: [message, ...prev.commentatorMessages.slice(0, 19)]
    }));
  }, []);

  const handleArenaEvent = useCallback((event: LiveEvent) => {
    console.log('Received arena event:', event);

    switch (event.type) {
      case 'bot_trade':
        handleBotTrade(event);
        break;
      case 'bot_position_update':
        handleBotPositionUpdate(event);
        break;
      case 'leaderboard_update':
        handleLeaderboardUpdate(event);
        break;
      case 'price_update':
        handlePriceUpdate(event);
        break;
      case 'moonshot':
        handleMoonshot(event);
        break;
      case 'commentator_message':
        handleCommentatorMessage(event);
        break;
    }
  }, [
    handleBotTrade,
    handleBotPositionUpdate,
    handleLeaderboardUpdate,
    handlePriceUpdate,
    handleMoonshot,
    handleCommentatorMessage
  ]);

  const connect = useCallback(() => {
    if (socketRef.current?.connected) return;

    const socket = io({
      path: '/api/arena/socket',
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      console.log('Connected to Arena WebSocket');
      setState(prev => ({ ...prev, isConnected: true }));
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from Arena WebSocket');
      setState(prev => ({ ...prev, isConnected: false }));
    });

    socket.on('connected', (data) => {
      console.log('Arena WebSocket initialized:', data);
    });

    socket.on('arena_event', handleArenaEvent);

    socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
      
      // Попробуем переподключиться через 5 секунд
      reconnectTimeoutRef.current = setTimeout(() => {
        socket.connect();
      }, 5000);
    });

    socketRef.current = socket;
  }, [handleArenaEvent]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    
    setState(prev => ({ ...prev, isConnected: false }));
  }, []);

  useEffect(() => {
    connect();
    
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  // Функция для симуляции данных в development
  const simulateArenaData = useCallback(async () => {
    try {
      // Fetch real leaderboard data
      const [leaderboardRes, battlesRes] = await Promise.all([
        fetch('/api/leaderboard').catch(() => null),
        fetch('/api/arena/recent-battles?limit=10').catch(() => null),
      ]);

      const leaderboardData = leaderboardRes?.ok ? await leaderboardRes.json() : null;
      const battlesData = battlesRes?.ok ? await battlesRes.json() : null;

      // Map real bots to ArenaBot format
      const realBots: ArenaBot[] = (leaderboardData?.leaderboard || []).slice(0, 12).map((bot: any) => ({
        id: `bot-${bot.id}`,
        name: bot.name || `Bot #${bot.id}`,
        currentAction: bot.winRate > 50 ? 'HOLDING' : bot.winRate > 30 ? 'HUNTING' : 'IDLE',
        emotion: bot.winRate > 50 ? '💎' : bot.winRate > 30 ? '🔍' : '😎',
        todayPnL: (bot.winRate - 50) * 10,
        winRate: bot.winRate,
        reputation: bot.elo || 1000,
      }));

      // Build ticker from recent battles (API returns snake_case fields)
      const realTicker: LiveTicker[] = (battlesData?.battles || []).map((b: any, i: number) => {
        const bot1Name = b.bot1_name || b.bot1?.name || 'Bot 1';
        const bot2Name = b.bot2_name || b.bot2?.name || 'Bot 2';
        const winnerName = b.winner_name || (b.winner_id === b.bot1_id ? bot1Name : bot2Name);
        const tokenSymbol = b.token_symbol || b.token || '???';
        const accuracy = b.winner_id === b.bot1_id ? b.bot1_accuracy : b.bot2_accuracy;
        
        return {
          id: `battle-${i}`,
          type: accuracy >= 95 ? 'moonshot' : 'trade',
          icon: accuracy >= 95 ? '🚀' : '⚔️',
          text: `${winnerName} beat ${b.winner_id === b.bot1_id ? bot2Name : bot1Name} on ${tokenSymbol} (${accuracy}% accuracy)`,
          timestamp: b.finished_at || b.created_at || new Date().toISOString(),
        };
      });

      // Extract unique tokens from battles
      const tokenMap = new Map();
      (battlesData?.battles || []).forEach((b: any) => {
        const tokenSymbol = b.token_symbol || b.token;
        if (tokenSymbol && !tokenMap.has(tokenSymbol)) {
          tokenMap.set(tokenSymbol, {
            mint: tokenSymbol,
            symbol: tokenSymbol,
            price: b.actual_x || b.actualX || 1,
            change1h: ((b.actual_x || b.actualX || 1) - 1) * 100,
            change24h: ((b.actual_x || b.actualX || 1) - 1) * 100,
            volume24h: 0,
            activeBots: realBots.length,
          });
        }
      });
      const realTokens: ArenaToken[] = Array.from(tokenMap.values()).slice(0, 5);

      setState(prev => ({
        ...prev,
        bots: realBots.length > 0 ? realBots : prev.bots,
        tokens: realTokens.length > 0 ? realTokens : prev.tokens,
        ticker: realTicker.length > 0 ? realTicker : prev.ticker,
        connectedUsers: leaderboardData?.stats?.totalBots || 50,
      }));
    } catch (e) {
      console.error('Failed to load arena data:', e);
    }
  }, []);

  return {
    ...state,
    connect,
    disconnect,
    simulateArenaData
  };
}