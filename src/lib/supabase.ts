import { createClient } from '@supabase/supabase-js';
import type { Bot, Prediction, DailyStats, TokenPrice, Stake } from '../types';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl) {
  throw new Error('SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) is required for server supabase client');
}

if (!supabaseServiceRoleKey) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY (or legacy SUPABASE_SERVICE_KEY) is required for server supabase client');
}

export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

export interface Database {
  public: {
    Tables: {
      bots: {
        Row: Bot;
        Insert: Omit<Bot, 'id' | 'createdAt'>;
        Update: Partial<Omit<Bot, 'id' | 'createdAt'>>;
      };
      predictions: {
        Row: Prediction;
        Insert: Omit<Prediction, 'id' | 'predictedAt'>;
        Update: Partial<Omit<Prediction, 'id' | 'predictedAt'>>;
      };
      daily_stats: {
        Row: DailyStats;
        Insert: Omit<DailyStats, 'id'>;
        Update: Partial<Omit<DailyStats, 'id'>>;
      };
      token_prices: {
        Row: TokenPrice;
        Insert: Omit<TokenPrice, 'timestamp'>;
        Update: Partial<Omit<TokenPrice, 'timestamp'>>;
      };
      stakes: {
        Row: Stake;
        Insert: Omit<Stake, 'id' | 'createdAt'>;
        Update: Partial<Omit<Stake, 'id' | 'createdAt'>>;
      };
    };
  };
}

export async function getBots() {
  const { data, error } = await supabase
    .from('bots')
    .select('*')
    .order('reputation', { ascending: false });

  if (error) throw error;
  return data;
}

export async function getBot(id: string) {
  const { data, error } = await supabase
    .from('bots')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
}

export async function getPredictions() {
  const { data, error } = await supabase
    .from('predictions')
    .select(`
      *,
      bots (
        name,
        wallet_address,
        reputation
      )
    `)
    .order('predicted_at', { ascending: false });

  if (error) throw error;
  return data;
}

export async function createPrediction(prediction: Database['public']['Tables']['predictions']['Insert']) {
  const { data, error } = await supabase
    .from('predictions')
    .insert(prediction)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getStakes() {
  const { data, error } = await supabase
    .from('stakes')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

export async function getUserStakes(walletAddress: string) {
  const { data, error } = await supabase
    .from('stakes')
    .select('*')
    .eq('wallet_address', walletAddress)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

export async function getActiveStakes() {
  const { data, error } = await supabase
    .from('stakes')
    .select('*')
    .eq('result', 'pending')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

export async function createStake(stake: Database['public']['Tables']['stakes']['Insert']) {
  const { data, error } = await supabase
    .from('stakes')
    .insert(stake)
    .select()
    .single();

  if (error) throw error;
  return data;
}
