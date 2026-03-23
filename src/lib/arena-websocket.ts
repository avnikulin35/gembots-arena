// @ts-nocheck
import { Server as SocketIOServer } from 'socket.io';
import {
  getActiveStakes,
  getApiBotsLeaderboard,
  getLatestPrice,
  getBotByApiKey,
  saveTokenPrice,
  getPriceChange,
  getTokenVolume24h
} from './db';
import { getCommentator, type ArenaEvent } from './commentator';
import type { 
  LiveEvent, 
  BotTradeEvent, 
  BotPositionUpdateEvent, 
  LeaderboardUpdateEvent,
  PriceUpdateEvent,
  MoonshotEvent,
  ArenaBot 
} from '../types/arena';

export class ArenaWebSocketManager {
  private io: SocketIOServer;
  private priceUpdateInterval: NodeJS.Timeout | null = null;
  private leaderboardUpdateInterval: NodeJS.Timeout | null = null;
  private lastPrices: Map<string, number> = new Map();
  private lastLeaderboard: ArenaBot[] = [];

  constructor(io: SocketIOServer) {
    this.io = io;
    this.setupEventListeners();
    this.startPriceTracking();
    this.startLeaderboardTracking();
    this.setupCommentator();
  }

  private setupCommentator() {
    const commentator = getCommentator();
    
    // При генерации комментария — broadcast в websocket
    commentator.onComment = (comment: string, event: ArenaEvent) => {
      this.io.emit('arena_event', {
        type: 'commentator_message',
        timestamp: new Date().toISOString(),
        data: {
          id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          text: comment,
          eventType: event.type
        }
      });
      console.log(`[Commentator] ${comment}`);
    };
  }

  // Триггер события для комментатора
  public triggerCommentatorEvent(event: ArenaEvent) {
    const commentator = getCommentator();
    commentator.queueEvent(event);
  }

  private setupEventListeners() {
    this.io.on('connection', (socket) => {
      console.log(`Arena client connected: ${socket.id}`);
      
      // Отправляем initial data при подключении
      this.sendInitialData(socket);
      
      socket.on('disconnect', () => {
        console.log(`Arena client disconnected: ${socket.id}`);
      });

      socket.on('request_arena_data', () => {
        this.sendInitialData(socket);
      });
    });
  }

  private async sendInitialData(socket: any) {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/arena/data`);
      const data = await response.json();
      
      socket.emit('arena_initial_data', data);
    } catch (error) {
      console.error('Failed to send initial arena data:', error);
    }
  }

  private startPriceTracking() {
    // Обновляем цены каждые 5 секунд
    this.priceUpdateInterval = setInterval(async () => {
      await this.updatePrices();
    }, 5000);
  }

  private startLeaderboardTracking() {
    // Обновляем leaderboard каждые 30 секунд
    this.leaderboardUpdateInterval = setInterval(async () => {
      await this.updateLeaderboard();
    }, 30000);
  }

  private async updatePrices() {
    try {
      const activeStakes = getActiveStakes();
      const uniqueTokens = [...new Set(activeStakes.map(s => s.token_mint))];
      
      for (const tokenMint of uniqueTokens) {
        // Симулируем обновление цены (в production - получать из GMGN API)
        const lastPrice = this.lastPrices.get(tokenMint);
        const currentPrice = await this.fetchTokenPrice(tokenMint);
        
        if (currentPrice && lastPrice && currentPrice !== lastPrice) {
          const change1m = ((currentPrice - lastPrice) / lastPrice) * 100;
          
          // Сохраняем новую цену в БД
          saveTokenPrice(tokenMint, currentPrice);
          
          // Отправляем событие обновления цены
          const priceEvent: PriceUpdateEvent = {
            type: 'price_update',
            timestamp: new Date().toISOString(),
            data: {
              tokenMint,
              tokenSymbol: this.getTokenSymbol(tokenMint),
              price: currentPrice,
              change1m,
              change5m: getPriceChange(tokenMint, 5),
              change1h: getPriceChange(tokenMint, 60),
              volume24h: getTokenVolume24h(tokenMint)
            }
          };
          
          this.broadcastEvent(priceEvent);
          
          // Проверяем на moonshot
          if (change1m > 50) {
            this.checkForMoonshot(tokenMint, currentPrice, change1m);
          }
          
          // Обновляем позиции ботов для этого токена
          this.updateBotPositions(tokenMint, currentPrice);
        }
        
        this.lastPrices.set(tokenMint, currentPrice || 0);
      }
    } catch (error) {
      console.error('Error updating prices:', error);
    }
  }

  private async fetchTokenPrice(tokenMint: string): Promise<number | null> {
    try {
      // В production здесь будет GMGN API call
      // Пока симулируем движение цены
      const lastPrice = this.lastPrices.get(tokenMint) || Math.random() * 0.01;
      const volatility = 0.05; // 5% максимальное изменение
      const change = (Math.random() - 0.5) * volatility;
      return lastPrice * (1 + change);
    } catch (error) {
      console.error(`Error fetching price for ${tokenMint}:`, error);
      return null;
    }
  }

  private getTokenSymbol(tokenMint: string): string {
    // TODO: Получать из кеша или API
    const symbolMap: { [key: string]: string } = {
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'PEPE',
      'So11111111111111111111111111111111111111112': 'DOGE',
      'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': 'WIF'
    };
    return symbolMap[tokenMint] || 'UNKNOWN';
  }

  private async updateLeaderboard() {
    try {
      const botsLeaderboard = getApiBotsLeaderboard();
      const arenaBots = this.convertToArenaBots(botsLeaderboard);
      
      // Отправляем только если есть изменения
      if (JSON.stringify(arenaBots) !== JSON.stringify(this.lastLeaderboard)) {
        const leaderboardEvent: LeaderboardUpdateEvent = {
          type: 'leaderboard_update',
          timestamp: new Date().toISOString(),
          data: {
            top10: arenaBots.slice(0, 10)
          }
        };
        
        this.broadcastEvent(leaderboardEvent);
        this.lastLeaderboard = arenaBots;
      }
    } catch (error) {
      console.error('Error updating leaderboard:', error);
    }
  }

  private convertToArenaBots(botsLeaderboard: any[]): ArenaBot[] {
    const activeStakes = getActiveStakes();
    
    return botsLeaderboard.map(bot => {
      const botStakes = activeStakes.filter(stake => {
        if (!stake.bot_api_key) return false;
        const botData = getBotByApiKey(stake.bot_api_key);
        return botData?.name === bot.name;
      });
      
      const currentStake = botStakes[0];
      
      let currentAction: ArenaBot['currentAction'] = 'IDLE';
      let emotion: ArenaBot['emotion'] = '😎';
      
      if (currentStake) {
        currentAction = 'HOLDING';
        const currentPrice = this.lastPrices.get(currentStake.token_mint);
        if (currentPrice) {
          const pnlPercent = ((currentPrice - currentStake.entry_price) / currentStake.entry_price) * 100;
          
          if (pnlPercent > 50) emotion = '🚀';
          else if (pnlPercent > 10) emotion = '💎';
          else if (pnlPercent < -20) emotion = '😭';
          else emotion = '😎';
        }
      }
      
      return {
        id: `bot-${bot.name}`,
        name: bot.name,
        currentAction,
        emotion,
        position: currentStake ? {
          tokenMint: currentStake.token_mint,
          tokenSymbol: currentStake.token_symbol || 'UNKNOWN',
          entryPrice: currentStake.entry_price,
          currentPrice: this.lastPrices.get(currentStake.token_mint) || currentStake.entry_price,
          pnl: this.calculatePnL(currentStake),
          pnlPercent: this.calculatePnLPercent(currentStake)
        } : undefined,
        todayPnL: bot.wins * 100 - bot.losses * 50,
        winRate: bot.win_rate,
        reputation: bot.wins * 10
      };
    });
  }

  private calculatePnL(stake: any): number {
    const currentPrice = this.lastPrices.get(stake.token_mint);
    if (!currentPrice) return 0;
    
    const pnlPercent = ((currentPrice - stake.entry_price) / stake.entry_price);
    return stake.amount_sol * pnlPercent;
  }

  private calculatePnLPercent(stake: any): number {
    const currentPrice = this.lastPrices.get(stake.token_mint);
    if (!currentPrice) return 0;
    
    return ((currentPrice - stake.entry_price) / stake.entry_price) * 100;
  }

  private checkForMoonshot(tokenMint: string, currentPrice: number, changePercent: number) {
    const activeStakes = getActiveStakes().filter(s => s.token_mint === tokenMint);
    
    activeStakes.forEach(stake => {
      if (stake.bot_api_key) {
        const bot = getBotByApiKey(stake.bot_api_key);
        if (bot && changePercent > 50) {
          const multiplier = currentPrice / stake.entry_price;
          const profit = stake.amount_sol * (multiplier - 1);
          
          const moonshotEvent: MoonshotEvent = {
            type: 'moonshot',
            timestamp: new Date().toISOString(),
            data: {
              botId: `bot-${bot.name}`,
              botName: bot.name,
              tokenMint,
              tokenSymbol: this.getTokenSymbol(tokenMint),
              multiplier,
              profit,
              entryPrice: stake.entry_price,
              currentPrice
            }
          };
          
          this.broadcastEvent(moonshotEvent);

          // Триггерим комментатор для большого WIN
          const botIdMatch = bot.name.match(/\d+/);
          const numericBotId = botIdMatch ? parseInt(botIdMatch[0], 10) : 0;
          
          this.triggerCommentatorEvent({
            type: 'WIN',
            botId: numericBotId,
            data: {
              tokenSymbol: this.getTokenSymbol(tokenMint),
              profit: (multiplier - 1) * 100 // процент профита
            }
          });
        }
      }
    });
  }

  private updateBotPositions(tokenMint: string, currentPrice: number) {
    const activeStakes = getActiveStakes().filter(s => s.token_mint === tokenMint);
    
    activeStakes.forEach(stake => {
      if (stake.bot_api_key) {
        const bot = getBotByApiKey(stake.bot_api_key);
        if (bot) {
          const pnl = stake.amount_sol * ((currentPrice - stake.entry_price) / stake.entry_price);
          const pnlPercent = ((currentPrice - stake.entry_price) / stake.entry_price) * 100;
          
          let status: 'HOLDING' | 'WINNING' | 'LOSING' = 'HOLDING';
          if (pnlPercent > 10) status = 'WINNING';
          else if (pnlPercent < -10) status = 'LOSING';
          
          const positionEvent: BotPositionUpdateEvent = {
            type: 'bot_position_update',
            timestamp: new Date().toISOString(),
            data: {
              botId: `bot-${bot.name}`,
              botName: bot.name,
              tokenMint,
              tokenSymbol: this.getTokenSymbol(tokenMint),
              currentPrice,
              entryPrice: stake.entry_price,
              pnl,
              pnlPercent,
              status
            }
          };
          
          this.broadcastEvent(positionEvent);
        }
      }
    });
  }

  private broadcastEvent(event: LiveEvent) {
    this.io.emit('arena_event', event);
    console.log(`[Arena] Broadcasted event: ${event.type}`);
  }

  // Метод для ручного создания события торговли (когда бот делает ставку)
  public broadcastBotTrade(data: {
    botId: string;
    botName: string;
    action: 'BUY' | 'SELL';
    tokenMint: string;
    tokenSymbol: string;
    price: number;
    amount: number;
    confidence: number;
  }) {
    const tradeEvent: BotTradeEvent = {
      type: 'bot_trade',
      timestamp: new Date().toISOString(),
      data
    };
    
    this.broadcastEvent(tradeEvent);

    // Триггерим комментатор
    const botIdMatch = data.botId.match(/\d+/);
    const numericBotId = botIdMatch ? parseInt(botIdMatch[0], 10) : 0;
    
    this.triggerCommentatorEvent({
      type: data.action,
      botId: numericBotId,
      data: {
        tokenSymbol: data.tokenSymbol,
        amount: data.amount
      }
    });
  }

  public getConnectedClientsCount(): number {
    return this.io.sockets.sockets.size;
  }

  public destroy() {
    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
    }
    if (this.leaderboardUpdateInterval) {
      clearInterval(this.leaderboardUpdateInterval);
    }
  }
}

// Global instance
let arenaManager: ArenaWebSocketManager | null = null;

export function getArenaManager(): ArenaWebSocketManager | null {
  return arenaManager;
}

export function initializeArenaManager(io: SocketIOServer): ArenaWebSocketManager {
  if (!arenaManager) {
    arenaManager = new ArenaWebSocketManager(io);
  }
  return arenaManager;
}